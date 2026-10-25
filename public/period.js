import { $, node } from "./ui.js";
const KEY = "mavi-dashboard-preferences",
  devices = ["ALL", "MOBILE", "DESKTOP", "TABLET"];
export const currentMonth = () => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return (
    p.find((x) => x.type === "year").value +
    "-" +
    p.find((x) => x.type === "month").value
  );
};
export const monthLabel = (value) =>
  new Intl.DateTimeFormat("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(value + "-01T12:00:00Z"))
    .replace(/^./, (s) => s.toLocaleUpperCase("tr-TR"));
export const scopeParams = () =>
  new URLSearchParams({
    month: $("month").value,
    device: $("device").value,
    rangeMonths: $("rangeMonths").value,
  });
export function setupPeriod(viewNames, onChange) {
  const today = currentMonth(),
    start = new Date(today + "-01T12:00:00Z");
  for (let i = 0; i < 24; i++) {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() - i);
    const v = d.toISOString().slice(0, 7);
    $("month").append(new Option(monthLabel(v), v));
  }
  const allowed = () => [...$("month").options].map((o) => o.value);
  let pref = {};
  try {
    pref = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {}
  $("rangeMonths").value = ["1", "3", "6", "12"].includes(
    String(pref.rangeMonths),
  )
    ? String(pref.rangeMonths)
    : "1";
  $("month").value =
    $("rangeMonths").value === "1" && allowed().includes(pref.month)
      ? pref.month
      : today;
  $("device").value = devices.includes(pref.device) ? pref.device : "ALL";
  let year = Number($("month").value.slice(0, 4));
  function remember(view) {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          month: $("month").value,
          rangeMonths: $("rangeMonths").value,
          device: $("device").value,
          view: viewNames.includes(view) ? view : "overview",
        }),
      );
    } catch {}
  }
  function draw() {
    $("pickerYear").textContent = year;
    const years = allowed().map((v) => Number(v.slice(0, 4)));
    $("previousYear").disabled = year <= Math.min(...years);
    $("nextYear").disabled = year >= Math.max(...years);
    $("monthGrid").replaceChildren(
      ...Array.from({ length: 12 }, (_, i) => {
        const value = year + "-" + String(i + 1).padStart(2, "0"),
          b = node("button", monthLabel(value).split(" ")[0]);
        b.type = "button";
        b.dataset.month = value;
        b.disabled = !allowed().includes(value);
        b.setAttribute("aria-label", monthLabel(value));
        b.setAttribute(
          "aria-pressed",
          String($("rangeMonths").value === "1" && $("month").value === value),
        );
        b.onclick = () => choose(value, "1");
        return b;
      }),
    );
  }
  function sync() {
    year = Number($("month").value.slice(0, 4));
    draw();
    const n = Number($("rangeMonths").value),
      end = $("month").value,
      d = new Date(end + "-01T12:00:00Z");
    d.setUTCMonth(d.getUTCMonth() - n + 1);
    $("selectionMode").textContent =
      n === 1
        ? "Tekil ay · " + monthLabel(end)
        : "Son " +
          n +
          " ay · " +
          monthLabel(d.toISOString().slice(0, 7)) +
          " – " +
          monthLabel(end);
    $("periodHint").textContent =
      n === 1
        ? end === currentMonth()
          ? "Bu ay — kısmi veriler"
          : "Tekil ay modu"
        : n + " ay modu · Mevcut ay dâhil; eksik günler boş bırakılır";
    requestAnimationFrame(() => {
      const b = $("monthGrid").querySelector(
        '[data-month=\"' + $("month").value + '\"]',
      );
      if (b) {
        const r = $("monthGrid").getBoundingClientRect(),
          v = b.getBoundingClientRect();
        if (r.width && (v.left < r.left || v.right > r.right))
          $("monthGrid").scrollLeft +=
            v.left - r.left - r.width / 2 + v.width / 2;
      }
    });
    document
      .querySelectorAll("[data-range]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(b.dataset.range === $("rangeMonths").value),
        ),
      );
  }
  function choose(value, count) {
    if (!allowed().includes(value)) return;
    const changed =
      value !== $("month").value || count !== $("rangeMonths").value;
    $("month").value = value;
    $("rangeMonths").value = count;
    sync();
    if (count === "1")
      $("monthGrid")
        .querySelector('[data-month=\"' + value + '\"]')
        ?.focus({ preventScroll: true });
    if (changed) onChange();
  }
  $("previousYear").onclick = () => {
    year--;
    draw();
  };
  $("nextYear").onclick = () => {
    year++;
    draw();
  };
  document
    .querySelectorAll("[data-range]")
    .forEach(
      (b) => (b.onclick = () => choose(currentMonth(), b.dataset.range)),
    );
  $("monthGrid").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const buttons = [
        ...$("monthGrid").querySelectorAll("button:not(:disabled)"),
      ],
      i = buttons.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : i + (e.key === "ArrowRight" ? 1 : -1);
    buttons[next]?.focus();
  });
  $("month").onchange = () => {
    if (!allowed().includes($("month").value))
      $("month").value = currentMonth();
    $("rangeMonths").value = "1";
    sync();
    onChange();
  };
  $("device").onchange = onChange;
  sync();
  return {
    remember,
    sync,
    view: viewNames.includes(pref.view) ? pref.view : "overview",
  };
}
