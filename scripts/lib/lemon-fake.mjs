// Made-up Lemon Squeezy webhook deliveries, signed the way Lemon Squeezy signs them, for tests and for trying Frills Plus on a local server with no Lemon Squeezy store.
// The shapes follow Lemon Squeezy's documentation (meta.event_name, meta.custom_data, data.type / id / attributes). They are NOT recordings of real deliveries:
// check them against one real test-mode delivery before relying on them (see PLAN-FRILLS-PLUS.md).

import { createHmac } from "node:crypto";

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().replace("Z", "000Z"); // Lemon Squeezy writes 6 decimals: 2026-11-12T00:00:00.000000Z

/**
 * One delivery: { headers, body } ready to POST. `name` is the event name. `account` is the account id that was in the checkout address (omit to leave custom data out).
 * `subscription` and `order` are the provider's ids. `status` is the subscription's status. `at` is the event time (ms). `renewsInDays` / `endsInDays` set the dates.
 */
export function fakeDelivery({ name, account, subscription = "1001", order = "2001", status = "active", at = Date.now(), renewsInDays = 30, endsInDays = null, storeId = 1, productId = 7, testMode = true, invoiceStatus = "paid", orderStatus = "paid", billingReason = "renewal", email = "buyer@example.com" }) {
  const meta = { event_name: name, ...(account ? { custom_data: { account_id: account } } : {}) };
  const common = { store_id: storeId, test_mode: testMode, created_at: iso(at - DAY), updated_at: iso(at) };
  let data;
  if (name.startsWith("order_")) {
    data = { type: "orders", id: String(order), attributes: { ...common, status: orderStatus, refunded: orderStatus === "refunded", user_email: email } };
  } else if (name.startsWith("subscription_payment_")) {
    data = { type: "subscription-invoices", id: "9001", attributes: { ...common, subscription_id: Number(subscription), status: invoiceStatus, billing_reason: billingReason, refunded: invoiceStatus === "refunded" } };
  } else {
    data = {
      type: "subscriptions",
      id: String(subscription),
      attributes: {
        ...common,
        product_id: productId,
        order_id: Number(order),
        user_email: email,
        status,
        cancelled: status === "cancelled",
        renews_at: iso(at + renewsInDays * DAY),
        ends_at: endsInDays === null ? null : iso(at + endsInDays * DAY),
      },
    };
  }
  return { headers: { "content-type": "application/json", "x-event-name": name }, body: JSON.stringify({ meta, data }) };
}

/** The X-Signature value: an HMAC-SHA256 hex digest of the raw body with the webhook's signing secret. */
export const signBody = (body, secret) => createHmac("sha256", secret).update(body).digest("hex");

/** A delivery with its signature added. */
export function signedDelivery(options, secret) {
  const { headers, body } = fakeDelivery(options);
  return { headers: { ...headers, "x-signature": signBody(body, secret) }, body };
}
