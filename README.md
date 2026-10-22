# AI Payment Page Generator

**Describe a deal in one sentence → get a shareable payment page with a PayPal Sandbox checkout, an automatic ledger, a reconciliation summary, and a follow-up draft for unpaid orders.**

Built for the PayPal AI Hackathon (MVP, v0.1).

## Problem

Freelancers and solo sellers lose deals in the gap between "chatting with a buyer" and "getting paid": they have to assemble a payment link by hand, track who paid in a spreadsheet, reconcile amounts manually, and remember to chase unpaid orders. Each step is small, but together they leak revenue and time.

## Solution

One plain-language sentence (English or Chinese) is parsed into an order — product, amount, currency, buyer email — and turned into:

1. **A shareable payment page** (`/pay/:slug`) with a PayPal Sandbox checkout flow (Orders v2: create → approve → capture).
2. **An automatic ledger** — every paid order is recorded the moment capture completes.
3. **A reconciliation summary** — per-order receipt text plus per-currency paid totals and open-item counts.
4. **A follow-up draft** — for unpaid orders, a ready-to-review reminder message with the payment link and the order's age in days.

The natural-language parser is rule-based and fully offline in this MVP; an LLM hook is reserved in `server/lib/parse.js` (same JSON shape in/out) for a smarter parser later.

## Run it locally

Zero dependencies — only Node.js ≥ 18 is required.

```bash
git clone <this-repo>
cd ai-payment-page-generator
node server/index.js        # or: npm start
# open http://localhost:3000
```

**3-minute demo path**

1. On the home page, type: `Sell a Logo design package for 300 USD, buyer email demo@example.com` → click "Parse" → the order form fills itself → click "Generate payment page" to get a `/pay/xxxxx` link.
2. Open the payment page → click the simulated Sandbox pay button → you get a reconciliation summary and the order flips to `paid`.
3. Back on the home page ledger, the order is booked. Open the seeded overdue order (`Ebook bundle (demo)`) → a follow-up draft is generated for it.

**Smoke test**

```bash
PORT=3100 node server/index.js &
curl -s localhost:3100/api/config      # -> mode: demo-simulated
curl -s -X POST localhost:3100/api/parse -H 'Content-Type: application/json' \
  -d '{"text":"Sell a Logo design package for 300 USD"}'
curl -s localhost:3100/api/ledger      # ledger + totals
```

## DEMO mode

**Out of the box the app runs in DEMO mode and never calls PayPal.** While the credentials in `.env` are still the `REPLACE_ME_...` placeholders from `.env.example`, the PayPal module refuses to make real API calls and checkout is simulated locally, clearly labelled as simulated. The seeded data in `data/demo-data.json` is entirely fictional (example.com addresses, `DEMO-SANDBOX-ORDER-*` ids, no real customers, no real money).

To run against the real PayPal Sandbox instead:

1. Create a free **Sandbox** app in the PayPal Developer Dashboard.
2. Copy `.env.example` to `.env` and replace `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` with your Sandbox values (never commit `.env` — it is gitignored).
3. Restart the server. `/api/config` now reports `sandbox-live`, the payment page renders the real PayPal JS SDK button, and checkout runs the genuine Sandbox flow with test buyer accounts — still no real money.

Known MVP limits: storage is in-memory (restarting reseeds the fictional demo data); the webhook endpoint is a stub and does not yet verify webhook signatures (marked with a TODO in code); slug generation falls back to `item-xxxxx` for non-Latin product names.

## Project layout

```
.
├─ server/index.js       # zero-dependency HTTP server + all API routes
├─ server/lib/parse.js   # NL parser + reconciliation summary + follow-up draft
├─ server/lib/paypal.js  # PayPal Sandbox Orders v2 skeleton, placeholder-guarded
├─ public/               # generator page, payment page, client JS, styles
├─ data/demo-data.json   # fictional seed ledger (2 paid + 1 overdue)
├─ .env.example          # credential placeholders (Sandbox only)
└─ LICENSE               # MIT
```

## Built with

- **Node.js** (built-in `http` module — no runtime dependencies)
- **PayPal Sandbox REST API** — Orders v2 (create / capture), PayPal JS SDK button, webhook stub
- **Vanilla HTML / CSS / JavaScript** front end
- Rule-based natural-language parser (offline; LLM swap point reserved)

## AI disclosure

This project was built with AI assistance: an AI coding assistant generated and refined the code and copy drafts, under human direction for scope, review, and testing. Demo data is fictional and AI-generated for illustration only. This disclosure is made in line with the hackathon's transparency expectations.

## License

MIT — see [LICENSE](LICENSE).
