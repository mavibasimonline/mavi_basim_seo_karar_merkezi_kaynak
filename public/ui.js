export const $ = (id) => document.getElementById(id);
export const node = (tag, text, className) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (className) e.className = className;
  return e;
};
export const number = (value) =>
  value == null || !Number.isFinite(Number(value))
    ? "Veri yok"
    : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(
        value,
      );
export const percent = (value) =>
  value == null || !Number.isFinite(Number(value))
    ? "Veri yok"
    : new Intl.NumberFormat("tr-TR", {
        style: "percent",
        maximumFractionDigits: 2,
      }).format(value);
export const deviceName = (v) =>
  ({
    MOBILE: "Mobil",
    DESKTOP: "Masaüstü",
    TABLET: "Tablet",
    ALL: "Tüm cihazlar",
  })[v] ||
  v ||
  "Tüm cihazlar";
export const date = (v) => {
  const d = new Date(v);
  return v && Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("tr-TR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(d)
    : "Bilinmiyor";
};
export const time = (v) => {
  const d = new Date(v);
  return v && Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat("tr-TR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Istanbul",
      }).format(d) + " (TSİ)"
    : "Henüz yok";
};
export const period = (p) =>
  p ? date(p.start) + " – " + date(p.end) : "Dönem bilgisi yok";
export const sourceName = (v) =>
  ({
    gsc: "Search Console",
    ga4: "Google Analytics 4",
    page: "Sayfa",
    query: "Sorgu",
    organic: "Organik trafik",
    "data-integrity": "Veri doğruluğu",
    "sync-audit": "Aktarım kontrolü",
    scheduler: "Zamanlayıcı",
    planner: "Günlük plan",
    "sync-budget": "Yazma bütçesi",
  })[v] || v;
export const statusName = (v) =>
  ({
    ok: "Başarılı",
    done: "Tamamlandı",
    pending: "Sırada",
    running: "İşleniyor",
    retry: "Tekrar denenecek",
    blocked: "Erişim bekleniyor",
    partial: "Kısmi",
    queued: "Planlandı",
    failed: "Başarısız",
    measured: "Ölçüldü",
  })[v] || v;
export const svg = (tag, attrs = {}, text) => {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  return e;
};
export const icon = (name) => {
  const e = svg("svg", { class: "icon", "aria-hidden": "true" });
  e.append(svg("use", { href: "/icons.svg#" + name }));
  return e;
};
export function detail(title, ...contents) {
  const e = node("details");
  e.append(node("summary", title), ...contents);
  return e;
}
export const list = (values) => {
  const e = node("ul");
  (values || []).forEach((v) => e.append(node("li", v)));
  return e;
};
export function badge(text) {
  return node(
    "span",
    text,
    "badge " +
      ({ Koru: "koru", İncele: "incele", İyileştir: "improve" }[text] || ""),
  );
}
export function siteLink(url, label = url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && parsed.hostname === "mavibasim.com") {
      const a = node("a", label);
      a.href = parsed.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      return a;
    }
  } catch {}
  return node("span", label || "URL doğrulanmadı");
}
export const empty = (title, text, kind = "chart") => {
  const e = node("div", null, "chart-empty");
  e.append(icon(kind), node("h3", title), node("p", text));
  return e;
};
export function sortHeader(table, columns, current, onSort) {
  const thead = node("thead"),
    tr = node("tr");
  for (const c of columns) {
    const th = node("th", null, c.numeric ? "numeric" : "");
    th.scope = "col";
    if (c.key) {
      th.setAttribute(
        "aria-sort",
        current.key === c.key
          ? current.direction === "asc"
            ? "ascending"
            : "descending"
          : "none",
      );
      const b = node("button");
      b.type = "button";
      b.setAttribute("aria-label", c.label + " sütununa göre sırala");
      b.append(
        node("span", c.label),
        node(
          "span",
          current.key === c.key
            ? current.direction === "asc"
              ? "↑"
              : "↓"
            : "↕",
          "sort-indicator",
        ),
      );
      if (current.key === c.key) b.classList.add("sort-active");
      b.addEventListener("click", () => onSort(c.key));
      th.append(b);
    } else th.textContent = c.label;
    tr.append(th);
  }
  thead.append(tr);
  table.append(thead);
}
export function metricCell(value, type = "number") {
  const td = node("td", null, "numeric");
  td.textContent =
    value == null ? "—" : type === "percent" ? percent(value) : number(value);
  if (value == null) td.setAttribute("aria-label", "Veri yok");
  return td;
}
