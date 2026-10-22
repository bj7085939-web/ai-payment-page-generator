import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWithRules, reconciliationSummary, followUpDraft } from "./lib/parse.js";
import { paypalConfigured, createOrder, captureOrder } from "./lib/paypal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);

// --- tiny .env loader (no dependency) ---
const envFile = path.join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// --- in-memory store, seeded with demo data ---
const seed = JSON.parse(await readFile(path.join(ROOT, "data", "demo-data.json"), "utf8"));
const pages = new Map(seed.paymentPages.map((p) => [p.slug, p]));
const webhookLog = [];

const slugify = (s) =>
  (String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "item") +
  "-" + Math.random().toString(36).slice(2, 7);

function send(res, code, body, type = "application/json; charset=utf-8") {
  const data = type.startsWith("application/json") ? JSON.stringify(body) : body;
  res.writeHead(code, { "Content-Type": type });
  res.end(data);
}
async function bodyJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
function markPaid(page, ref) {
  page.status = "paid";
  page.paidAt = new Date().toISOString();
  page.paypalOrderId = ref || page.paypalOrderId || "DEMO-SIMULATED";
  page.summary = reconciliationSummary(page, [...pages.values()]);
  return page;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // ---------- API ----------
    if (p === "/api/config" && req.method === "GET") {
      return send(res, 200, {
        paypalConfigured: paypalConfigured(),
        clientId: paypalConfigured() ? process.env.PAYPAL_CLIENT_ID : "REPLACE_ME_SANDBOX_CLIENT_ID",
        env: process.env.PAYPAL_ENV || "sandbox",
        mode: paypalConfigured() ? "sandbox-live" : "demo-simulated",
      });
    }
    if (p === "/api/parse" && req.method === "POST") {
      const { text } = await bodyJson(req);
      if (!text) return send(res, 400, { error: "text is required" });
      return send(res, 200, parseWithRules(text));
    }
    if (p === "/api/payment-pages" && req.method === "POST") {
      const b = await bodyJson(req);
      if (!b.product || !(Number(b.amount) > 0)) return send(res, 400, { error: "product and a positive amount are required" });
      const page = {
        slug: slugify(b.product),
        product: String(b.product).slice(0, 120),
        amount: Number(b.amount),
        currency: (b.currency || "USD").toUpperCase(),
        buyerEmail: b.buyerEmail || null,
        description: b.description || "",
        status: "unpaid",
        createdAt: new Date().toISOString(),
        paidAt: null,
        paypalOrderId: null,
      };
      pages.set(page.slug, page);
      return send(res, 201, { ...page, payUrl: `/pay/${page.slug}` });
    }
    if (p === "/api/payment-pages" && req.method === "GET") {
      return send(res, 200, [...pages.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    const pageMatch = p.match(/^\/api\/payment-pages\/([\w-]+)$/);
    if (pageMatch && req.method === "GET") {
      const page = pages.get(pageMatch[1]);
      return page ? send(res, 200, page) : send(res, 404, { error: "not found" });
    }
    const followMatch = p.match(/^\/api\/payment-pages\/([\w-]+)\/follow-up$/);
    if (followMatch && req.method === "GET") {
      const page = pages.get(followMatch[1]);
      return page ? send(res, 200, { draft: followUpDraft(page) }) : send(res, 404, { error: "not found" });
    }
    // --- PayPal Sandbox checkout skeleton ---
    if (p === "/api/paypal/orders" && req.method === "POST") {
      const { slug } = await bodyJson(req);
      const page = pages.get(slug);
      if (!page) return send(res, 404, { error: "payment page not found" });
      const order = await createOrder(page);
      if (order.demo) return send(res, 200, order); // placeholder creds -> explicit demo response
      page.paypalOrderId = order.id;
      return send(res, 200, order);
    }
    const capMatch = p.match(/^\/api\/paypal\/orders\/([\w-]+)\/capture$/);
    if (capMatch && req.method === "POST") {
      const result = await captureOrder(capMatch[1]);
      if (result.demo) return send(res, 200, result);
      if (result.status === "COMPLETED") {
        const page = [...pages.values()].find((x) => x.paypalOrderId === capMatch[1]);
        if (page) markPaid(page, capMatch[1]);
      }
      return send(res, 200, result);
    }
    // --- Simulated sandbox payment (demo mode, clearly labelled) ---
    const simMatch = p.match(/^\/api\/sandbox\/pay\/([\w-]+)$/);
    if (simMatch && req.method === "POST") {
      const page = pages.get(simMatch[1]);
      if (!page) return send(res, 404, { error: "not found" });
      if (page.status !== "paid") markPaid(page, "SIM-" + Math.random().toString(36).slice(2, 10).toUpperCase());
      return send(res, 200, { ok: true, simulated: true, page, summary: page.summary });
    }
    // --- Webhook stub: log events, flip ledger on capture-completed ---
    if (p === "/api/paypal/webhook" && req.method === "POST") {
      const evt = await bodyJson(req);
      webhookLog.push({ at: new Date().toISOString(), type: evt.event_type || "unknown" });
      // TODO(sandbox): verify webhook signature with PAYPAL_WEBHOOK_ID before trusting events.
      if (evt.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        const ref = evt.resource?.supplementary_data?.related_ids?.order_id;
        const page = [...pages.values()].find((x) => x.paypalOrderId === ref);
        if (page && page.status !== "paid") markPaid(page, ref);
      }
      return send(res, 200, { received: true });
    }
    if (p === "/api/ledger" && req.method === "GET") {
      const all = [...pages.values()];
      const byCurrency = {};
      for (const x of all.filter((i) => i.status === "paid")) {
        byCurrency[x.currency] = (byCurrency[x.currency] || 0) + Number(x.amount);
      }
      return send(res, 200, {
        totalsPaidByCurrency: byCurrency,
        paidCount: all.filter((i) => i.status === "paid").length,
        openCount: all.filter((i) => i.status === "unpaid").length,
        items: all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        webhookLog,
      });
    }

    // ---------- Pages ----------
    if (p === "/" ) return send(res, 200, await readFile(path.join(PUBLIC, "index.html"), "utf8"), "text/html; charset=utf-8");
    if (p === "/styles.css") return send(res, 200, await readFile(path.join(PUBLIC, "styles.css"), "utf8"), "text/css; charset=utf-8");
    if (p === "/app.js") return send(res, 200, await readFile(path.join(PUBLIC, "app.js"), "utf8"), "text/javascript; charset=utf-8");
    const payMatch = p.match(/^\/pay\/([\w-]+)$/);
    if (payMatch && req.method === "GET") {
      const page = pages.get(payMatch[1]);
      if (!page) return send(res, 404, "Payment page not found", "text/plain; charset=utf-8");
      const tpl = await readFile(path.join(PUBLIC, "pay.html"), "utf8");
      const html = tpl
        .replaceAll("{{PRODUCT}}", escapeHtml(page.product))
        .replaceAll("{{AMOUNT}}", String(page.amount))
        .replaceAll("{{CURRENCY}}", page.currency)
        .replaceAll("{{SLUG}}", page.slug)
        .replaceAll("{{STATUS}}", page.status);
      return send(res, 200, html, "text/html; charset=utf-8");
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

server.listen(PORT, () => {
  console.log(`AI Payment Page Generator running at http://localhost:${PORT}`);
  console.log(`Mode: ${paypalConfigured() ? "SANDBOX-LIVE (credentials found)" : "DEMO (placeholder credentials, payments simulated)"}`);
});
