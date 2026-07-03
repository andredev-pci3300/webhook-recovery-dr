import { z } from "zod";

const nullableString = z.string().nullable().optional();

const customerSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  email: z.string().email(),
  cpf: nullableString,
  mobile: nullableString,
  instagram: nullableString,
  country: nullableString,
});

const productSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

const salePaymentSchema = z
  .object({
    charge_amount: z.number().int().optional(),
    charge_currency: z.string().optional(),
    net_amount: z.number().int().optional(),
    pix_code: nullableString,
    pix_qrcode: nullableString,
    boleto_url: nullableString,
    boleto_barcode: nullableString,
  })
  .passthrough();

export const kiwifySaleTriggerSchema = z.enum([
  "boleto_gerado",
  "pix_gerado",
  "carrinho_abandonado",
  "compra_recusada",
  "compra_aprovada",
  "compra_reembolsada",
  "chargeback",
  "subscription_canceled",
  "subscription_late",
  "subscription_renewed",
  "pix_generated",
  "billet_printed",
  "order_approved",
]);

export const kiwifySalesWebhookSchema = z
  .object({
    order_id: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    webhook_event_type: kiwifySaleTriggerSchema.optional(),
    event: kiwifySaleTriggerSchema.optional(),
    trigger: kiwifySaleTriggerSchema.optional(),
    token: z.string().optional(),
    Product: productSchema.optional(),
    product: productSchema.optional(),
    Customer: customerSchema.optional(),
    customer: customerSchema.optional(),
    payment_method: z.string().optional(),
    status: z.string().optional(),
    boleto_url: nullableString,
    boleto_barcode: nullableString,
    pix_code: nullableString,
    pix_qrcode: nullableString,
    payment: salePaymentSchema.optional(),
    approved_date: nullableString,
    created_at: nullableString,
  })
  .passthrough()
  .superRefine((payload, ctx) => {
    if (!payload.webhook_event_type && !payload.event && !payload.trigger) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "missing Kiwify webhook event field",
        path: ["webhook_event_type"],
      });
    }
    if (!payload.order_id && !payload.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "missing order identifier",
        path: ["order_id"],
      });
    }
    if (!payload.customer && !payload.Customer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "missing customer",
        path: ["customer"],
      });
    }
    if (!payload.product && !payload.Product) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "missing product",
        path: ["product"],
      });
    }
  });

const qrcodeCreatedDataSchema = z.object({
  id: z.string().uuid(),
  copy_paste: z.string().min(1),
  picture_code_base64: z.string().min(1),
  external_reference_id: z.string().nullable().optional(),
});

const qrcodePaidDataSchema = z.object({
  qrcode_id: z.string().uuid(),
  type: z.enum(["INSTANT", "DUE_DATE"]),
  status: z.enum(["waiting_payment", "paid", "cancelled"]),
  amount_in_cents: z.number().int(),
  accept_change_value: z.boolean(),
  allowed_tax_ids: z.array(z.string()),
  qrcode_created_at: z.string().datetime(),
  qrcode_updated_at: z.string().datetime(),
  external_reference_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  payment_details: z
    .object({
      transaction_id: z.number().int(),
      end_to_end_id: z.string(),
      amount_paid_in_cents: z.number().int(),
      paid_at: z.string().datetime(),
    })
    .nullable()
    .optional(),
});

const boletoDataSchema = z.object({
  id: z.number().int(),
  status: z.enum(["pending", "processing", "success", "cancelled", "failed"]),
  barcode_line: z.string(),
  tax_id: z.string(),
  created_at: z.string().datetime(),
  amount_in_cents: z.number().int().nullable().optional(),
  description: z.string().nullable().optional(),
  external_reference_id: z.string().nullable().optional(),
  failed_message: z.string().nullable().optional(),
  scheduled_date: z.string().nullable().optional(),
  transaction_id: z.number().int().nullable().optional(),
});

const bankingEnvelopeBaseSchema = z.object({
  id: z.string().uuid(),
  version: z.literal("1.0"),
  created_at: z.string().datetime(),
});

export const kiwifyBankingWebhookSchema = z.discriminatedUnion("type", [
  bankingEnvelopeBaseSchema.extend({
    type: z.literal("CASHIN.PIX.QRCODES.CREATED"),
    data: qrcodeCreatedDataSchema,
  }),
  bankingEnvelopeBaseSchema.extend({
    type: z.literal("CASHIN.PIX.QRCODES.PAID"),
    data: qrcodePaidDataSchema,
  }),
  bankingEnvelopeBaseSchema.extend({
    type: z.enum([
      "CASHOUT.BOLETO.PAYMENTS.SCHEDULED",
      "CASHOUT.BOLETO.PAYMENTS.COMPLETED",
      "CASHOUT.BOLETO.PAYMENTS.FAILED",
      "CASHOUT.BOLETO.PAYMENTS.SCHEDULED.FAILED",
    ]),
    data: boletoDataSchema,
  }),
]);

export type KiwifySalesWebhook = z.infer<typeof kiwifySalesWebhookSchema>;
export type KiwifyBankingWebhook = z.infer<typeof kiwifyBankingWebhookSchema>;

export type NormalizedKiwifyEvent =
  | {
      source: "sales";
      event: "pix_gerado" | "boleto_gerado" | "compra_aprovada";
      transactionId: string;
      customer: z.infer<typeof customerSchema>;
      product: z.infer<typeof productSchema>;
      paymentInstruction: string | null;
    }
  | {
      source: "banking";
      event:
        | "CASHIN.PIX.QRCODES.CREATED"
        | "CASHIN.PIX.QRCODES.PAID"
        | "CASHOUT.BOLETO.PAYMENTS.SCHEDULED"
        | "CASHOUT.BOLETO.PAYMENTS.COMPLETED";
      transactionId: string;
      customer: null;
      product: null;
      paymentInstruction: string | null;
    };
