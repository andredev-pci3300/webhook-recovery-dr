import { ActiveCampaignClient } from "../active-campaign/client";
import type { NormalizedKiwifyEvent } from "../kiwify/schemas";
import type { ActiveCampaignTagPlan, Env } from "../types";

export async function handleRecoveryEvent(env: Env, event: NormalizedKiwifyEvent) {
  if (event.source === "banking") {
    return;
  }

  const activeCampaign = new ActiveCampaignClient({
    baseUrl: env.ACTIVE_CAMPAIGN_BASE_URL,
    apiKey: env.ACTIVE_CAMPAIGN_API_KEY,
  });

  const contactInput: { email: string; firstName: string; phone?: string | null } = {
    email: event.customer.email,
    firstName: event.customer.name,
  };

  if (event.customer.mobile !== undefined) {
    contactInput.phone = event.customer.mobile;
  }

  const contact = await activeCampaign.upsertContact(contactInput);

  const tags = buildTags(event.product.name);

  if (event.event === "pix_gerado" && event.paymentInstruction) {
    await activeCampaign.applyBillingPlan(contact.id, tags, env.ACTIVE_CAMPAIGN_PIX_FIELD_ID, event.paymentInstruction);
    return;
  }

  if (event.event === "boleto_gerado" && event.paymentInstruction) {
    await activeCampaign.applyBillingPlan(
      contact.id,
      tags,
      env.ACTIVE_CAMPAIGN_BILLET_FIELD_ID,
      event.paymentInstruction,
    );
    return;
  }

  if (event.event === "compra_aprovada") {
    await activeCampaign.removeTag(contact.id, tags.billingTag);
    await activeCampaign.addTag(contact.id, tags.customerTag);
  }
}

function buildTags(productName: string): ActiveCampaignTagPlan {
  return {
    billingTag: `[Status] Aguardando Pagamento - ${productName}`,
    customerTag: `[Cliente] ${productName}`,
  };
}
