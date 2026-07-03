export type Env = {
  WEBHOOK_STATE: KVNamespace;
  KIWIFY_WEBHOOK_TOKEN: string;
  KIWIFY_WEBHOOK_PUBLIC_KEY_PEM?: string;
  ACTIVE_CAMPAIGN_BASE_URL: string;
  ACTIVE_CAMPAIGN_API_KEY: string;
  ACTIVE_CAMPAIGN_PIX_FIELD_ID: string;
  ACTIVE_CAMPAIGN_BILLET_FIELD_ID: string;
};

export type ActiveCampaignTagPlan = {
  billingTag: string;
  customerTag: string;
};
