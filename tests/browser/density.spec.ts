import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { chartFixtures } from "./dashboard-fixtures";
const token = readFileSync(".dev.vars", "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("ADMIN_TOKEN="))!
  .slice(12);
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Erişim anahtarı").fill(token);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.locator("#app")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function products(page: Page) {
  if (
    (await page.locator("#sidebarToggle").getAttribute("aria-label")) ===
    "Menüyü aç"
  )
    await page.locator("#sidebarToggle").click();
  await page
    .getByRole("navigation", { name: "Ana menü" })
    .getByRole("link", { name: "Ürün Performansı", exact: true })
    .click();
  await expect(page.locator("#products tbody tr.product")).toHaveCount(29);
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-25T09:00:00+03:00"));
});

test("selected month stays white on blue during hover, keyboard focus and active pointer; normal and disabled states remain readable", async ({
  page,
}) => {
  await login(page);
  const selected = page.getByRole("button", { name: "Ekim 2026", exact: true });
  async function selectedIsReadable() {
    const c = await selected.evaluate((b) => {
      const s = getComputedStyle(b);
      let opacity = 1;
      for (let el: Element | null = b; el; el = el.parentElement)
        opacity *= Number(getComputedStyle(el).opacity);
      return { color: s.color, background: s.backgroundColor, opacity };
    });
    expect(c.color).toBe("rgb(255, 255, 255)");
    expect(["rgb(39, 92, 231)", "rgb(33, 76, 185)"]).toContain(c.background);
    expect(c.opacity).toBe(1);
  }
  await selectedIsReadable();
  const normal = page.getByRole("button", { name: "Ocak 2026", exact: true });
  await normal.hover();
  await expect(normal).toHaveCSS("background-color", "rgb(237, 242, 255)");
  await expect(normal).toHaveCSS("color", "rgb(64, 81, 109)");
  await selected.hover();
  await selectedIsReadable();
  await selected.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(selected).toBeFocused();
  expect(await selected.evaluate((b) => b.matches(":focus-visible"))).toBe(
    true,
  );
  await expect(selected).toHaveCSS("outline-style", "solid");
  await selectedIsReadable();
  const box = (await selected.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await selectedIsReadable();
  await page.screenshot({
    path: ".local/density-month-active-" + test.info().project.name + ".png",
    fullPage: false,
  });
  await page.mouse.up();
  const disabled = page.getByRole("button", {
    name: "Aralık 2026",
    exact: true,
  });
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveCSS("opacity", "1");
  await expect(disabled).toHaveCSS("color", "rgb(117, 129, 150)");
  await expect(disabled).toHaveCSS("background-color", "rgb(241, 244, 248)");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    axe.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
});

test("month strip alone scrolls, has 4-6 px gaps and readable equal buttons; right controls stay visible", async ({
  page,
}) => {
  await login(page);
  const desktop = test.info().project.name === "desktop";
  for (const width of desktop ? [1280, 1440, 1920] : [320, 360, 393, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.evaluate(() => {
      const strip = document.getElementById("monthGrid")!;
      const r = strip.getBoundingClientRect();
      const months = Array.from(strip.querySelectorAll("button")).map((b) => {
        const text = document.createRange();
        text.selectNodeContents(b);
        return {
          box: b.getBoundingClientRect(),
          textWidth: text.getBoundingClientRect().width,
          border: getComputedStyle(b).borderTopWidth,
        };
      });
      const bounds = ["pickerYear", "rangeToggle", "device", "freshness"]
        .map((id) => document.getElementById(id)!.getBoundingClientRect())
        .concat(
          document.querySelector(".topbar .avatar")!.getBoundingClientRect(),
        );
      return {
        noOverflow: document.documentElement.scrollWidth <= innerWidth,
        controlsVisible: bounds.every(
          (b) => b.left >= 0 && b.right <= innerWidth,
        ),
        allMonthsVisible: months.every(
          (m) => m.box.left >= r.left && m.box.right <= r.right,
        ),
        gaps: months.slice(1).map((m, i) => m.box.left - months[i].box.right),
        readable: months.every(
          (m) => m.textWidth <= m.box.width - 2 && m.border === "1px",
        ),
        yearGap:
          r.left -
          document.getElementById("pickerYear")!.getBoundingClientRect().right,
        periodGap:
          document.getElementById("rangeToggle")!.getBoundingClientRect().left -
          r.right,
      };
    });
    expect(layout.noOverflow).toBe(true);
    expect(layout.controlsVisible).toBe(true);
    expect(layout.readable).toBe(true);
    expect(layout.gaps.every((g) => g >= 4 && g <= 6)).toBe(true);
    if (desktop) {
      expect(layout.allMonthsVisible).toBe(true);
      expect(layout.yearGap).toBeGreaterThanOrEqual(6);
      expect(layout.periodGap).toBeGreaterThanOrEqual(6);
    }
    await page
      .getByRole("button", { name: "Ocak 2026", exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Ocak 2026", exact: true }).click();
    await expect(page.locator("#month")).toHaveValue("2026-01");
    await expect(page.locator("#chartPeriod")).toContainText("01 Oca 2026");
    await expect(page.locator("#mainContent")).not.toHaveAttribute("aria-busy");
    await page
      .getByRole("button", { name: "Ekim 2026", exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Ekim 2026", exact: true }).click();
    await expect(page.locator("#month")).toHaveValue("2026-10");
    await expect(page.locator("#chartPeriod")).toContainText("01 Eki 2026");
    await expect(page.locator("#mainContent")).not.toHaveAttribute("aria-busy");
    if (width === 1440 || width === 393)
      await page.screenshot({
        path: ".local/density-overview-" + test.info().project.name + ".png",
        fullPage: true,
        animations: "disabled",
      });
  }
});

test("product rows measure 56-64 px with aligned cells, compact filters and unchanged sorting/search/decision controls", async ({
  page,
}) => {
  await login(page);
  await products(page);
  const layout = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#products tr.product"));
    const filters = document
        .querySelector(".product-controls")!
        .getBoundingClientRect(),
      head = document.querySelector("#products thead")!.getBoundingClientRect();
    return {
      heights: rows.map((r) => r.getBoundingClientRect().height),
      cellCounts: rows.map((r) => r.children.length),
      middle: rows.every((r) =>
        Array.from(r.children).every(
          (c) => getComputedStyle(c).verticalAlign === "middle",
        ),
      ),
      rightAligned: Array.from(
        document.querySelectorAll("#products td.numeric"),
      ).every((c) => getComputedStyle(c).textAlign === "right"),
      headHeight: head.height,
      filterGap: head.top - filters.bottom,
      searchY: document.getElementById("productSearch")!.getBoundingClientRect()
        .y,
      sortY: document
        .getElementById("productQuickSort")!
        .getBoundingClientRect().y,
    };
  });
  expect(layout.heights.every((h) => h >= 56 && h <= 64)).toBe(true);
  expect(layout.cellCounts.every((n) => n === 8)).toBe(true);
  expect(layout.middle).toBe(true);
  expect(layout.rightAligned).toBe(true);
  expect(layout.headHeight).toBeLessThanOrEqual(42);
  expect(layout.filterGap).toBeGreaterThanOrEqual(0);
  expect(layout.filterGap).toBeLessThanOrEqual(10);
  if (test.info().project.name === "desktop")
    expect(Math.abs(layout.searchY - layout.sortY)).toBeLessThanOrEqual(2);
  await page.screenshot({
    path: ".local/density-products-" + test.info().project.name + ".png",
    fullPage: false,
    animations: "disabled",
  });
  await page.locator("#products thead th button").first().click();
  await expect(page.locator("#products .product-open").first()).toContainText(
    "Adisyon",
  );
  await page.getByLabel("Ürün veya URL ara").fill("Broşür");
  await expect(page.locator("#products tr.product")).toHaveCount(1);
  await page.getByLabel("Ürün veya URL ara").fill("");
  await page.locator("#view-products .advanced-filters summary").click();
  await page.locator("#decisionFilter").selectOption("Koru");
  await expect(page.locator("#products .empty-cell")).toContainText(
    "Eşleşen ürün bulunamadı",
  );
  await page.locator("#decisionFilter").selectOption("Veri bekle");
  await expect(page.locator("#products tr.product")).toHaveCount(29);
  await page.locator("#view-products .advanced-filters summary").click();
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    axe.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
});

test("browser-only metrics stay in the correct product columns after density and sorting changes", async ({
  page,
}) => {
  // Explicit synthetic HTTP fixture only; no records or test traffic enter D1.
  await chartFixtures(page);
  await login(page);
  await products(page);
  await page.getByLabel("Ürün veya URL ara").fill("Broşür");
  await expect(page.locator("#products tr.product td.numeric")).toHaveText([
    "40",
    "600",
    /6,67/,
    /6,83/,
    "—",
  ]);
  await page.locator("#products thead th button").nth(1).click();
  await expect(page.locator("#products tr.product td.numeric")).toHaveText([
    "40",
    "600",
    /6,67/,
    /6,83/,
    "—",
  ]);
});
