const $ = (id) => document.getElementById(id);

async function loadMode() {
  const cfg = await (await fetch("/api/config")).json();
  $("modeBadge").textContent = cfg.paypalConfigured
    ? "SANDBOX-LIVE（已配置凭据）"
    : "DEMO 模式（占位凭据，付款为本地模拟）";
}

$("parseBtn").addEventListener("click", async () => {
  const text = $("nlInput").value;
  const r = await fetch("/api/parse", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const j = await r.json();
  $("parseOut").textContent = JSON.stringify(j, null, 2);
  if (j.product) $("fProduct").value = j.product;
  if (j.amount) $("fAmount").value = j.amount;
  if (j.currency) $("fCurrency").value = j.currency;
  if (j.buyerEmail) $("fEmail").value = j.buyerEmail;
});

$("createBtn").addEventListener("click", async () => {
  const payload = {
    product: $("fProduct").value, amount: Number($("fAmount").value),
    currency: $("fCurrency").value, buyerEmail: $("fEmail").value || null,
    description: $("nlInput").value,
  };
  const r = await fetch("/api/payment-pages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  $("createdOut").innerHTML = r.ok
    ? `收款页已生成：<a href="${j.payUrl}" target="_blank">${location.origin}${j.payUrl}</a>（把这个链接发给买家即可）`
    : `<span class="err">${j.error || "生成失败"}</span>`;
  loadLedger();
});

async function loadLedger() {
  const j = await (await fetch("/api/ledger")).json();
  $("totals").textContent =
    `已收合计: ${JSON.stringify(j.totalsPaidByCurrency)} · 已付 ${j.paidCount} 单 · 待付 ${j.openCount} 单`;
  const tb = document.querySelector("#ledger tbody");
  tb.innerHTML = "";
  for (const it of j.items) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${it.product}</td><td>${it.amount} ${it.currency}</td>
      <td>${it.status}</td>
      <td><button data-slug="${it.slug}" class="view">查看</button></td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll(".view").forEach((b) =>
    b.addEventListener("click", () => showDetail(b.dataset.slug)));
}

async function showDetail(slug) {
  const page = await (await fetch(`/api/payment-pages/${slug}`)).json();
  if (page.status === "paid") {
    $("detail").textContent = page.summary || "(已付，暂无摘要)";
  } else {
    const f = await (await fetch(`/api/payment-pages/${slug}/follow-up`)).json();
    $("detail").textContent = "催付草稿（未付订单自动生成）：\n\n" + f.draft +
      `\n\n收款链接: /pay/${slug}`;
  }
}

loadMode();
loadLedger();
