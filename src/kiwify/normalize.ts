import type { KiwifyBankingWebhook, KiwifySalesWebhook, NormalizedKiwifyEvent } from "./schemas";

const eventAliases: Record<string, NormalizedKiwifyEvent["event"]> = {
  pix_generated: "pix_gerado",
  billet_printed: "boleto_gerado",
  order_approved: "compra_aprovada",
  pix_gerado: "pix_gerado",
  boleto_gerado: "boleto_gerado",
  compra_aprovada: "compra_aprovada",
};

export function normalizeSalesWebhook(payload: KiwifySalesWebhook): NormalizedKiwifyEvent | null {
  const rawEvent = payload.webhook_event_type ?? payload.event ?? payload.trigger;
  const event = rawEvent ? eventAliases[rawEvent] : undefined;

  if (event !== "pix_gerado" && event !== "boleto_gerado" && event !== "compra_aprovada") {
    return null;
  }

  const product = payload.product ?? payload.Product;
  const customer = payload.customer ?? payload.Customer;

  if (!product || !customer) {
    return null;
  }

  return {
    source: "sales",
    event,
    transactionId: `${payload.order_id ?? payload.id}`,
    customer,
    product,
    paymentInstruction:
      payload.pix_code ??
      payload.pix_qrcode ??
      payload.boleto_url ??
      payload.boleto_barcode ??
      payload.payment?.pix_code ??
      payload.payment?.pix_qrcode ??
      payload.payment?.boleto_url ??
      payload.payment?.boleto_barcode ??
      null,
  };
}

export function normalizeBankingWebhook(payload: KiwifyBankingWebhook): NormalizedKiwifyEvent | null {
  if (payload.type === "CASHIN.PIX.QRCODES.CREATED") {
    return {
      source: "banking",
      event: payload.type,
      transactionId: payload.data.id,
      customer: null,
      product: null,
      paymentInstruction: payload.data.copy_paste,
    };
  }

  if (payload.type === "CASHIN.PIX.QRCODES.PAID") {
    return {
      source: "banking",
      event: payload.type,
      transactionId: payload.data.qrcode_id,
      customer: null,
      product: null,
      paymentInstruction: null,
    };
  }

  if (
    payload.type === "CASHOUT.BOLETO.PAYMENTS.SCHEDULED" ||
    payload.type === "CASHOUT.BOLETO.PAYMENTS.COMPLETED"
  ) {
    return {
      source: "banking",
      event: payload.type,
      transactionId: `${payload.data.id}`,
      customer: null,
      product: null,
      paymentInstruction: payload.data.barcode_line,
    };
  }

  return null;
}
