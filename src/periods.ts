import { Period, monthPeriod, lastCompleteMonth } from "./analysis";
export function calendarMonth(time = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(time);
  return (
    parts.find((p) => p.type === "year")!.value +
    "-" +
    parts.find((p) => p.type === "month")!.value
  );
}
export function rangeCount(value: string | null) {
  if (value === null) return 1;
  if (!["1", "3", "6", "12"].includes(value)) throw Error("INVALID_RANGE");
  return Number(value);
}
export function selectedPeriods(month: string, months = 1, time = new Date()) {
  if (![1, 3, 6, 12].includes(months)) throw Error("INVALID_RANGE");
  monthPeriod(month);
  if (month < "2020-01" || month > calendarMonth(time))
    throw Error("INVALID_MONTH");
  const make = (anchor: string): Period => {
    const last = monthPeriod(anchor),
      first = monthPeriod(anchor, 1 - months);
    return {
      start: first.start,
      end: last.end,
      days:
        Math.round(
          (Date.parse(last.end) - Date.parse(first.start)) / 86400_000,
        ) + 1,
      label: anchor,
    };
  };
  return {
    period: make(month),
    previous: make(monthPeriod(month, -months).label),
    months,
  };
}
export function periodSelection(params: URLSearchParams, time = new Date()) {
  const month = params.get("month") || lastCompleteMonth(time),
    months = rangeCount(params.get("rangeMonths"));
  const result = selectedPeriods(month, months, time);
  return {
    month,
    ...result,
    options: {
      device: params.get("device"),
      ...(months > 1
        ? { current: result.period, previous: result.previous }
        : {}),
    },
  };
}
