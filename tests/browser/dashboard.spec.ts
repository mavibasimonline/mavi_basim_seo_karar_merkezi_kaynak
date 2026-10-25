import { test, expect, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { chartFixtures } from "./dashboard-fixtures";
const token = readFileSync(".dev.vars", "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("ADMIN_TOKEN="))
  ?.slice("ADMIN_TOKEN=".length);
if (!token) throw new Error("Yerel test erişim ayarı eksik.");
async function login(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Güvenli giriş", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Erişim anahtarı").fill(token!);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.locator("#app")).toBeVisible();
}
async function navigate(page: Page, name: string) {
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
async function accessible(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    r.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

test("real APIs preserve secure login, sources, evidence, questions and empty data", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/performance")).status()).toBe(401);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await expect(page.locator("#status")).toContainText("Google bağlantısı yok");
  await expect(page.locator(".kpi-value")).toHaveText(["—", "—", "—", "—"]);
  await expect(page.locator("#performanceChart")).toContainText(
    "Bu dönem için ölçüm yok",
  );
  expect(await page.locator(".chart-point").count()).toBe(0);
  await navigate(page, "Ürün Performansı");
  await expect(page.locator(".product")).toHaveCount(29);
  await page.getByLabel("Ürün veya URL ara").fill("Broşür");
  await expect(page.locator(".product")).toHaveCount(1);
  await page.getByRole("button", { name: "Broşür — Kanıtları gör" }).click();
  await expect(page.locator("#productDialog")).toBeVisible();
  await page.getByText("Kanıt, hesaplama ve eksikler", { exact: true }).click();
  await expect(page.locator("#productDetail")).toContainText("Kanıt güveni");
  await page.getByText("SEO değişiklik geçmişi", { exact: true }).click();
  await expect(page.locator("#productDetail")).toContainText(
    "Doğrulanmış tarama değişikliği yok.",
  );
  await page.getByText(/Keyword Planner kaynakları/).click();
  await expect(page.locator("#productDetail")).toContainText(
    "Yaklaşık aylık arama",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#productDialog")).not.toBeVisible();
  await page.getByLabel("Ürün veya URL ara").fill("");
  await expect(page.locator(".product")).toHaveCount(29);
  await navigate(page, "SEO Fırsat Radarı");
  await expect(page.locator("#radarResults")).toContainText(
    "Veri yetersizliği nedeniyle izlenenler",
  );
  await expect(page.locator("#radarResults")).toContainText(
    "Yeterli kanıtla belirlenen ürün yok.",
  );
  await navigate(page, "Değişiklik Takvimi");
  await expect(page.locator("#changeResults")).toContainText(
    "Bu tarihte doğrulanmış değişiklik tespiti yok.",
  );
  await navigate(page, "Veri Sağlığı");
  await expect(page.locator("#summary")).toContainText("521");
  await expect(page.locator("#summary")).toContainText("9.075");
  await expect(page.locator("#dataAuditResults")).toContainText(
    "Keyword Planner: Doğrulandı; 521 dosya, 9075 kaynak satırı.",
  );
  await expect(page.locator("#dataAuditResults")).toContainText(
    "Veri yetersiz",
  );
  await page
    .getByText("Bağlantılar ve otomatik toplama durumu", { exact: true })
    .click();
  await page.getByRole("button", { name: "Google'ı bağla" }).click();
  await expect(page.locator("#message")).toContainText("eksik");
  await navigate(page, "Arama Sorguları");
  await expect(page.locator("#queryTable")).toContainText(
    "Bu kapsamda doğrulanmış sorgu yok",
  );
  await expect(page.locator("#queryNote")).toContainText("Anonimleştirilmiş");
  await navigate(page, "SEO Soru-Cevap");
  await page
    .getByPlaceholder("Broşür mobilde neden düştü?")
    .fill("Broşür mobilde neden düştü?");
  await page.getByRole("button", { name: "Sor", exact: true }).click();
  await expect(page.locator("#answer")).toContainText("kanıtlayamam");
  await expect(page.locator("#answer")).toContainText("Ne yapmalıyım?");
  await page
    .getByPlaceholder("Broşür mobilde neden düştü?")
    .fill("Peki masaüstünde?");
  const result = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/questions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sor", exact: true }).click();
  expect((await (await result).json()).context).toMatchObject({
    product_id: "brosur",
    device: "DESKTOP",
  });
  await expect(page.locator("#answer")).toContainText("Masaüstü");
  await expect(page.locator("#export")).toBeHidden();
  const exported = await page.request.get(
    (await page.locator("#export").getAttribute("href")) || "",
  );
  expect(exported.status()).toBe(200);
  expect((await exported.json()).products).toHaveLength(29);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await navigate(page, "Genel Bakış");
  await page.screenshot({
    path: ".local/panel-" + test.info().project.name + ".png",
    fullPage: true,
    animations: "disabled",
  });
  await navigate(page, "Veri Sağlığı");
  if (
    (await page.locator("#sidebarToggle").getAttribute("aria-label")) ===
    "Menüyü aç"
  )
    await page.locator("#sidebarToggle").click();
  await page
    .getByRole("button", { name: "Güvenli çıkış", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Güvenli giriş", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#answer")).toBeEmpty();
  await expect(page.locator("#questionText")).toHaveValue("");
  expect((await page.request.get("/api/performance")).status()).toBe(401);
  expect(errors).toEqual([]);
});

test("browser-only fixtures verify real chart rendering, gaps, measured zeros and query controls", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "mavi-dashboard-preferences",
      JSON.stringify({ month: "2026-09", device: "ALL", view: "overview" }),
    ),
  );
  const requests = await chartFixtures(page);
  await login(page);
  await expect(page.locator(".kpi-value").first()).toHaveText("40");
  await expect(page.locator("#status")).toContainText("3/30");
  await expect(page.locator(".delta")).toHaveCount(0);
  await expect(page.locator("#export")).toBeVisible();
  await expect(page.locator("#export")).toContainText("Kısmi raporu indir");
  await expect(page.locator(".chart-point")).toHaveCount(3);
  await expect(page.locator('.chart-point[data-value="0"]')).toHaveCount(1);
  await expect(page.locator('[data-segment="verified"]')).toHaveCount(1);
  await page.locator("#performanceChart").focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".chart-tooltip")).toContainText("10");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".chart-tooltip")).toContainText("Veri yok");
  await page.getByRole("button", { name: "CTR", exact: true }).click();
  await expect(page.locator('[data-metric="ctr"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Tıklama", exact: true }).click();
  await page.screenshot({
    path: ".local/fixture-dashboard-" + test.info().project.name + ".png",
    fullPage: true,
    animations: "disabled",
  });
  await accessible(page);
  await navigate(page, "Arama Sorguları");
  await expect(page.locator("#queryTable tbody tr")).toHaveCount(50);
  await page.locator("#queryNext").click();
  await expect(page.locator("#queryPage")).toHaveText("2. sayfa");
  await expect(page.locator("#queryTable tbody tr")).toHaveCount(1);
  await page.locator("#queryPrevious").click();
  await expect(page.locator("#queryPage")).toHaveText("1. sayfa");
  await page.getByLabel("Arama sorgusu ara").fill("broşür baskı");
  await page.getByRole("button", { name: "Filtrele", exact: true }).click();
  await expect(page.locator("#queryTable tbody tr")).toHaveCount(1);
  await expect(page.locator("#queryTable")).toContainText("Koru");
  await page
    .getByRole("button", { name: "Tıklama sütununa göre sırala" })
    .click();
  expect(requests.some((r) => r.includes("sort=clicks"))).toBe(true);
  await accessible(page);
  await navigate(page, "Ürün Performansı");
  await page
    .getByRole("button", { name: "Broşür — Kanıtları gör", exact: true })
    .click();
  await page.getByText("SEO değişiklik geçmişi", { exact: true }).click();
  await expect(page.locator("#productDetail")).toContainText(
    "Eski broşür başlığı",
  );
  await expect(page.locator("#productDetail")).toContainText(
    "Yeni broşür başlığı",
  );
  await expect(page.locator("#productDetail")).toContainText("Eski");
  await expect(page.locator("#productDetail img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  await page.keyboard.press("Escape");
  await navigate(page, "Genel Bakış");
  await page.getByLabel("Cihaz", { exact: true }).selectOption("MOBILE");
  await expect(page.locator(".kpi-value").first()).toHaveText("20");
  await expect(page.locator("#chartPeriod")).toContainText("Mobil");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("keyboard navigation, responsive collapse and WCAG checks cover all real sections", async ({
  page,
}) => {
  await page.goto("/");
  await accessible(page);
  await page.getByLabel("Erişim anahtarı").fill(token!);
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(page.locator("#app")).toBeVisible();
  await accessible(page);
  const mobile =
    (await page.locator("#sidebarToggle").getAttribute("aria-label")) ===
    "Menüyü aç";
  if (mobile) {
    await page.locator("#sidebarToggle").click();
    await expect(page.locator("#sidebar")).toHaveAttribute(
      "aria-modal",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(page.locator("#sidebarToggle")).toBeFocused();
    expect(
      await page.locator("#appMain").evaluate((e) => (e as HTMLElement).inert),
    ).toBe(false);
  } else {
    await page.locator("#sidebarToggle").click();
    await expect(page.locator("body")).toHaveClass(/is-collapsed/);
    await page.locator("#sidebarToggle").click();
    await expect(page.locator("body")).not.toHaveClass(/is-collapsed/);
  }
  for (const name of [
    "Ürün Performansı",
    "Arama Sorguları",
    "SEO Fırsat Radarı",
    "Değişiklik Takvimi",
    "Veri Sağlığı",
    "SEO Soru-Cevap",
  ]) {
    await navigate(page, name);
    await expect(page.locator("#mainContent")).toBeFocused();
    await accessible(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("failed analysis or network never manufactures values and keeps the interface usable", async ({
  page,
}) => {
  await page.route("**/api/report?*", (r) =>
    r.fulfill({
      status: 503,
      json: { error: "Analiz geçici olarak alınamadı." },
    }),
  );
  await login(page);
  await page.getByText("Sorunu incele", { exact: true }).click();
  await expect(page.locator("#status")).toContainText(
    "Aylık SEO analizi alınamadı",
  );
  await expect(page.locator("#status")).toContainText("Google bağlantısı yok");
  await navigate(page, "Ürün Performansı");
  await expect(page.locator(".product")).toHaveCount(29);
  await expect(page.locator(".badge").first()).toHaveText("Veri bekle");
  await page.route("**/api/status", (r) =>
    r.fulfill({
      status: 503,
      json: { error: "Bağlantı geçici olarak kullanılamıyor." },
    }),
  );
  await page.locator("#refresh").click();
  await expect(page.locator("#message")).toContainText(
    "önceki başarılı yükleme korunuyor",
  );
  await expect(page.locator(".product")).toHaveCount(29);
});
