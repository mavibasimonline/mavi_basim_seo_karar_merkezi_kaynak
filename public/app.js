import {
  $,
  node,
  number,
  percent,
  deviceName,
  date,
  time,
  period,
  sourceName,
  statusName,
  icon,
  svg,
  detail,
  list,
  badge,
  siteLink,
  empty,
  sortHeader,
  metricCell,
} from "./ui.js";
import { evidenceView, performanceView, answerView, historyEventView } from "./evidence.js";
import { drawChart, metricNames } from "./chart.js";
import { setupModules } from "./modules.js";
const views = {
  overview: [
    "Genel Bakış",
    "SEO’ya genel bakış",
    "Arama performansınızı izleyin. Bir sonraki adımınızı kanıtla belirleyin.",
  ],
  products: [
    "Ürün Performansı",
    "Ürün performansı",
    "Her ürünün arama görünürlüğü, SEO kararı ve kaynak kanıtı bir arada.",
  ],
  queries: [
    "Arama Sorguları",
    "Sorgudan içgörüye",
    "Hangi aramaların ürünlerinize görünürlük ve tıklama getirdiğini inceleyin.",
  ],
  radar: [
    "SEO Fırsat Radarı",
    "Bir sonraki fırsatınızı bulun",
    "Veri yeterliliğini ve başarılı kelimeleri koruyan fırsat değerlendirmeleri.",
  ],
  changes: [
    "Değişiklik Takvimi",
    "SEO değişikliklerini izleyin",
    "Nelerin değiştiğini, ne zaman tespit edildiğini ve ölçülebilen etkileri görün.",
  ],
  health: [
    "Veri Sağlığı",
    "Kararlarınızın temeli: güvenilir veri",
    "Bağlantıları, kaynakları ve ölçümlerin doğruluğunu tek yerden inceleyin.",
  ],
  questions: [
    "SEO Soru-Cevap",
    "Verinize sorun. Kanıtıyla yanıt alın.",
    "Kısa Türkçe sorular, kaynakları ve sınırları açık yanıtlar.",
  ],
};
const state = {
  report: null,
  status: null,
  performance: null,
  view: "overview",
  metric: "clicks",
  productSort: { key: "name", direction: "asc" },
  querySort: { key: "impressions", direction: "desc" },
  queryPage: 1,
  queryHasNext: false,
  loaded: {},
  previousQuestionId: null,
  questionMonth: null,
  request: 0,
  queryRequest: 0,
};
let controller,
  queryController,
  sessionEpoch = 0;
const last = new Date();
last.setUTCDate(1);
last.setUTCMonth(last.getUTCMonth() - 1);
const now = new Date();
for (let i = 0; i < 24; i++) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
  const label = new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
  $("month").append(
    new Option(
      label[0].toLocaleUpperCase("tr-TR") + label.slice(1),
      d.toISOString().slice(0, 7),
    ),
  );
}
$("month").value = last.toISOString().slice(0, 7);
function notify(text = "") {
  $("message").textContent = text;
  $("message").hidden = !text;
}
function showLogin() {
  sessionEpoch++;
  controller?.abort();
  queryController?.abort();
  state.request++;
  state.queryRequest++;
  state.report = null;
  state.status = null;
  state.performance = null;
  state.previousQuestionId = null;
  state.questionMonth = null;
  state.loaded = {};
  $("app").hidden = true;
  document.querySelector(".skip-link").href = "#loginScreen";
  $("loginScreen").hidden = false;
  $("questionText").value = "";
  $("querySearch").value = "";
  $("productSearch").value = "";
  $("token").value = "";
  $("answer").hidden = true;
  for (const id of [
    "products",
    "queryTable",
    "answer",
    "productDetail",
    "radarResults",
    "dataAuditResults",
    "health",
    "kpis",
    "performanceChart",
    "chartTable",
    "summary",
    "changeResults",
  ])
    $(id).replaceChildren();
  if ($("productDialog").open) $("productDialog").close();
  closeMobile();
}
async function api(path, options = {}) {
  const epoch = sessionEpoch;
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error("Sunucuya ulaşılamadı. Lütfen yeniden deneyin.");
  }
  let data = null;
  try {
    if (response.status !== 204) data = await response.json();
  } catch (cause) {
    if (cause.name === "AbortError") throw cause;
    if (response.status === 401) showLogin();
    const error = new Error(
      "Sunucudan beklenen yanıt alınamadı. Lütfen yeniden deneyin.",
    );
    error.status = response.status;
    throw error;
  }
  if (epoch !== sessionEpoch)
    throw new DOMException("Oturum değişti", "AbortError");
  if (!response.ok) {
    if (response.status === 401) showLogin();
    const error = new Error(data?.error || "İstek tamamlanamadı.");
    error.status = response.status;
    throw error;
  }
  if (response.status !== 204 && !data)
    throw new Error("Veri yanıtı alınamadı.");
  return data;
}

const modules = setupModules(api, notify);
function params() {
  return new URLSearchParams({
    month: $("month").value,
    device: $("device").value,
  });
}
async function load(initial = false) {
  const revision = ++state.request;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  $("refresh").disabled = true;
  document.body.classList.add("is-loading");
  $("mainContent").setAttribute("aria-busy", "true");
  try {
    const status = await api("/api/status", { signal });
    const selected = params().toString();
    const [reportResult, performanceResult] = await Promise.allSettled([
      api("/api/report?" + selected, { signal }),
      api("/api/performance?" + selected, { signal }),
    ]);
    if (revision !== state.request) return;
    if (performanceResult.status === "rejected") throw performanceResult.reason;
    const performance = performanceResult.value;
    const report =
      reportResult.status === "fulfilled"
        ? reportResult.value
        : unavailableReport(performance, reportResult.reason.message);
    state.status = status;
    state.report = report;
    state.performance = performance;
    state.loaded = {};
    state.queryPage = 1;
    $("loginScreen").hidden = true;
    $("app").hidden = false;
    document.querySelector(".skip-link").href = "#mainContent";
    notify();
    render();
    setView(
      views[location.hash.slice(1)] ? location.hash.slice(1) : state.view,
      false,
    );
  } catch (error) {
    if (revision !== state.request || error.name === "AbortError") return;
    if (error.status !== 401)
      notify(
        error.message +
          (state.report ? " Ekranda önceki başarılı yükleme korunuyor." : ""),
      );
    if (!initial && state.status) {
      $("freshness").className = "freshness error";
      $("freshness").replaceChildren(
        node("span", null, "status-dot"),
        node("span", "Yenileme başarısız"),
      );
    }
  } finally {
    if (revision === state.request) {
      $("refresh").disabled = false;
      document.body.classList.remove("is-loading");
      $("mainContent").removeAttribute("aria-busy");
    }
  }
}
function unavailableReport(data, error) {
  return {
    period: data.period,
    previous_period: data.previous_period,
    created_at: data.measured_at,
    filters: { device: data.device },
    missing: ["Aylık SEO analizi alınamadı: " + error],
    sources: data.archive,
    products: data.catalog.map((p) => ({
      ...p,
      url_verified: !!p.url_verified_at,
      current: null,
      previous: null,
      decision: "Veri bekle",
      reason:
        "SEO analizine şu anda erişilemiyor. Grafik yalnız bağımsız doğrulanmış günlük kayıtları gösterir.",
      confidence: "yetersiz",
      risk: "Kanıt oluşmadan SEO değişikliği yapmayın.",
      devices: [],
      queries: [],
      brand: {
        brand: null,
        non_brand: null,
        note: "Sorgu analizi henüz doğrulanmadı.",
      },
      evidence: [],
      missing: ["SEO analizi alınamadı; kesin öneri üretilmedi."],
      comparisons: {},
    })),
  };
}
function render() {
  renderNotice();
  renderKpis();
  renderChart();
  renderCoverage();
  renderPriorities();
  renderSources();
  const report = state.report;
  const groups = [...new Set(report.products.map((p) => p.group_name))];
  const selected = $("groupFilter").value;
  $("groupFilter").replaceChildren(
    new Option("Tüm ürün grupları", ""),
    ...groups.map((g) => new Option(g, g)),
  );
  $("groupFilter").value = groups.includes(selected) ? selected : "";
  const product = $("queryProduct").value;
  $("queryProduct").replaceChildren(
    new Option("Tüm ürünler", ""),
    ...report.products.map((p) => new Option(p.name, p.id)),
  );
  $("queryProduct").value = report.products.some((p) => p.id === product)
    ? product
    : "";
  renderProducts();
  $("productPeriod").textContent =
    period(report.period) +
    " · " +
    deviceName(report.filters?.device) +
    ". Kısmi ölçüm, tamamlanmış aylık karşılaştırma değildir.";
  $("export").href = "/api/export?" + params().toString();
}
function renderNotice() {
  const data = state.performance,
    report = state.report,
    status = state.status,
    coverage = data.coverage;
  const fresh = status.google_connected && data.fresh;
  const label = !status.google_connected
    ? "Google bağlantısı bekleniyor"
    : status.sync_budget?.paused
      ? "Günlük bütçe koruması etkin"
      : fresh
        ? "Veriler güncel"
        : "Veri güncelliği kontrol edilmeli";
  $("freshness").className =
    "freshness " + (fresh && !status.sync_budget?.paused ? "good" : "wait");
  $("freshness").replaceChildren(
    node("span", null, "status-dot"),
    node("span", label),
  );
  const title = !status.google_connected
    ? data.current
      ? "Google bağlantısı kapalı; doğrulanmış arşiv ölçümleri gösteriliyor."
      : "Google bağlantısı yok; gerçek arama verisi bekleniyor."
    : !coverage.complete
      ? `Bu dönem kısmen doğrulandı · ${coverage.verified_days}/${coverage.expected_days} gün.`
      : report.missing.length
        ? "Ölçümler mevcut; SEO kararı için ek kanıt bekleniyor."
        : "Veriler doğrulandı. Başarılı çalışmaları koruyun.";
  const description = !status.google_connected
    ? data.current
      ? "Arşiv ölçümleri son doğrulama tarihine aittir; güncel Google erişimi veya yeni veri alındığı anlamına gelmez."
      : "Bağlantı kurulana kadar KPI ve grafikler veri yok olarak gösterilir. Keyword Planner arşivi ayrı bir kaynaktır."
    : !coverage.complete
      ? "Yalnız doğrulanmış günlerin ölçümleri gösterilir. Eksik günler boş bırakılır; tam aylık değişim hesaplanmaz."
      : report.missing.length
        ? "Cihaz, sorgu veya önceki dönem kapsamındaki eksikler kanıt ayrıntılarında görünür."
        : "GSC ölçümleri gözlemseldir; tek başına kesin neden göstermez.";
  const body = node("div");
  body.append(node("strong", title), node("p", description));
  if (report.missing.length)
    body.append(detail("Eksik kanıtları gör", list(report.missing)));
  $("status").className =
    "data-notice" +
    (!report.missing.length && coverage.measurement_complete && data.fresh
      ? " good"
      : "");
  $("status").replaceChildren(
    icon(report.missing.length ? "info" : "shield"),
    body,
  );
}
function renderKpis() {
  const data = state.performance;
  const config = [
    ["clicks", "Toplam tıklama", "click"],
    ["impressions", "Toplam gösterim", "eye"],
    ["ctr", "Ortalama CTR", "percent"],
    ["position", "Ortalama konum", "rank"],
  ];
  $("kpis").replaceChildren(
    ...config.map(([key, label, kind]) => {
      const current = data.current?.[key],
        previous = data.previous?.[key];
      const card = node("article", null, "kpi-card"),
        head = node("div", null, "kpi-label");
      head.append(node("span", label), icon(kind));
      const value = node(
        "div",
        current == null
          ? "—"
          : key === "ctr"
            ? percent(current)
            : number(current),
        "kpi-value" + (current == null ? " no-data" : ""),
      );
      value.setAttribute(
        "aria-label",
        label + ": " + (current == null ? "Veri yok" : value.textContent),
      );
      const caption = node("div", null, "kpi-caption");
      if (data.comparison_available && current != null && previous > 0) {
        const change = (current - previous) / previous;
        const better = key === "position" ? change <= 0 : change >= 0;
        caption.append(
          node(
            "span",
            (change > 0 ? "+" : "") + percent(change),
            "delta" + (better ? "" : " down"),
          ),
          node("span", "önceki aya göre"),
        );
      } else
        caption.append(
          node(
            "span",
            current == null
              ? "Doğrulanmış ölçüm yok"
              : `${data.coverage.observed_days ?? data.coverage.verified_days} günlük ölçüm · ${data.coverage.measurement_complete ? "tam kapsam" : "kısmi kapsam"}`,
          ),
        );
      if (key === "position")
        card.title =
          "Gösterimlerle ağırlıklı ortalama. Daha düşük değer daha iyi konumdur.";
      card.append(head, value, caption);
      return card;
    }),
  );
}
function renderChart() {
  const data = state.performance;
  $("chartPeriod").textContent =
    period(data.period) + " · " + deviceName(data.device);
  $("chartCoverage").textContent =
    `${data.coverage.verified_days}/${data.coverage.expected_days} gün doğrulandı` +
    (state.metric === "position"
      ? " · Düşük konum daha iyidir."
      : " · Eksik günler boş bırakılır.");
  drawChart($("performanceChart"), $("chartTable"), data, state.metric);
}
function renderCoverage() {
  const data = state.performance,
    status = state.status;
  const actual = data.coverage.verified_days,
    expected = data.coverage.expected_days,
    ratio = expected ? actual / expected : 0;
  const ring = svg("svg", { viewBox: "0 0 126 126", "aria-hidden": "true" });
  ring.append(svg("circle", { cx: 63, cy: 63, r: 48, class: "track" }));
  if (actual > 0)
    ring.append(
      svg("circle", {
        cx: 63,
        cy: 63,
        r: 48,
        class: "fill",
        "stroke-dasharray": `${ratio * 301.593} 301.593`,
      }),
    );
  const label = node("div", null, "ring-label");
  label.append(
    node("strong", actual + "/" + expected),
    node("span", "gün doğrulandı"),
  );
  $("coverageRing").replaceChildren(ring, label);
  $("coverageRing").setAttribute("role", "img");
  $("coverageRing").setAttribute(
    "aria-label",
    `${expected} günden ${actual} gün doğrulandı`,
  );
  $("coverageText").textContent =
    ratio === 1
      ? "Seçili dönemin günlük sayfa kapsamı tamam. Sorgu ve önceki dönem ayrıca denetlenir."
      : "Güvenilir aylık karşılaştırma için eksik günlerin aktarılması bekleniyor.";
  const done = (status.jobs || [])
    .filter((j) => j.provider === "gsc" && j.status === "done")
    .reduce((n, j) => n + j.jobs, 0);
  const rows = [
    ["Son veri alımı", time(data.last_fetched_at)],
    [
      "Google bağlantısı",
      status.google_connected
        ? data.fresh
          ? "Doğrulandı"
          : "Kayıtlı · sağlık kontrolü"
        : "Bağlı değil",
    ],
    [
      "GSC aktarımı",
      done ? number(done) + " iş tamamlandı" : "Veri bekleniyor",
    ],
  ];
  if (status.sync_budget?.paused)
    rows.push(["Günlük bütçe", "Güvenli bekleme"]);
  $("connectionSummary").replaceChildren(
    ...rows.map(([key, value]) => {
      const r = node("div", null, "connection-row");
      r.append(node("span", key), node("strong", value));
      return r;
    }),
  );
}
function renderPriorities() {
  const products = state.report.products;
  const priorities = products
    .filter((p) => ["İncele", "İyileştir"].includes(p.decision))
    .slice(0, 3);
  $("priorities").replaceChildren(
    ...(priorities.length
      ? priorities.map((p) => {
          const e = node("div", null, "priority-item");
          e.append(node("strong", p.name), node("p", p.reason));
          return e;
        })
      : [
          node(
            "p",
            "Şu an kanıtla desteklenen öncelikli bir SEO değişikliği yok. Eksik veride mevcut çalışmayı koruyun.",
          ),
        ]),
  );
  const protectedProducts = products.filter((p) => p.decision === "Koru");
  $("protect").textContent = protectedProducts.length
    ? protectedProducts.map((p) => p.name).join(", ") +
      ". Başlık, URL veya içerik değişikliğinden önce başarılı sorguları inceleyin."
    : "Başarılı kelimeleri doğrulamak için yeterli Google kanıtı bekleniyor. Veri tamamlanmadan başlık ve URL değişikliği yapmayın.";
}
function renderSources() {
  const report = state.report,
    status = state.status;
  $("summary").replaceChildren(
    ...[
      ["Kaynak dosya", report.sources.csv_files],
      ["Kaynak satır", report.sources.csv_rows],
      ["Ürün", report.products.length],
    ].map(([key, value]) => {
      const e = node("div", null, "stat");
      e.append(node("strong", number(value)), node("span", key));
      return e;
    }),
  );
  const lines = [
    `Google izni: ${status.google_connected ? "kayıtlı; API sağlığı ayrıca denetlenir" : "bağlı değil"}`,
    `GA4: ${status.ga4_configured ? "yapılandırıldı; başarılı erişim ayrıca gerekir" : "yapılandırılmadı"}`,
    `Öncelikli geçmiş: ${status.priority_progress?.start || "bilinmiyor"} – ${status.priority_progress?.end || "bilinmiyor"} · ${status.priority_progress?.completed_datasets ?? "?"}/${status.priority_progress?.expected_datasets ?? "?"} gün/kapsam.`,
    status.sync_budget?.enabled
      ? `Günlük senkron bütçesi: ${number(status.sync_budget.reserved_writes)}/${number(status.sync_budget.write_limit)}. ${status.sync_budget.paused ? "Yeni bütçe bekleniyor: " + time(status.sync_budget.resumes_at) : "Kullanılabilir."}`
      : "",
    `Otomatik toplama: ${status.automation_enabled ? "etkin" : "kapalı"} · Salt okunur tarama: ${status.crawl_enabled ? "etkin" : "kapalı"}`,
    ...(status.jobs || []).map(
      (j) =>
        `${sourceName(j.provider)} · ${statusName(j.status)}: ${j.jobs} iş`,
    ),
    ...(status.recent_sync_runs || [])
      .slice(0, 3)
      .map(
        (r) =>
          `${r.day}/${sourceName(r.scope)} · API sayfası ${r.rows_received} satır · ${time(r.finished_at || r.started_at)} (tamamlanmış ay değildir)`,
      ),
    ...(status.recent_failures || []).map(
      (r) =>
        `${r.day}/${r.scope} · ${r.error_code || "Hata kodu yok"} · ${r.attempts} deneme`,
    ),
    ...(status.health || []).map(
      (h) =>
        `${sourceName(h.provider)} · ${h.day} · ${statusName(h.status)} ${h.code || ""}`,
    ),
    ...(status.coverage || []).map(
      (c) =>
        `${sourceName(c.provider)}/${sourceName(c.scope)}: ${c.earliest} – ${c.latest}, ${c.days} doğrulanmış gün`,
    ),
    status.note,
  ];
  $("health").textContent = lines.filter(Boolean).join("\n");
}
function renderProducts() {
  if (!state.report) return;
  const search = $("productSearch").value.toLocaleLowerCase("tr-TR"),
    decision = $("decisionFilter").value,
    group = $("groupFilter").value,
    sort = state.productSort;
  const products = state.report.products.filter(
    (p) =>
      (p.name + " " + (p.url || ""))
        .toLocaleLowerCase("tr-TR")
        .includes(search) &&
      (!decision || p.decision === decision) &&
      (!group || p.group_name === group),
  );
  products.sort((a, b) => {
    const av =
        sort.key === "name"
          ? a.name
          : sort.key === "decision"
            ? a.decision
            : a.current?.[sort.key],
      bv =
        sort.key === "name"
          ? b.name
          : sort.key === "decision"
            ? b.decision
            : b.current?.[sort.key];
    if (av == null) return bv == null ? 0 : 1;
    if (bv == null) return -1;
    const v = typeof av === "string" ? av.localeCompare(bv, "tr") : av - bv;
    return sort.direction === "asc" ? v : -v;
  });
  const table = node("table");
  sortHeader(
    table,
    [
      { key: "name", label: "Ürün / Sayfa" },
      { key: "clicks", label: "Tıklama", numeric: true },
      { key: "impressions", label: "Gösterim", numeric: true },
      { key: "ctr", label: "CTR", numeric: true },
      { key: "position", label: "Ort. konum", numeric: true },
      { key: "decision", label: "SEO kararı" },
      { label: "Kanıtlar" },
    ],
    sort,
    (key) => {
      state.productSort = {
        key,
        direction:
          sort.key === key && sort.direction === "asc"
            ? "desc"
            : sort.key === key
              ? "asc"
              : ["name", "decision"].includes(key)
                ? "asc"
                : "desc",
      };
      renderProducts();
    },
  );
  const body = node("tbody");
  for (const p of products) {
    const row = node("tr", null, "product");
    const name = node("td"),
      wrap = node("div", null, "row-product"),
      avatar = node(
        "span",
        p.name
          .split(" ")
          .map((w) => w[0])
          .slice(0, 2)
          .join(""),
        "product-avatar",
      ),
      text = node("div");
    text.append(
      node("span", p.name, "cell-name"),
      node(
        "span",
        p.url ? new URL(p.url).pathname : "URL doğrulaması bekleniyor",
        "cell-subtitle",
      ),
    );
    wrap.append(avatar, text);
    name.append(wrap);
    const decisionCell = node("td");
    decisionCell.append(badge(p.decision));
    const action = node("td"),
      button = node("button", "Kanıtları gör", "row-action");
    button.setAttribute("aria-label", p.name + " — Kanıtları gör");
    button.addEventListener("click", () => openProduct(p));
    action.append(button);
    row.append(
      name,
      metricCell(p.current?.clicks),
      metricCell(p.current?.impressions),
      metricCell(p.current?.ctr, "percent"),
      metricCell(p.current?.position),
      decisionCell,
      action,
    );
    body.append(row);
  }
  if (!products.length) {
    const row = node("tr"),
      td = node("td", null, "empty-cell");
    td.colSpan = 7;
    td.append(
      icon("search"),
      node("strong", "Eşleşen ürün bulunamadı"),
      node("span", "Arama veya karar filtrenizi değiştirebilirsiniz."),
    );
    row.append(td);
    body.append(row);
  }
  table.append(body);
  $("products").replaceChildren(table);
  $("productCount").textContent = number(state.report.products.length);
  $("productTableFoot").textContent =
    `${products.length} / ${state.report.products.length} ürün gösteriliyor. — : gözlenen ölçüm yok. Kararlar mevcut analiz motorundan gelir.`;
}
function openProduct(p) {
  const root = $("productDetail");
  $("dialogTitle").textContent = p.name;
  root.replaceChildren(
    badge(p.decision),
    node("p", p.reason),
    siteLink(p.url),
    node("p", p.group_name),
  );
  const metrics = node("div", null, "metrics");
  for (const [key, label] of [
    ["clicks", "Tıklama"],
    ["impressions", "Gösterim"],
    ["ctr", "CTR"],
    ["position", "Ort. konum"],
  ]) {
    const e = node("div");
    e.append(
      node(
        "strong",
        p.current?.[key] == null
          ? "—"
          : key === "ctr"
            ? percent(p.current[key])
            : number(p.current[key]),
      ),
      node("span", label),
    );
    metrics.append(e);
  }
  root.append(metrics, evidenceView(p, state.report), performanceView(p));
  if (p.url) {
    const history = detail("SEO değişiklik geçmişi");
    history.addEventListener("toggle", async () => {
      if (!history.open || history.dataset.loaded) return;
      history.dataset.loaded = "true";
      try {
        const data = await api("/api/history?url=" + encodeURIComponent(p.url));
        history.append(
          node("p", data.note),
          ...data.rows.map(historyEventView),
        );
        if (!data.rows.length)
          history.append(node("p", "Doğrulanmış tarama değişikliği yok."));
      } catch (e) {
        history.dataset.loaded = "";
        history.append(node("p", e.message));
      }
    });
    root.append(history);
  }
  const keywords = detail(
    `Keyword Planner kaynakları · ${p.keyword_sources} dosya / ${p.keyword_rows} satır`,
  );
  keywords.addEventListener("toggle", async () => {
    if (!keywords.open || keywords.dataset.loaded) return;
    keywords.dataset.loaded = "true";
    try {
      const data = await api(
        "/api/keywords?product=" + encodeURIComponent(p.id),
      );
      keywords.append(list(data.notes));
      const sources = node("div", null, "source-list");
      sources.append(
        ...data.rows.map((r) =>
          node(
            "p",
            `${r.keyword} · Yaklaşık aylık arama: ${number(r.avg_monthly_searches)}. Kaynak: ${r.path}, satır ${r.row_number}. Dışa aktarım: ${r.exported_at}. Kapsam: ${r.period_label}.`,
          ),
        ),
      );
      keywords.append(sources);
      if (data.next)
        keywords.append(
          node(
            "p",
            "İlk 50 kelimenin son gözlemi gösteriliyor. Tam kaynak arşivi korunur.",
          ),
        );
    } catch (e) {
      keywords.dataset.loaded = "";
      keywords.append(node("p", e.message));
    }
  });
  root.append(keywords);
  $("productDialog").showModal();
}
async function loadQueries() {
  const revision = ++state.queryRequest;
  queryController?.abort();
  queryController = new AbortController();
  const selected = params();
  selected.set("q", $("querySearch").value);
  selected.set("product", $("queryProduct").value);
  selected.set("brand", $("queryBrand").value);
  selected.set("page", state.queryPage);
  selected.set("sort", state.querySort.key);
  selected.set("direction", state.querySort.direction);
  $("queryTable").setAttribute("aria-busy", "true");
  try {
    const data = await api("/api/performance/queries?" + selected, {
      signal: queryController.signal,
    });
    if (revision !== state.queryRequest) return;
    state.queryHasNext = data.has_next;
    const table = node("table");
    sortHeader(
      table,
      [
        { key: "query", label: "Sorgu / Sayfa" },
        { label: "Cihaz" },
        { key: "clicks", label: "Tıklama", numeric: true },
        { key: "impressions", label: "Gösterim", numeric: true },
        { key: "ctr", label: "CTR", numeric: true },
        { key: "position", label: "Ort. konum", numeric: true },
      ],
      state.querySort,
      (key) => {
        state.querySort = {
          key,
          direction:
            state.querySort.key === key && state.querySort.direction === "desc"
              ? "asc"
              : "desc",
        };
        state.queryPage = 1;
        loadQueries();
      },
    );
    const body = node("tbody");
    for (const row of data.rows) {
      const tr = node("tr"),
        cell = node("td", null, "query-name");
      const label = node("span", row.query, "cell-name");
      const protectedQuery = state.report?.products
        .find((p) => p.url === row.page)
        ?.queries.some((q) => q.query === row.query && q.protect);
      if (protectedQuery) label.append(badge("Koru"));
      cell.append(
        label,
        siteLink(
          row.page,
          row.product_name
            ? row.product_name + " · " + new URL(row.page).pathname
            : row.page,
        ),
        node(
          "span",
          row.is_brand ? "Markalı sorgu" : "Markasız sorgu",
          "cell-subtitle",
        ),
      );
      tr.append(
        cell,
        node("td", deviceName(row.device)),
        metricCell(row.clicks),
        metricCell(row.impressions),
        metricCell(row.ctr, "percent"),
        metricCell(row.position),
      );
      body.append(tr);
    }
    if (!data.rows.length) {
      const tr = node("tr"),
        td = node("td", null, "empty-cell");
      td.colSpan = 6;
      td.append(
        icon("search"),
        node("strong", "Bu kapsamda doğrulanmış sorgu yok"),
        node(
          "span",
          "Bu durum sıfır trafik anlamına gelmez. Dönem, cihaz veya arama filtrenizi kontrol edin.",
        ),
      );
      tr.append(td);
      body.append(tr);
    }
    table.append(body);
    $("queryTable").replaceChildren(table);
    $("queryPage").textContent = state.queryPage + ". sayfa";
    $("queryPrevious").disabled = state.queryPage === 1;
    $("queryNext").disabled = !data.has_next || state.queryPage >= 200;
    $("queryCount").textContent =
      `${data.rows.length} sorgu / URL / cihaz grubu · ${data.verified_days} doğrulanmış gün`;
    const last = data.rows
      .map((r) => r.fetched_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    $("queryNote").textContent =
      data.note +
      " Dönem: " +
      period(data.period) +
      "." +
      (last
        ? " Gösterilen satırlarda son veri alımı: " + time(last) + "."
        : "");
  } catch (e) {
    if (revision === state.queryRequest && e.name !== "AbortError") {
      $("queryTable").replaceChildren(
        empty("Sorgular yüklenemedi", e.message, "search"),
      );
      $("queryNext").disabled = true;
    }
  } finally {
    if (revision === state.queryRequest)
      $("queryTable").removeAttribute("aria-busy");
  }
}
function setView(view, focus = true) {
  if (!views[view]) view = "overview";
  state.view = view;
  for (const key of Object.keys(views)) $("view-" + key).hidden = key !== view;
  document.querySelectorAll("[data-view]").forEach((a) => {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("breadcrumb").textContent = views[view][0];
  $("viewTitle").textContent = views[view][1];
  $("viewDescription").textContent = views[view][2];
  $("periodControl").hidden = ["radar", "changes"].includes(view);
  $("deviceControl").hidden = !["overview", "products", "queries"].includes(
    view,
  );
  $("scopeLabel").textContent =
    view === "radar"
      ? "Son 28 kesinleşmiş gün · GSC"
      : view === "changes"
        ? "Tespit takvimi · UTC"
        : view === "health"
          ? "Bağımsız kaynak denetimi"
          : "Google Search Console · Web araması";
  closeMobile();
  if (!state.report) return;
  if (view === "queries") loadQueries();
  if (modules[view] && !state.loaded[view]) {
    state.loaded[view] = true;
    modules[view]();
  }
  if (focus) {
    history.replaceState(null, "", "#" + view);
    $("mainContent").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}
// Responsive navigation stores only a layout preference, never credentials or data.
const mobile = matchMedia("(max-width:980px)");
try {
  if (localStorage.getItem("mavi-nav-collapsed") === "true")
    document.body.classList.add("is-collapsed");
} catch {}
function closeMobile() {
  const wasOpen = $("sidebar").classList.contains("is-open");
  $("sidebar").classList.remove("is-open");
  $("sidebar").inert = mobile.matches;
  $("sidebar").removeAttribute("role");
  $("sidebar").removeAttribute("aria-modal");
  $("navBackdrop").hidden = true;
  $("appMain").inert = false;
  document.body.classList.remove("modal-open");
  $("sidebarToggle").setAttribute(
    "aria-expanded",
    String(
      !mobile.matches && !document.body.classList.contains("is-collapsed"),
    ),
  );
  $("sidebarToggle").setAttribute(
    "aria-label",
    mobile.matches
      ? "Menüyü aç"
      : document.body.classList.contains("is-collapsed")
        ? "Menüyü genişlet"
        : "Menüyü daralt",
  );
  if (wasOpen) $("sidebarToggle").focus();
}
$("sidebarToggle").addEventListener("click", () => {
  if (mobile.matches) {
    const open = $("sidebar").classList.contains("is-open");
    if (open) {
      closeMobile();
      return;
    }
    $("sidebar").classList.add("is-open");
    $("sidebar").inert = false;
    $("sidebar").setAttribute("role", "dialog");
    $("sidebar").setAttribute("aria-modal", "true");
    $("navBackdrop").hidden = false;
    $("appMain").inert = true;
    document.body.classList.add("modal-open");
    $("sidebarToggle").setAttribute("aria-expanded", "true");
    $("navigation").querySelector("[aria-current=page]")?.focus();
  } else {
    document.body.classList.toggle("is-collapsed");
    try {
      localStorage.setItem(
        "mavi-nav-collapsed",
        document.body.classList.contains("is-collapsed"),
      );
    } catch {}
    closeMobile();
  }
});
$("navBackdrop").addEventListener("click", closeMobile);
mobile.addEventListener("change", closeMobile);
closeMobile();
document.addEventListener("keydown", (e) => {
  if (!$("sidebar").classList.contains("is-open")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeMobile();
  }
  if (e.key === "Tab") {
    const items = [...$("sidebar").querySelectorAll("a,button")].filter(
        (e) => e.getClientRects().length,
      ),
      first = items[0],
      last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
document.querySelectorAll("[data-view]").forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    setView(a.dataset.view);
  }),
);
document.querySelectorAll("[data-go]").forEach((b) =>
  b.addEventListener("click", () => {
    setView(b.dataset.go);
    if (b.dataset.go === "questions") $("questionText").focus();
  }),
);
window.addEventListener("hashchange", () =>
  setView(location.hash.slice(1), false),
);
document.querySelector("#sidebar .brand")?.addEventListener("click", (e) => {
  e.preventDefault();
  setView("overview");
});
$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.currentTarget.querySelector("button");
  button.disabled = true;
  notify();
  try {
    await api("/api/session", {
      method: "POST",
      body: JSON.stringify({ token: $("token").value }),
    });
    $("token").value = "";
    await load();
  } catch (e) {
    notify(e.message);
  } finally {
    button.disabled = false;
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await api("/api/session", { method: "DELETE" });
    showLogin();
    notify();
  } catch (e) {
    notify(e.message);
  }
});
$("refresh").addEventListener("click", () => load());
$("month").addEventListener("change", () => load());
$("device").addEventListener("change", () => load());
for (const id of ["productSearch", "decisionFilter", "groupFilter"])
  $(id).addEventListener(
    id === "productSearch" ? "input" : "change",
    renderProducts,
  );
$("queryFilters").addEventListener("submit", (e) => {
  e.preventDefault();
  state.queryPage = 1;
  loadQueries();
});
$("queryPrevious").addEventListener("click", () => {
  if (state.queryPage > 1) {
    state.queryPage--;
    loadQueries();
  }
});
$("queryNext").addEventListener("click", () => {
  if (state.queryHasNext && state.queryPage < 200) {
    state.queryPage++;
    loadQueries();
  }
});
document.querySelectorAll("[data-metric]").forEach((b) =>
  b.addEventListener("click", () => {
    state.metric = b.dataset.metric;
    document
      .querySelectorAll("[data-metric]")
      .forEach((e) => e.setAttribute("aria-pressed", String(e === b)));
    renderChart();
  }),
);
$("closeDialog").addEventListener("click", () => $("productDialog").close());
$("help").addEventListener("click", () => $("helpDialog").showModal());
$("closeHelp").addEventListener("click", () => $("helpDialog").close());
$("google").addEventListener("click", async () => {
  try {
    const data = await api("/api/oauth/google/start", { method: "POST" }),
      url = new URL(data.authorization_url);
    if (url.origin === "https://accounts.google.com") location.assign(url.href);
  } catch (e) {
    notify(e.message);
  }
});
$("pilot").addEventListener("click", async () => {
  const b = $("pilot");
  b.disabled = true;
  notify("Bir günlük GSC sayfa kaydı kontrol ediliyor…");
  try {
    const result = await api("/api/gsc/pilot", { method: "POST" });
    await load();
    notify(
      `${result.day}: ${statusName(result.status)} · ${result.row_count == null ? "Doğrulama bekleniyor" : number(result.row_count) + " satır"}. ${result.note}`,
    );
  } catch (e) {
    notify(e.message);
  } finally {
    b.disabled = false;
  }
});
$("question").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = e.currentTarget.querySelector("button");
  b.disabled = true;
  notify();
  try {
    const answer = await api("/api/questions", {
      method: "POST",
      body: JSON.stringify({
        question: $("questionText").value,
        month: $("month").value,
        ...(state.questionMonth === $("month").value && state.previousQuestionId
          ? { previous_question_id: state.previousQuestionId }
          : {}),
      }),
    });
    state.previousQuestionId = answer.question_id;
    state.questionMonth = $("month").value;
    const sections = answer.sections;
    $("answer").replaceChildren(
      node("h2", "Kanıta dayalı yanıt"),
      node("h3", "Ne oldu?"),
      node("p", answer.text),
      ...(sections
        ? [
            node("h3", "Olası açıklamalar"),
            list(sections.explanations),
            node("h3", "Ne yapmalıyım?"),
            node("p", sections.action),
            node("p", `Güven düzeyi: ${sections.confidence}`),
          ]
        : []),
      answerView(answer),
    );
    $("answer").hidden = false;
  } catch (e) {
    notify(e.message);
  } finally {
    b.disabled = false;
  }
});
document.querySelectorAll("[data-question]").forEach((b) =>
  b.addEventListener("click", () => {
    $("questionText").value = b.dataset.question;
    $("questionText").focus();
  }),
);
setInterval(() => {
  if (!document.hidden && !$("app").hidden && state.view === "radar")
    modules.radar();
}, 300000);
load(true);
