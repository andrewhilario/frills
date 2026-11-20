// The address a signed-in person is sent to in order to pay. Lemon Squeezy's checkout link (made in their dashboard, kept in env.LEMON_CHECKOUT_URL) can carry two things:
//   checkout[email]                the buyer's email, filled in for them (they can still change it, so it is only a convenience), and
//   checkout[custom][account_id]   our own note, which Lemon Squeezy hands back in the payment webhook as meta.custom_data.
// The webhook (a later step) links a payment to an account by that account id, never by the email, because the email field on their page can be edited.
// Nothing here talks to Lemon Squeezy: it only builds the address.

/** The checkout address for an account, or null if the configured link is missing or not acceptable (it must be https; plain http only on a local development server). */
export function checkoutLink(base, { email, accountId }, { dev = false } = {}) {
  let url;
  try { url = new URL(String(base ?? "").trim()); } catch { return null; }
  const local = dev && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) return null;
  if (url.username || url.password) return null;
  if (!/^[0-9a-f]{16}$/.test(String(accountId ?? "")) || typeof email !== "string" || !email.includes("@")) return null;
  for (const key of [...url.searchParams.keys()]) if (key.startsWith("checkout[")) url.searchParams.delete(key); // never trust what the configured link already carries
  url.searchParams.set("checkout[email]", email);
  url.searchParams.set("checkout[custom][account_id]", accountId);
  return url.toString();
}

/** Whether a checkout link is configured at all (used to hide the button when there is nothing to open). */
export const checkoutReady = (base, dev = false) => checkoutLink(base, { email: "a@b.co", accountId: "0".repeat(16) }, { dev }) !== null;
