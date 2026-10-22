// PayPal Sandbox checkout skeleton (Orders v2).
// This module is REAL integration code, but it is guarded: while the
// credentials are still the REPLACE_ME placeholders from .env.example,
// createOrder()/captureOrder() refuse to call PayPal and return a clear
// "demo mode" error, so the app can never accidentally hit a real account.
//
// To go live on Sandbox:
//   1. Create a free Sandbox app at https://developer.paypal.com/dashboard/applications/sandbox
//   2. Set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (Sandbox values) in .env
//   3. Restart the server. The /pay/:slug page will render the real PayPal
//      JS SDK button (client-id injected by GET /api/config) and checkout
//      will flow: browser -> POST /api/paypal/orders -> PayPal -> approve ->
//      POST /api/paypal/orders/:id/capture -> ledger marked paid.

const BASE = () =>
  process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export function paypalConfigured() {
  const id = process.env.PAYPAL_CLIENT_ID || "";
  return id && !id.startsWith("REPLACE_ME") && (process.env.PAYPAL_CLIENT_SECRET || "").length > 0;
}

async function accessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

export async function createOrder({ amount, currency, product, slug }) {
  if (!paypalConfigured()) {
    return { demo: true, error: "PayPal Sandbox not configured (placeholder client-id). See server/lib/paypal.js header for the 3 steps." };
  }
  const token = await accessToken();
  const res = await fetch(`${BASE()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: slug,
        description: String(product).slice(0, 127),
        amount: { currency_code: currency, value: Number(amount).toFixed(2) },
      }],
    }),
  });
  if (!res.ok) throw new Error(`Create order failed: ${res.status} ${await res.text()}`);
  return res.json(); // { id, status, links }
}

export async function captureOrder(orderId) {
  if (!paypalConfigured()) {
    return { demo: true, error: "PayPal Sandbox not configured (placeholder client-id)." };
  }
  const token = await accessToken();
  const res = await fetch(`${BASE()}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Capture failed: ${res.status} ${await res.text()}`);
  return res.json(); // status should be COMPLETED
}
