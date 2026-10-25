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
test("current month, one-click picker, arrows, automatic loading and safe persistent preferences", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) requests.push(r.method() + " " + r.url());
  });
  await login(page);
  await expect(page.locator("#monthLabel")).toHaveText("Ekim 2026");
  await expect(page.locator("#periodHint")).toHaveText("Bu ay — kısmi veriler");
  await expect(page.locator("#nextMonth")).toBeDisabled();
  await page.locator("#monthToggle .icon").click();
  await expect(
    page.getByRole("dialog", { name: "Rapor ayını seç" }),
  ).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await expect(page.locator('[data-month="2026-11"]')).toBeDisabled();
  await page.getByRole("button", { name: "Eylül 2026", exact: true }).click();
  await expect(page.locator("#monthPicker")).not.toBeVisible();
  await expect(page.locator("#chartPeriod")).toContainText("30 Eyl 2026");
  await expect(page.locator("#month")).toHaveValue("2026-09");
  await page.locator("#device").selectOption("MOBILE");
  await expect(page.locator("#chartPeriod")).toContainText("Mobil");
  await view(page, "Ürün Performansı");
  await expect(page.locator("#productPeriod")).toContainText("Mobil");
  await page.getByLabel("Ürün veya URL ara").fill("zarf");
  await expect(page.locator(".product")).toHaveCount(1);
  await page.locator(".product .product-open").click();
  await expect(page.locator("#productDialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#view-products")).toBeVisible();
  await expect(page.locator("#month")).toHaveValue("2026-09");
  await expect(page.locator("#device")).toHaveValue("MOBILE");
  await page.locator("#nextMonth").click();
  await expect(page.locator("#monthLabel")).toHaveText("Ekim 2026");
  await expect(page.locator("#nextMonth")).toBeDisabled();
  await expect(page.locator(".delta")).toHaveCount(0);
  await view(page, "SEO Fırsat Radarı");
  await expect(page.locator("#radarResults")).toContainText("2026-10-01");
  expect(
    requests.some((r) => r.includes("/api/radar?month=2026-10&device=MOBILE")),
  ).toBe(true);
  await view(page, "Değişiklik Takvimi");
  await expect(page.locator("#changeDay")).toHaveValue("2026-10-25");
  await page.locator("#previousMonth").click();
  await expect(page.locator("#changeDay")).toHaveValue("2026-09-01");
  await expect(page.locator("#changeResults")).toContainText(
    "doğrulanmış değişiklik",
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mavi-dashboard-preferences")!),
  );
  expect(Object.keys(saved).sort()).toEqual(["device", "month", "view"]);
  expect(saved).toMatchObject({
    month: "2026-09",
    device: "MOBILE",
    view: "changes",
  });
  expect(
    requests.filter((r) => r.startsWith("POST") && !r.includes("/api/session")),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("missing data stays quiet, no false zero or export, picker works with keyboard and no storage access", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw Error("storage unavailable");
    };
    Storage.prototype.setItem = () => {
      throw Error("storage unavailable");
    };
  });
  await login(page);
  await expect(page.locator(".kpi-value")).toHaveText(["—", "—", "—", "—"]);
  await expect(page.locator("#export")).toBeHidden();
  await expect(page.locator("#dataDetails")).not.toHaveAttribute("open");
  await expect(page.locator("#status")).not.toHaveClass(/technical-error/);
  await page.locator("#monthToggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#monthPicker")).toBeVisible();
  await expect(page.locator('[data-month="2026-10"]')).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[data-month="2026-09"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#month")).toHaveValue("2026-09");
  await page.getByText("Neden eksik?", { exact: true }).click();
  await expect(page.locator("#dataExplanation")).toContainText(
    "Google bağlantısı yok",
  );
  const a = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a.violations.map((v) => v.id)).toEqual([]);
});
test("bad preferences are rejected and failed scope changes restore the last proven scope", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "mavi-dashboard-preferences",
      JSON.stringify({ month: "2099-12", device: "INVALID", view: "<script>" }),
    ),
  );
  await login(page);
  await expect(page.locator("#month")).toHaveValue("2026-10");
  await expect(page.locator("#device")).toHaveValue("ALL");
  await page.route("**/api/performance?*", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "TEST ONLY: network failure" },
    }),
  );
  await page.locator("#previousMonth").click();
  await expect(page.locator("#message")).toContainText(
    "önceki başarılı yükleme korunuyor",
  );
  await expect(page.locator("#month")).toHaveValue("2026-10");
  await expect(page.locator("#monthLabel")).toHaveText("Ekim 2026");
  await expect(page.locator("#chartPeriod")).toContainText("31 Eki 2026");
});

test("product quick sorting uses measurements, brand changes load automatically, and current month never compares", async ({
  page,
}) => {
  // Synthetic, browser-only complete-period fixture. No writes to D1 or production.
  await page.addInitScript(() =>
    localStorage.setItem(
      "mavi-dashboard-preferences",
      JSON.stringify({ month: "2026-09", device: "ALL", view: "products" }),
    ),
  );
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const d = await response.json();
    d.google_connected = true;
    await route.fulfill({ json: d });
  });
  await page.route("**/api/performance?*", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const d = await response.json();
    d.current = {
      clicks: 300,
      impressions: 8700,
      ctr: 300 / 8700,
      position: 6,
    };
    d.previous = {
      clicks: 380,
      impressions: 9000,
      ctr: 380 / 9000,
      position: 7,
    };
    d.comparison_available = true;
    d.fresh = true;
    d.coverage = { ...d.coverage, complete: true, measurement_complete: true };
    await route.fulfill({ json: d });
  });
  await page.route("**/api/report?*", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const d = await response.json();
    d.missing = [];
    for (const [id, c, i, previous] of [
      ["brosur", 100, 5000, 30],
      ["zarf", 150, 3000, 100],
      ["el-ilani", 50, 700, 250],
    ] as const) {
      const p = d.products.find((p: any) => p.id === id);
      p.missing = [];
      p.current = { clicks: c, impressions: i, ctr: c / i, position: 6 };
      p.previous = {
        clicks: previous,
        impressions: 5000,
        ctr: previous / 5000,
        position: 7,
      };
    }
    await route.fulfill({ json: d });
  });
  await login(page);
  await expect(page.locator(".product .product-open").first()).toHaveText(
    "Zarf",
  );
  await page
    .getByRole("button", { name: "En çok gösterilen", exact: true })
    .click();
  await expect(page.locator(".product .product-open").first()).toHaveText(
    "Broşür",
  );
  await page
    .getByRole("button", { name: "En fazla değişen", exact: true })
    .click();
  await expect(page.locator(".product .product-open").first()).toHaveText(
    "El İlanı",
  );
  await view(page, "Arama Sorguları");
  const brand = page.waitForRequest(
    (r) =>
      r.url().includes("/api/performance/queries?") &&
      r.url().includes("brand=non_brand"),
  );
  await page.getByLabel("Marka ayrımı").selectOption("non_brand");
  await brand;
  await view(page, "Genel Bakış");
  await expect(page.locator("#export")).toHaveText(/Raporu indir/);
  await page.locator("#nextMonth").click();
  await expect(page.locator("#periodHint")).toHaveText("Bu ay — kısmi veriler");
  await expect(page.locator(".delta")).toHaveCount(0);
  await expect(page.locator("#export")).toContainText("Kısmi raporu indir");
  await view(page, "Ürün Performansı");
  await expect(
    page.getByRole("button", { name: "En fazla değişen", exact: true }),
  ).toBeDisabled();
});
