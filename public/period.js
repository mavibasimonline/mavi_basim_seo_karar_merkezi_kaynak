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
  const years = [...new Set(allowed().map((v) => v.slice(0, 4)))];
  $("pickerYear").replaceChildren(...years.map((v) => new Option(v, v)));
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
    const focusedMonth = document.activeElement?.dataset?.month;
    $("pickerYear").value = String(year);
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
    if (focusedMonth)
      $("monthGrid")
        .querySelector('[data-month="' + focusedMonth + '"]')
        ?.focus({ preventScroll: true });
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
        const track = $("toolbarTrack"),
          r = track.getBoundingClientRect(),
          v = b.getBoundingClientRect();
        if (r.width && (v.left < r.left || v.right > r.right))
          track.scrollLeft += v.left - r.left - r.width / 2 + v.width / 2;
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
    $("rangeLabel").textContent = n === 1 ? "Dönem" : n + " Ay";
    $("rangeToggle").classList.toggle("is-selected", n !== 1);
  }
  function choose(value, count) {
    if (!allowed().includes(value)) return;
    const changed =
      value !== $("month").value || count !== $("rangeMonths").value;
    $("month").value = value;
    $("rangeMonths").value = count;
    $("rangeMenu").open = false;
    sync();
    if (count === "1")
      $("monthGrid")
        .querySelector('[data-month=\"' + value + '\"]')
        ?.focus({ preventScroll: true });
    if (changed) onChange();
  }
  $("pickerYear").onchange = () => {
    const target = $("pickerYear").value + $("month").value.slice(4),
      available = allowed().filter((v) => v.startsWith($("pickerYear").value));
    if (!available.length) return sync();
    choose(available.includes(target) ? target : available[0], "1");
  };
  document.querySelectorAll("[data-range]").forEach((b) => {
    b.onclick = () => {
      choose(currentMonth(), b.dataset.range);
      $("rangeToggle").focus({ preventScroll: true });
    };
  });
  document.addEventListener("click", (e) => {
    if (!$("rangeMenu").contains(e.target)) $("rangeMenu").open = false;
  });
  function positionRangeMenu() {
    const anchor = $("rangeToggle").getBoundingClientRect();
    $("rangeMenu").style.setProperty("--menu-top", anchor.bottom + 6 + "px");
    $("rangeMenu").style.setProperty(
      "--menu-left",
      Math.max(8, Math.min(innerWidth - 138, anchor.right - 130)) + "px",
    );
  }
  $("rangeMenu").addEventListener("toggle", positionRangeMenu);
  $("toolbarTrack").addEventListener(
    "scroll",
    () => {
      if (!$("rangeMenu").open) return;
      const anchor = $("rangeToggle").getBoundingClientRect(),
        track = $("toolbarTrack").getBoundingClientRect();
      if (anchor.right <= track.left || anchor.left >= track.right)
        $("rangeMenu").open = false;
      else positionRangeMenu();
    },
    { passive: true },
  );
  addEventListener("resize", positionRangeMenu);
  $("rangeMenu").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      $("rangeMenu").open = false;
      $("rangeToggle").focus({ preventScroll: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    $("rangeMenu").open = true;
    const buttons = [...$("rangeMenu").querySelectorAll("button")],
      i = buttons.indexOf(e.target),
      next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : i < 0
              ? e.key === "ArrowDown"
                ? 0
                : buttons.length - 1
              : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length;
    buttons[next].focus();
  });
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
