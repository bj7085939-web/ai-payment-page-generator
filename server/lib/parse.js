// Minimal natural-language -> order parser (rule based, offline).
// Swap point: if LLM_API_KEY is set you can replace parseWithRules() with an LLM
// call that returns the same JSON shape; the rest of the app does not change.

const CURRENCY_WORDS = [
  { re: /(美元|美金|USD|\$|usd)/i, code: "USD" },
  { re: /(欧元|EUR|€)/i, code: "EUR" },
  { re: /(英镑|GBP|£)/i, code: "GBP" },
  { re: /(人民币|元|块钱|块|CNY|¥|￥)/i, code: "CNY" },
  { re: /(日元|JPY)/i, code: "JPY" },
];

const FILLER = [
  /我想(卖|收|要)/g, /我要(卖|收)/g, /帮我(卖|生成|收款)/g, /卖给[^，,。]*/g,
  /sell\s+(a|an|the)?/gi, /charge\s+(for)?/gi, /payment\s+for/gi, /收款/g,
  /生成(一个)?收款页/g, /价格(是|为)?/g, /售价(是|为)?/g, /定价(是|为)?/g,
];

export function parseWithRules(text = "") {
  const raw = String(text).trim();
  const emailMatch = raw.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const buyerEmail = emailMatch ? emailMatch[0] : null;

  let currency = "USD";
  for (const c of CURRENCY_WORDS) {
    if (c.re.test(raw)) { currency = c.code; break; }
  }

  const amountMatch = raw.match(/(\d+(?:[.,]\d{1,2})?)\s*(美元|美金|元|块钱|块|欧元|英镑|日元|USD|EUR|GBP|JPY|CNY|\$|€|£|¥|￥)?/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(",", ".")) : null;

  let product = raw
    .replace(emailMatch ? emailMatch[0] : "", "")
    .replace(amountMatch ? amountMatch[0] : "", " ")
    .replace(/(美元|美金|人民币|欧元|英镑|日元|USD|EUR|GBP|JPY|CNY|\$|€|£|¥|￥)/gi, " ");
  for (const f of FILLER) product = product.replace(f, " ");
  product = product.replace(/[，,。；;：:、\s]+/g, " ").trim();
  if (product.length > 60) product = product.slice(0, 60);
  if (!product) product = "Untitled item / 未命名商品";

  return {
    product,
    amount,
    currency,
    buyerEmail,
    description: raw,
    parser: process.env.LLM_API_KEY ? "rules (LLM hook present, not wired in MVP)" : "rules",
    confidence: amount && product ? "high" : "low",
  };
}

export function reconciliationSummary(page, allPages) {
  const paid = allPages.filter((p) => p.status === "paid" && p.currency === page.currency);
  const total = paid.reduce((s, p) => s + Number(p.amount || 0), 0);
  return [
    `Reconciliation / 对账摘要`,
    `- Item: ${page.product}`,
    `- Amount received: ${page.amount} ${page.currency} (status: PAID, ref: ${page.paypalOrderId || "n/a"})`,
    `- Buyer: ${page.buyerEmail || "anonymous payer"}`,
    `- Paid at: ${page.paidAt}`,
    `- Ledger total (${page.currency}, paid): ${total} across ${paid.length} paid order(s)`,
    `- Open items in ledger: ${allPages.filter((p) => p.status === "unpaid").length}`,
  ].join("\n");
}

export function followUpDraft(page) {
  const days = Math.max(0, Math.round((Date.now() - new Date(page.createdAt).getTime()) / 86400000));
  return [
    `Subject: Friendly reminder – payment link for ${page.product}`,
    ``,
    `Hi${page.buyerEmail ? " " + page.buyerEmail.split("@")[0] : ""},`,
    `Just a quick reminder that the payment page for "${page.product}" (${page.amount} ${page.currency}) is still open.`,
    `It was created ${days} day(s) ago – you can complete it here: /pay/${page.slug}`,
    `If you have already paid, please ignore this note. Happy to answer any questions.`,
    ``,
    `-- 自动生成草稿（发送前请人工确认）/ AI-generated draft, review before sending`,
  ].join("\n");
}
