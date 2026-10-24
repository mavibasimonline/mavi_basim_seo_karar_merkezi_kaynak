// Synthetic HTTP responses used ONLY by Playwright. Never imported by the app or D1.
import type { Page } from "@playwright/test";
export async function chartFixtures(page: Page) {
  const requests: string[] = [];
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const data = await response.json();
    data.google_connected = true;
    data.health = [
      { provider: "gsc", status: "ok", checked_at: new Date().toISOString() },
    ];
    data.sync_budget = {
      enabled: true,
      paused: false,
      write_limit: 10000,
      reserved_writes: 2000,
    };
    await route.fulfill({ json: data });
  });
  await page.route("**/api/performance?*", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const data = await response.json();
    const mobile =
      new URL(route.request().url()).searchParams.get("device") === "MOBILE";
    const values = mobile
      ? [
          [1, 5, 100, 4],
          [3, 0, 100, 5],
          [4, 15, 100, 6],
        ]
      : [
          [1, 10, 100, 5],
          [3, 0, 200, 6],
          [4, 30, 300, 8],
        ];
    data.series = data.series.map((r: any, i: number) => {
      const found = values.find((v) => v[0] === i + 1);
      return {
        ...r,
        verified: !!found,
        metrics: found
          ? {
              clicks: found[1],
              impressions: found[2],
              ctr: found[1] / found[2],
              position: found[3],
            }
          : null,
        dataset_id: found ? "UI_TEST_ONLY:" + r.day : null,
        fetched_at: found ? new Date().toISOString() : null,
      };
    });
    data.current = mobile
      ? { clicks: 20, impressions: 300, ctr: 20 / 300, position: 5 }
      : { clicks: 40, impressions: 600, ctr: 40 / 600, position: 41 / 6 };
    data.previous = { clicks: 1000, impressions: 10000, ctr: 0.1, position: 3 };
    data.coverage.verified_days = 3;
    data.coverage.observed_days = 3;
    data.coverage.measurement_complete = false;
    data.last_fetched_at = new Date().toISOString();
    data.coverage.complete = false;
    data.comparison_available = false;
    data.google_connected = true;
    data.fresh = true;
    await route.fulfill({ json: data });
  });
  await page.route("**/api/report?*", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const data = await response.json();
    data.missing = ["UI TEST FIXTURE: seçili ve önceki dönem kısmi."];
    data.sources.google_connected = true;
    const product = data.products.find((p: any) => p.id === "brosur");
    product.current = {
      clicks: 40,
      impressions: 600,
      ctr: 40 / 600,
      position: 41 / 6,
    };
    product.queries = [
      {
        query: "broşür baskı",
        protect: true,
        clicks: 40,
        impressions: 600,
        previous_clicks: null,
      },
    ];
    await route.fulfill({ json: data });
  });
  await page.route("**/api/performance/queries?*", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const device = url.searchParams.get("device");
    let rows = Array.from({ length: 51 }, (_, i) => ({
      query:
        i === 0 ? "broşür baskı" : `TEST sorgu ${String(i).padStart(2, "0")}`,
      page: "https://mavibasim.com/brosur",
      device: i % 2 ? "DESKTOP" : "MOBILE",
      is_brand: 0,
      product_id: "brosur",
      product_name: "Broşür",
      clicks: 51 - i,
      impressions: 1000 - i * 10,
      ctr: (51 - i) / (1000 - i * 10),
      position: 8 + i / 10,
    }));
    if (device && device !== "ALL")
      rows = rows.filter((r) => r.device === device);
    const q = (url.searchParams.get("q") || "").toLocaleLowerCase("tr-TR");
    if (q)
      rows = rows.filter((r) => r.query.toLocaleLowerCase("tr-TR").includes(q));
    const key = url.searchParams.get("sort") || "impressions",
      direction = url.searchParams.get("direction") === "asc" ? 1 : -1;
    rows.sort(
      (a: any, b: any) =>
        (typeof a[key] === "string"
          ? a[key].localeCompare(b[key], "tr")
          : a[key] - b[key]) * direction,
    );
    const p = Number(url.searchParams.get("page") || "1"),
      start = (p - 1) * 50;
    await route.fulfill({
      json: {
        source: "Google Search Console",
        period: { start: "2026-09-01", end: "2026-09-30" },
        device,
        page: p,
        rows: rows.slice(start, start + 50),
        has_next: rows.length > start + 50,
        verified_days: 3,
        note: "UI TEST FIXTURE ONLY. Anonimleştirilmiş sorgular tam veri değildir.",
      },
    });
  });
  await page.route("**/api/history?*", (route) =>
    route.fulfill({
      json: {
        note: "UI TEST FIXTURE ONLY",
        rows: [
          {
            observed_from: "2026-09-01T00:00:00Z",
            observed_to: "2026-09-02T00:00:00Z",
            published_at: null,
            diff_json: JSON.stringify({
              title: {
                old: "Eski broşür başlığı",
                new: "<img src=x onerror=window.__xss=1> Yeni broşür başlığı",
              },
            }),
          },
        ],
      },
    }),
  );
  return requests;
}
