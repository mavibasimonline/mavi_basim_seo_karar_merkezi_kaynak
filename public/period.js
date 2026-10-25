import { $, node } from "./ui.js";
const KEY = "mavi-dashboard-preferences";
const devices = ["ALL", "MOBILE", "DESKTOP", "TABLET"];
export const currentMonth = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return (
    parts.find((p) => p.type === "year").value +
    "-" +
    parts.find((p) => p.type === "month").value
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
export function setupPeriod(viewNames, onChange) {
  const today = currentMonth(),
    start = new Date(today + "-01T12:00:00Z");
  for (let i = 0; i < 24; i++) {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() - i);
    const value = d.toISOString().slice(0, 7);
    $("month").append(new Option(monthLabel(value), value));
  }
  const allowed = () => [...$("month").options].map((o) => o.value);
  let pref = {};
  try {
    pref = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {}
  $("month").value = allowed().includes(pref.month) ? pref.month : today;
  $("device").value = devices.includes(pref.device) ? pref.device : "ALL";
  let year = Number($("month").value.slice(0, 4));
  function remember(view) {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          month: $("month").value,
          device: $("device").value,
          view: viewNames.includes(view) ? view : "overview",
        }),
      );
    } catch {}
  }
  function sync() {
    $("monthLabel").textContent = monthLabel($("month").value);
    $("monthToggle").setAttribute(
      "aria-label",
      "Rapor dönemi: " + monthLabel($("month").value),
    );
    $("periodHint").textContent =
      $("month").value === currentMonth()
        ? "Bu ay — kısmi veriler"
        : "Seçili ayın doğrulanmış ölçümleri";
    const values = allowed(),
      i = values.indexOf($("month").value);
    $("nextMonth").disabled = i <= 0;
    $("previousMonth").disabled = i === values.length - 1;
  }
  function choose(value) {
    if (!allowed().includes(value)) return;
    const changed = $("month").value !== value;
    $("month").value = value;
    sync();
    $("monthPicker").hidePopover();
    $("monthToggle").focus();
    if (changed) onChange();
  }
  function draw() {
    $("pickerYear").textContent = String(year);
    const years = allowed().map((v) => Number(v.slice(0, 4)));
    $("previousYear").disabled = year <= Math.min(...years);
    $("nextYear").disabled = year >= Math.max(...years);
    $("monthGrid").replaceChildren(
      ...Array.from({ length: 12 }, (_, i) => {
        const value = year + "-" + String(i + 1).padStart(2, "0"),
          b = node("button", monthLabel(value).split(" ")[0]);
        b.type = "button";
        b.disabled = !allowed().includes(value);
        b.dataset.month = value;
        b.setAttribute("aria-label", monthLabel(value));
        b.setAttribute("aria-pressed", String(value === $("month").value));
        b.addEventListener("click", () => choose(value));
        return b;
      }),
    );
  }
  $("monthPicker").addEventListener("toggle", (e) => {
    const open = e.newState === "open";
    $("monthToggle").setAttribute("aria-expanded", String(open));
    if (open) {
      year = Number($("month").value.slice(0, 4));
      draw();
      const r = $("monthToggle").getBoundingClientRect();
      $("monthPicker").style.top = r.bottom + 8 + "px";
      $("monthPicker").style.left =
        Math.max(12, Math.min(r.left, innerWidth - 300 - 12)) + "px";
      $("monthGrid").querySelector('[aria-pressed="true"]')?.focus();
    }
  });
  $("monthPicker").addEventListener("keydown", (e) => {
    const b = e.target.closest("[data-month]");
    if (
      b &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    ) {
      e.preventDefault();
      const all = [...$("monthGrid").querySelectorAll("button")],
        i = all.indexOf(b),
        delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[
          e.key
        ],
        target = all[i + delta];
      if (target && !target.disabled) target.focus();
    }
  });
  $("previousYear").onclick = () => {
    year--;
    draw();
  };
  $("nextYear").onclick = () => {
    year++;
    draw();
  };
  $("previousMonth").onclick = () =>
    choose(allowed()[allowed().indexOf($("month").value) + 1]);
  $("nextMonth").onclick = () =>
    choose(allowed()[allowed().indexOf($("month").value) - 1]);
  // Backing select also supports automation and assistive integrations; the visible picker is a single button.
  $("month").addEventListener("change", () => {
    if (!allowed().includes($("month").value))
      $("month").value = currentMonth();
    sync();
    onChange();
  });
  $("device").addEventListener("change", onChange);
  sync();
  return {
    sync,
    remember,
    view: viewNames.includes(pref.view) ? pref.view : "overview",
  };
}
