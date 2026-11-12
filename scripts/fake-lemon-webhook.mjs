// Sends a made-up, correctly signed Lemon Squeezy webhook to a local Frills server, so Frills Plus can be tried with no Lemon Squeezy store.
//
//   1. Start the server with a secret:   LEMON_WEBHOOK_SECRET=test-secret LEMON_CHECKOUT_URL=http://localhost:3021/pretend-checkout/ node scripts/serve.mjs 3021
//   2. Sign in at /account/, press "Get Frills Plus" (it goes to the pretend address), and copy the account id from the address (checkout[custom][account_id]).
//   3. Send an event:  LEMON_WEBHOOK_SECRET=test-secret node scripts/fake-lemon-webhook.mjs --account <id> --event subscription_created
// Then reload /account/. Other events to try: subscription_payment_success, subscription_cancelled (use --ends 10), subscription_expired, order_refunded --order-status refunded.
// Options: --url http://localhost:3021  --event <name>  --account <id>  --subscription 1001  --order 2001  --status active  --renews 30  --ends <days>  --order-status paid|refunded  --invoice-status paid|refunded

import { signedDelivery } from "./lib/lemon-fake.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : pairs), []));
const secret = process.env.LEMON_WEBHOOK_SECRET;
if (!secret) { console.error("Set LEMON_WEBHOOK_SECRET to the same secret the server was started with."); process.exit(1); }
if (!args.event) { console.error("Say which event with --event (for example subscription_created)."); process.exit(1); }

const { headers, body } = signedDelivery({
  name: args.event,
  account: args.account,
  subscription: args.subscription ?? "1001",
  order: args.order ?? "2001",
  status: args.status ?? "active",
  renewsInDays: Number(args.renews ?? 30),
  endsInDays: args.ends === undefined ? null : Number(args.ends),
  orderStatus: args["order-status"] ?? "paid",
  invoiceStatus: args["invoice-status"] ?? "paid",
}, secret);

const res = await fetch(`${args.url ?? "http://localhost:3021"}/api/webhooks/lemonsqueezy`, { method: "POST", headers, body });
console.log(res.status, await res.text());
