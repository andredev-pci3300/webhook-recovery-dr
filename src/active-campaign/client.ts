import type { ActiveCampaignTagPlan } from "../types";

type ActiveCampaignContact = {
  id: string;
  email: string;
};

type ActiveCampaignConfig = {
  baseUrl: string;
  apiKey: string;
};

/**
 * SEC-05: Custom error that holds only a safe, non-PII message suitable for logging.
 *
 * The raw response body from the ActiveCampaign API is intentionally NOT stored
 * because it may contain contact data (email, name, etc.).
 */
export class ActiveCampaignError extends Error {
  readonly httpStatus: number;
  readonly safeMessage: string;

  constructor(httpStatus: number) {
    const safeMessage = `ActiveCampaign API error: ${httpStatus}`;
    super(safeMessage);
    this.name = "ActiveCampaignError";
    this.httpStatus = httpStatus;
    this.safeMessage = safeMessage;
  }
}

export class ActiveCampaignClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ActiveCampaignConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  async findContactByEmail(email: string) {
    const response = await this.request<{ contacts: ActiveCampaignContact[] }>(
      `/api/3/contacts?email=${encodeURIComponent(email)}`,
      { method: "GET" },
    );

    return response.contacts[0] ?? null;
  }

  async createContact(input: { email: string; firstName: string; phone?: string | null }) {
    const response = await this.request<{ contact: ActiveCampaignContact }>("/api/3/contacts", {
      method: "POST",
      body: JSON.stringify({
        contact: {
          email: input.email,
          firstName: input.firstName,
          phone: input.phone ?? undefined,
        },
      }),
    });

    return response.contact;
  }

  async upsertContact(input: { email: string; firstName: string; phone?: string | null }) {
    const existing = await this.findContactByEmail(input.email);
    return existing ?? this.createContact(input);
  }

  async addTag(contactId: string, tagName: string) {
    const tagId = await this.getOrCreateTagId(tagName);
    await this.request("/api/3/contactTags", {
      method: "POST",
      body: JSON.stringify({
        contactTag: {
          contact: contactId,
          tag: tagId,
        },
      }),
    });
  }

  async removeTag(contactId: string, tagName: string) {
    const tagId = await this.findTagId(tagName);
    if (!tagId) {
      return;
    }

    const response = await this.request<{ contactTags: Array<{ id: string; tag: string }> }>(
      `/api/3/contactTags?contact=${encodeURIComponent(contactId)}`,
      { method: "GET" },
    );

    const target = response.contactTags.find((contactTag) => contactTag.tag === tagId);
    if (target) {
      await this.request(`/api/3/contactTags/${target.id}`, { method: "DELETE" });
    }
  }

  async updateCustomField(contactId: string, fieldId: string, value: string) {
    await this.request("/api/3/fieldValues", {
      method: "POST",
      body: JSON.stringify({
        fieldValue: {
          contact: contactId,
          field: fieldId,
          value,
        },
      }),
    });
  }

  async applyBillingPlan(contactId: string, plan: ActiveCampaignTagPlan, instructionFieldId: string, instruction: string) {
    await this.addTag(contactId, plan.billingTag);
    await this.updateCustomField(contactId, instructionFieldId, instruction);
  }

  private async getOrCreateTagId(tagName: string) {
    const existingTagId = await this.findTagId(tagName);
    if (existingTagId) {
      return existingTagId;
    }

    const response = await this.request<{ tag: { id: string } }>("/api/3/tags", {
      method: "POST",
      body: JSON.stringify({
        tag: {
          tag: tagName,
          tagType: "contact",
        },
      }),
    });

    return response.tag.id;
  }

  private async findTagId(tagName: string) {
    const response = await this.request<{ tags: Array<{ id: string; tag: string }> }>(
      `/api/3/tags?search=${encodeURIComponent(tagName)}`,
      { method: "GET" },
    );

    return response.tags.find((tag) => tag.tag === tagName)?.id ?? null;
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Api-Token": this.apiKey,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      // Consume body to release the connection, but do NOT include it in the error
      // to avoid propagating PII (contact data) into logs.
      await response.text();
      throw new ActiveCampaignError(response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json<T>();
  }
}
