import {
  node,
  svg,
  number,
  percent,
  date,
  empty,
  metricCell,
  time,
} from "./ui.js";
export const metricNames = {
  clicks: "Tıklama",
  impressions: "Gösterim",
  ctr: "CTR",
  position: "Ortalama konum",
};
export function drawChart(root, tableRoot, data, metric = "clicks") {
  root.replaceChildren();
  tableRoot.replaceChildren();
  root.setAttribute("aria-busy", "false");
  root.onpointermove =
    root.onpointerleave =
    root.onkeydown =
    root.onfocus =
    root.onblur =
      null;
  root.removeAttribute("tabindex");
  root.removeAttribute("aria-label");
  const series = data?.series || [],
    value = (r) => {
      const v = r.verified ? r.metrics?.[metric] : null;
      return Number.isFinite(v) ? v : null;
    },
    observed = series.filter((r) => value(r) !== null);
  const format = (v) => (metric === "ctr" ? percent(v) : number(v));
  if (!observed.length) {
    root.append(
      empty(
        "Doğrulanmış GSC verisi bekleniyor",
        "Bu dönem ve cihaz için ölçüm yok. Eksik günler örnek değerlerle veya sıfırla doldurulmaz.",
      ),
    );
    tableRoot.append(
      node("p", "Günlük tablo için doğrulanmış ölçüm yok.", "empty-message"),
    );
    return;
  }
  const width = 760,
    height = 248,
    left = 46,
    right = 18,
    top = 18,
    bottom = 30,
    innerW = width - left - right,
    innerH = height - top - bottom;
  const maximum = Math.max(1, ...observed.map(value)) * 1.12,
    x = (i) =>
      left + (series.length > 1 ? i / (series.length - 1) : 0.5) * innerW,
    y = (v) => top + (1 - v / maximum) * innerH;
  const plot = svg("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": `${metricNames[metric]}: ${observed.length} gözlenen gün. Eksik günler boş bırakıldı.`,
  });
  plot.append(
    svg("title", {}, "Google Search Console · " + metricNames[metric]),
  );
  const defs = svg("defs"),
    gradient = svg("linearGradient", {
      id: "chartWash",
      x1: 0,
      x2: 0,
      y1: 0,
      y2: 1,
    });
  gradient.append(
    svg("stop", {
      offset: "0%",
      "stop-color": "#386fe9",
      "stop-opacity": ".13",
    }),
    svg("stop", {
      offset: "100%",
      "stop-color": "#386fe9",
      "stop-opacity": ".01",
    }),
  );
  defs.append(gradient);
  plot.append(defs);
  for (let i = 0; i < 5; i++) {
    const v = (maximum * i) / 4,
      pos = y(v);
    plot.append(
      svg("line", {
        x1: left,
        y1: pos,
        x2: width - right,
        y2: pos,
        class: "chart-gridline",
      }),
      svg(
        "text",
        { x: left - 10, y: pos + 4, "text-anchor": "end", class: "chart-axis" },
        format(v),
      ),
    );
  }
  const ticks = [
    ...new Set([
      0,
      Math.round((series.length - 1) / 4),
      Math.round((series.length - 1) / 2),
      Math.round((3 * (series.length - 1)) / 4),
      series.length - 1,
    ]),
  ];
  for (const i of ticks)
    plot.append(
      svg(
        "text",
        {
          x: x(i),
          y: height - 6,
          "text-anchor": "middle",
          class: "chart-axis",
        },
        date(series[i].day).split(" ").slice(0, 2).join(" "),
      ),
    );
  let segment = [];
  const finish = () => {
    if (!segment.length) return;
    const d = segment
      .map(
        ([i, v], j) =>
          (j ? "L" : "M") + x(i).toFixed(2) + "," + y(v).toFixed(2),
      )
      .join(" ");
    if (segment.length > 1) {
      const first = segment[0][0],
        last = segment.at(-1)[0];
      plot.append(
        svg("path", {
          d: d + ` L${x(last)},${y(0)} L${x(first)},${y(0)} Z`,
          class: "chart-area",
        }),
        svg("path", { d, class: "chart-line", "data-segment": "verified" }),
      );
    }
    segment = [];
  };
  series.forEach((r, i) => {
    const v = value(r);
    if (v === null) {
      finish();
      return;
    }
    segment.push([i, v]);
  });
  finish();
  const points = [];
  series.forEach((r, i) => {
    const v = value(r);
    if (v !== null) {
      const point = svg("circle", {
        cx: x(i),
        cy: y(v),
        r: 3.2,
        class: "chart-point",
        "data-day": r.day,
        "data-value": v,
      });
      plot.append(point);
      points.push([i, point]);
    }
  });
  const crosshair = svg("line", {
    x1: left,
    y1: top,
    x2: left,
    y2: height - bottom,
    class: "chart-crosshair",
    visibility: "hidden",
  });
  plot.append(crosshair);
  root.append(plot);
  const tooltip = node("div", null, "chart-tooltip");
  tooltip.hidden = true;
  tooltip.setAttribute("role", "status");
  root.append(tooltip);
  root.tabIndex = 0;
  root.setAttribute("role", "group");
  root.setAttribute(
    "aria-label",
    "Günlük performans grafiği. Günleri incelemek için sol ve sağ ok tuşlarını kullanın.",
  );
  let active = observed.length ? series.findIndex((r) => value(r) !== null) : 0;
  const select = (i) => {
    active = Math.max(0, Math.min(series.length - 1, i));
    const row = series[active],
      v = value(row);
    tooltip.replaceChildren(
      node("span", date(row.day)),
      node(
        "strong",
        v === null
          ? "Veri yok"
          : format(v) + " " + (metric === "ctr" ? "" : metricNames[metric]),
      ),
      node(
        "span",
        v === null
          ? "Bu gün için doğrulanmış ölçüm yok."
          : "GSC · " + time(row.fetched_at),
      ),
    );
    tooltip.hidden = false;
    crosshair.setAttribute("x1", x(active));
    crosshair.setAttribute("x2", x(active));
    crosshair.setAttribute("visibility", "visible");
    points.forEach(([index, p]) =>
      p.classList.toggle("active", index === active),
    );
  };
  root.onpointermove = (e) => {
    const rect = plot.getBoundingClientRect();
    select(
      Math.round(
        ((((e.clientX - rect.left) / rect.width) * width - left) / innerW) *
          (series.length - 1),
      ),
    );
  };
  root.onpointerleave = () => {
    tooltip.hidden = true;
    crosshair.setAttribute("visibility", "hidden");
    points.forEach(([, p]) => p.classList.remove("active"));
  };
  root.onkeydown = (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      select(
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? series.length - 1
            : active + (e.key === "ArrowRight" ? 1 : -1),
      );
    }
    if (e.key === "Escape") root.onpointerleave();
  };
  root.onfocus = () => select(active);
  root.onblur = () => root.onpointerleave();
  const table = node("table"),
    head = node("thead"),
    tr = node("tr");
  for (const label of [
    "Gün",
    "Tıklama",
    "Gösterim",
    "CTR",
    "Ort. konum",
    "Kaynak zamanı",
  ]) {
    const th = node("th", label);
    th.scope = "col";
    tr.append(th);
  }
  head.append(tr);
  table.append(head);
  const body = node("tbody");
  for (const row of series) {
    const tr = node("tr");
    tr.append(
      node("td", date(row.day)),
      metricCell(row.metrics?.clicks),
      metricCell(row.metrics?.impressions),
      metricCell(row.metrics?.ctr, "percent"),
      metricCell(row.metrics?.position),
      node("td", row.verified ? time(row.fetched_at) : "Veri bekleniyor"),
    );
    body.append(tr);
  }
  table.append(body);
  tableRoot.append(table);
}
