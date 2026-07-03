import { Hono } from "hono";
import { z } from "zod";
import { kiwifyBankingWebhookSchema, kiwifySalesWebhookSchema } from "./kiwify/schemas";
import { normalizeBankingWebhook, normalizeSalesWebhook } from "./kiwify/normalize";
import { verifyKiwifyRequest, verifyPayloadToken } from "./security/kiwify-signature";
import { getIdempotencyKey, markEventProcessed, releaseEvent, reserveEvent } from "./storage/idempotency";
import { handleRecoveryEvent } from "./recovery/handler";
import { ActiveCampaignError } from "./active-campaign/client";
import type { Env } from "./types";

/** SEC-03: Maximum accepted request body size (1 MB). */
const MAX_BODY_BYTES = 1 * 1024 * 1024;

const app = new Hono<{ Bindings: Env }>();

// SEC-09: Health check exposes only liveness status, not the service name.
app.get("/", (c) => c.json({ status: "ok" }));

app.post("/webhooks/kiwify", async (c) => {
  // SEC-08: Validate that the webhook token is configured and meets minimum length.
  // Cloudflare Workers have no global startup, so this guard runs per-request.
  if (!c.env.KIWIFY_WEBHOOK_TOKEN || c.env.KIWIFY_WEBHOOK_TOKEN.length < 16) {
    console.error(JSON.stringify({ message: "misconfiguration", detail: "KIWIFY_WEBHOOK_TOKEN is missing or too short" }));
    return c.json({ error: "internal_error" }, 500);
  }

  // SEC-07: Reject requests with unexpected Content-Type before reading the body.
  if (!c.req.header("content-type")?.includes("application/json")) {
    return c.json({ error: "unsupported_media_type" }, 415);
  }

  // SEC-03: Reject oversized payloads using the Content-Length header (fast path).
  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return c.json({ error: "payload_too_large" }, 413);
  }

  // rawBody must be read before verifyKiwifyRequest because the Ed25519 signature
  // is computed over the raw body; it cannot be checked without reading it first.
  const rawBody = await c.req.text();

  // SEC-03: Defense-in-depth size check after reading (guards against a missing or
  // lying Content-Length header).
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return c.json({ error: "payload_too_large" }, 413);
  }

  const signatureResult = await verifyKiwifyRequest(
    c.req.raw,
    rawBody,
    c.env.KIWIFY_WEBHOOK_TOKEN,
    c.env.KIWIFY_WEBHOOK_PUBLIC_KEY_PEM,
  );

  // SEC-01: Reject on definitive signature failure immediately, before any JSON
  // parsing or Zod validation, to prevent CPU-based DoS via crafted payloads.
  if (signatureResult === false) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const bankingResult = kiwifyBankingWebhookSchema.safeParse(payload);
  const salesResult = kiwifySalesWebhookSchema.safeParse(payload);

  // signatureResult === null means no header token was present; fall back to the
  // token embedded in the sales payload (Kiwify legacy behaviour).
  if (signatureResult === null && salesResult.success && !verifyPayloadToken(salesResult.data.token, c.env.KIWIFY_WEBHOOK_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const event = bankingResult.success
    ? normalizeBankingWebhook(bankingResult.data)
    : salesResult.success
      ? normalizeSalesWebhook(salesResult.data)
      : null;

  if (!event) {
    return c.json({ status: "ignored" }, 200);
  }

  const idempotencyKey = getIdempotencyKey(event);
  const reservation = await reserveEvent(c.env.WEBHOOK_STATE, idempotencyKey);
  if (reservation !== "reserved") {
    return c.json({ status: "duplicate" }, 200);
  }

  try {
    await handleRecoveryEvent(c.env, event);
    await markEventProcessed(c.env.WEBHOOK_STATE, idempotencyKey);
    return c.json({ status: "processed" }, 200);
  } catch (error) {
    await releaseEvent(c.env.WEBHOOK_STATE, idempotencyKey);
    // SEC-05: Log only safe, non-PII metadata. Never log the full error object or
    // the ActiveCampaign response body, which may contain contact data.
    const errorLog =
      error instanceof ActiveCampaignError
        ? { message: "webhook_processing_failed", idempotencyKey, errorType: "ActiveCampaignError", httpStatus: error.httpStatus }
        : { message: "webhook_processing_failed", idempotencyKey, errorType: error instanceof Error ? error.constructor.name : "unknown" };
    console.error(JSON.stringify(errorLog));
    return c.json({ error: "processing_failed" }, 500);
  }
});

app.onError((error, c) => {
  if (error instanceof z.ZodError) {
    // SEC-05: Do not expose error.issues to the caller — it reveals the internal
    // schema structure and may hint at injection vectors.
    return c.json({ error: "validation_error" }, 400);
  }

  // SEC-05: Log only safe error metadata, never the full error object.
  const errorLog =
    error instanceof ActiveCampaignError
      ? { message: "unhandled_error", errorType: "ActiveCampaignError", httpStatus: error.httpStatus }
      : { message: "unhandled_error", errorType: error instanceof Error ? error.constructor.name : "unknown" };
  console.error(JSON.stringify(errorLog));
  return c.json({ error: "internal_error" }, 500);
});

export default app;
