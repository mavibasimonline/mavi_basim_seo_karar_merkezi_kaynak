import { it, expect } from "vitest";
import {
  selectedPeriods,
  rangeCount,
  calendarMonth,
  periodSelection,
} from "../src/periods";
const NOW = new Date("2026-10-25T09:00:00Z");
it("defines 3 calendar months including the anchor and the preceding equal-month window", () => {
  const r = selectedPeriods("2026-10", 3, NOW);
  expect(r.period).toMatchObject({
    start: "2026-08-01",
    end: "2026-10-31",
    days: 92,
  });
  expect(r.previous).toMatchObject({
    start: "2026-05-01",
    end: "2026-07-31",
    days: 92,
  });
});
it("handles year boundaries and leap days without approximating months as 30 days", () => {
  expect(selectedPeriods("2024-02", 3, NOW).period).toMatchObject({
    start: "2023-12-01",
    end: "2024-02-29",
    days: 91,
  });
  expect(selectedPeriods("2024-02", 12, NOW).period.days).toBe(366);
  expect(selectedPeriods("2026-10", 6, NOW).period).toMatchObject({
    start: "2026-05-01",
    days: 184,
  });
});
it("rejects malformed ranges and future anchors", () => {
  for (const v of ["0", "2", "24", "3.0", "03", "3 OR 1=1", "NaN", ""])
    expect(() => rangeCount(v)).toThrow("INVALID_RANGE");
  expect(() => selectedPeriods("2026-11", 3, NOW)).toThrow("INVALID_MONTH");
  expect(rangeCount(null)).toBe(1);
});
it("uses the business calendar at the Istanbul month boundary and preserves legacy monthly options", () => {
  const time = new Date("2026-10-31T22:00:00Z");
  expect(calendarMonth(time)).toBe("2026-11");
  expect(() => selectedPeriods("2026-11", 1, time)).not.toThrow();
  expect(
    periodSelection(
      new URLSearchParams({ month: "2026-09", device: "MOBILE" }),
      NOW,
    ).options,
  ).toEqual({ device: "MOBILE" });
});
