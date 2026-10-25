import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
const token = readFileSync(".dev.vars", "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("ADMIN_TOKEN="))!
  .slice(12);
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Erişim anahtarı").fill(token);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.locator("#app")).toBeVisible();
}
async function view(page: Page, name: string) {
  if (
    (await page.locator("#sidebarToggle").getAttribute("aria-label")) ===
    "Menüyü aç"
  )
    await page.locator("#sidebarToggle").click();
  await page
    .getByRole("navigation", { name: "Ana menü" })
    .getByRole("link", { name, exact: true })
    .click();
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-25T09:00:00+03:00"));
});
test("all twelve months and the adjacent period menu occupy the very first row; desktop screenshot proves no clipped month", async ({ page }) => {
  await login(page);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#monthGrid button")).toHaveText([
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
  ]);
  await expect(page.locator("#monthToggle, #monthPicker, #previousMonth, #nextMonth, #previousYear, #nextYear")).toHaveCount(0);
  const desktop = test.info().project.name === "desktop";
  for (const width of desktop ? [1024, 1280, 1440, 1920] : [360, 393, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(async () => {
      const layout = await page.evaluate(() => {
        const rect = (id: string) => document.getElementById(id)!.getBoundingClientRect();
        const strip = rect("monthGrid"), year = rect("pickerYear"), menu = rect("rangeToggle"), title = rect("breadcrumb");
        const months = Array.from(document.querySelectorAll("#monthGrid button")).map(b => b.getBoundingClientRect());
        return {
          noDocumentOverflow: document.documentElement.scrollWidth <= innerWidth,
          firstRow: strip.bottom <= title.top && year.right <= strip.left && menu.left >= strip.right,
          sameRow: months.every(r => Math.abs((r.y + r.height / 2) - (menu.y + menu.height / 2)) < 2),
          allMonthsInStrip: months.every(r => r.left >= strip.left && r.right <= strip.right),
          blueSelectedMonth: getComputedStyle(document.querySelector('#monthGrid [aria-pressed="true"]')!).backgroundColor === "rgb(39, 92, 231)",
        };
      });
      expect(layout.noDocumentOverflow).toBe(true);
      expect(layout.firstRow).toBe(true);
      expect(layout.sameRow).toBe(true);
      expect(layout.blueSelectedMonth).toBe(true);
      if (desktop) expect(layout.allMonthsInStrip).toBe(true);
    }).toPass();
    if (width === 1440 || width === 393) {
      await page.screenshot({path: ".local/open-month-bar-" + test.info().project.name + ".png", fullPage: true, animations: "disabled"});
      await page.locator("#rangeToggle").click();
      await expect(page.getByRole("group", { name: "Dönem seçenekleri" }).getByRole("button")).toHaveText(["3 Ay", "6 Ay", "12 Ay"]);
      const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(accessibility.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
      await page.screenshot({path: ".local/open-month-menu-" + test.info().project.name + ".png", fullPage: true, animations: "disabled"});
      await page.keyboard.press("Escape");
    }
  }
});
test("compact year selector prevents future dates; period dropdown closes outside and supports keyboard selection", async ({ page }) => {
  await login(page);
  await expect(page.locator("#rangeMenu")).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: "3 Ay", exact: true })).toBeHidden();
  await page.getByLabel("Rapor yılı", { exact: true }).selectOption("2025");
  await expect(page.locator("#chartPeriod")).toContainText("01 Eki 2025");
  await expect(page.locator('[data-month="2025-12"]')).toBeEnabled();
  await page.getByRole("button", { name: "Aralık 2025", exact: true }).click();
  await expect(page.locator("#chartPeriod")).toContainText("31 Ara 2025");
  await page.getByLabel("Rapor yılı", { exact: true }).selectOption("2026");
  await expect(page.locator("#chartPeriod")).toContainText("01 Eki 2026");
  await expect(page.locator('[data-month="2026-12"]')).toBeDisabled();
  await expect(page.locator("#pickerYear option")).toHaveText(["2026", "2025", "2024"]);
  await page.locator("#rangeToggle").click();
  await expect(page.getByRole("button", { name: "6 Ay", exact: true })).toBeVisible();
  await page.locator("#viewTitle").click();
  await expect(page.locator("#rangeMenu")).not.toHaveAttribute("open");
  await page.locator("#rangeToggle").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("button", { name: "12 Ay", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#rangeToggle")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "3 Ay", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#chartPeriod")).toContainText("01 May 2026");
  await expect(page.locator("#rangeLabel")).toHaveText("6 Ay");
  await expect(page.locator("#rangeMenu")).not.toHaveAttribute("open");
  await expect(page.locator("#rangeToggle")).toBeFocused();
});
test("twelve open months select with one click or tap, reject future months and preserve single-month preferences", async ({
  page,
}) => {
  await login(page);
  await expect(page.locator("#monthGrid button")).toHaveCount(12);
  await expect(page.locator('[data-month="2026-10"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('[data-month="2026-11"]')).toBeDisabled();
  await expect(page.locator('[data-month="2026-12"]')).toBeDisabled();
  await expect(page.locator("#periodHint")).toHaveText("Bu ay — kısmi veriler");
  const september = page.getByRole("button", {
    name: "Eylül 2026",
    exact: true,
  });
  if (test.info().project.name === "mobile") await september.tap();
  else await september.click();
  await expect(page.locator("#chartPeriod")).toContainText("30 Eyl 2026");
  await page.locator("#device").selectOption("MOBILE");
  await expect(page.locator("#chartPeriod")).toContainText("Mobil");
  await view(page, "Ürün Performansı");
  await expect(page.locator("#productPeriod")).toContainText("Mobil");
  await page.reload();
  await expect(page.locator("#view-products")).toBeVisible();
  await expect(page.locator("#month")).toHaveValue("2026-09");
  await expect(page.locator("#device")).toHaveValue("MOBILE");
  await page.getByLabel("Ürün veya URL ara").fill("zarf");
  await expect(page.locator(".product")).toHaveCount(1);
  await page.locator(".product-open").click();
  await expect(page.locator("#productDialog")).toBeVisible();
  await page.keyboard.press("Escape");
});
test("3, 6, 12 month modes and device load matching real APIs and survive tabs and reload", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests.push(r.method() + " " + r.url());
  });
  await login(page);
  for (const [n, start] of [
    ["3", "01 Ağu 2026"],
    ["6", "01 May 2026"],
    ["12", "01 Kas 2025"],
  ]) {
    await page.locator("#rangeToggle").click();
    await expect(page.locator("#rangeMenu")).toHaveAttribute("open");
    await page.getByRole("button", { name: n + " Ay", exact: true }).click();
    await expect(page.locator("#rangeMenu")).not.toHaveAttribute("open");
    await expect(page.locator("#rangeLabel")).toHaveText(n + " Ay");
    await expect(page.locator("#rangeMonths")).toHaveValue(n);
    await expect(page.locator("#chartPeriod")).toContainText(start);
    await expect(page.locator('#monthGrid [aria-pressed="true"]')).toHaveCount(
      0,
    );
  }
  await page.locator("#device").selectOption("DESKTOP");
  await expect(page.locator("#chartPeriod")).toContainText("Masaüstü");
  await view(page, "Arama Sorguları");
  await expect(page.locator("#queryNote")).toContainText("01 Kas 2025");
  await view(page, "SEO Fırsat Radarı");
  await expect(page.locator("#radarResults")).toContainText("2025-11-01");
  await page.reload();
  await expect(page.locator("#view-radar")).toBeVisible();
  await expect(page.locator("#rangeLabel")).toHaveText("12 Ay");
  await page.locator("#rangeToggle").click();
  await expect(page.locator('[data-range="12"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#device")).toHaveValue("DESKTOP");
  expect(
    requests.some((r) =>
      r.includes("/api/radar?month=2026-10&device=DESKTOP&rangeMonths=12"),
    ),
  ).toBe(true);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mavi-dashboard-preferences")!),
  );
  expect(Object.keys(saved).sort()).toEqual([
    "device",
    "month",
    "rangeMonths",
    "view",
  ]);
  expect(
    requests.filter((r) => r.startsWith("POST") && !r.includes("/api/session")),
  ).toEqual([]);
  await view(page, "Genel Bakış");
  await page.getByRole("button", { name: "Eylül 2026", exact: true }).click();
  await expect(page.locator("#rangeMonths")).toHaveValue("1");
  await expect(page.locator("#chartPeriod")).toContainText("01 Eyl 2026");
});
test("no storage or missing data never invents zeroes or leaders; open filters remain accessible", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw Error("blocked");
    };
    Storage.prototype.setItem = () => {
      throw Error("blocked");
    };
  });
  await login(page);
  await expect(page.locator(".kpi-value")).toHaveText(["—", "—", "—", "—"]);
  await expect(page.locator("#export")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "İlk 10 Lider Ürün", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#leadersTable")).toContainText(
    "doğrulanmış ürün ölçümü yok",
  );
  await expect(page.locator("#dataDetails")).not.toHaveAttribute("open");
  await expect(page.locator("#status")).not.toHaveClass(/technical-error/);
  await page.locator('[data-month="2026-10"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[data-month="2026-09"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#month")).toHaveValue("2026-09");
  const a = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a.violations.map((v) => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("invalid preferences and failed multi-month requests restore the last proven complete scope", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "mavi-dashboard-preferences",
      JSON.stringify({
        month: "2099-12",
        rangeMonths: "99",
        device: "INVALID",
        view: "<script>",
      }),
    ),
  );
  await login(page);
  await expect(page.locator("#month")).toHaveValue("2026-10");
  await expect(page.locator("#rangeMonths")).toHaveValue("1");
  await expect(page.locator("#device")).toHaveValue("ALL");
  await page.route("**/api/performance?*", (r) =>
    r.fulfill({ status: 503, json: { error: "TEST ONLY unavailable" } }),
  );
  await page.locator("#rangeToggle").click();
  await page.getByRole("button", { name: "3 Ay", exact: true }).click();
  await expect(page.locator("#message")).toContainText(
    "önceki başarılı yükleme korunuyor",
  );
  await expect(page.locator("#rangeMonths")).toHaveValue("1");
  await expect(page.locator("#rangeLabel")).toHaveText("Dönem");
  await expect(page.locator('[data-month="2026-10"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
test("first ten leaders use verified selected-period product metrics and open evidence without listing all 29", async ({
  page,
}) => {
  // Browser-only ranking fixture, never stored or exposed as real Google data.
  await page.route("**/api/performance?*", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const d = await response.json();
    const mobile =
      new URL(route.request().url()).searchParams.get("device") === "MOBILE";
    d.catalog.forEach((p: any) => (p.url_verified_at = "2026-10-25T00:00:00Z"));
    d.products = d.catalog.map((p: any, i: number) => ({
      id: p.id,
      current:
        i === 28
          ? null
          : {
              clicks: mobile ? i : 100 - i,
              impressions: 1000 + i,
              ctr: (mobile ? i : 100 - i) / (1000 + i),
              position: 5 + i / 10,
            },
      previous: null,
      observed_days: 1,
      last_fetched_at: "2026-10-25T00:00:00Z",
    }));
    await route.fulfill({ json: d });
  });
  // Report owns the SEO decisions, independently of leaderboard page measurements.
  await page.route("**/api/report?*", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const d = await response.json();
    d.products.forEach((p: any) => (p.url_verified = true));
    await route.fulfill({ json: d });
  });
  await login(page);
  await expect(page.locator("#leadersTable tbody tr")).toHaveCount(10);
  await expect(page.locator("#leadersTable tbody tr").first()).toContainText(
    "100",
  );
  await expect(page.locator("#leadersNote")).toContainText("Kısmi sıralama");
  await page.locator("#leadersTable .product-open").first().click();
  await expect(page.locator("#productDialog")).toBeVisible();
  await expect(page.locator("#productDetail")).toContainText(
    "Google Search Console",
  );
  await page.keyboard.press("Escape");
  await page.locator("#device").selectOption("MOBILE");
  await expect(page.locator("#chartPeriod")).toContainText("Mobil");
  await expect(page.locator("#leadersTable tbody tr").first()).toContainText(
    "27",
  );
  await page.screenshot({
    path: ".local/month-strip-fixture-" + test.info().project.name + ".png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
