import { beforeEach, it, expect } from "vitest";
import { init, env, connected } from "./helpers";
import { performance, performanceQueries } from "../src/performance";
import { insertRows } from "../src/sync";
import { dates, monthPeriod } from "../src/analysis";
import worker from "../src/index";
beforeEach(init);
const TIME = new Date("2026-10-24T18:00:00Z");
type Sample = {
  clicks: number;
  impressions: number;
  position: number;
  device?: string;
  query?: string;
  country?: string;
  is_brand?: number;
  page?: string;
  ctr?: number;
};
async function seed(
  day: string,
  samples: Sample[],
  scope = "page",
  options: {
    complete?: number;
    count?: number;
    id?: string;
    stamp?: string;
  } = {},
) {
  const id = options.id || `${scope}:${day}`,
    stamp = options.stamp || TIME.toISOString();
  const rows = samples.map((r) => ({
    dataset_id: id,
    date: day,
    page: r.page || "https://mavibasim.com/brosur",
    country: r.country || "tur",
    device: r.device || "MOBILE",
    clicks: r.clicks,
    impressions: r.impressions,
    position: r.position,
    ctr: r.ctr ?? (r.impressions ? r.clicks / r.impressions : 0),
    ...(scope === "query"
      ? { query: r.query || "broşür baskı", is_brand: r.is_brand || 0 }
      : {}),
  }));
  await env.DB.batch([
    ...insertRows(
      env.DB,
      scope === "page" ? "gsc_daily_by_page" : "gsc_daily_by_query_device",
      rows,
    ),
    env.DB.prepare(
      "INSERT OR REPLACE INTO dataset_coverage VALUES(?,?,?,?,?,?,?,?,?)",
    ).bind(
      "gsc",
      day,
      scope,
      id,
      options.complete ?? 1,
      Number(scope === "query"),
      options.count ?? rows.length,
      stamp,
      "TEST FIXTURE",
    ),
  ]);
}
const params = (extra: Record<string, string> = {}) =>
  new URLSearchParams({ month: "2026-09", ...extra });
const request = (path: string) =>
  new Request("https://app.example" + path, {
    headers: { Authorization: "Bearer " + env.ADMIN_TOKEN },
  });

it("leaves all absent days null; no generated KPI or example chart numbers", async () => {
  const r = await performance(env, "2026-09", null, TIME);
  expect(r.current).toBeNull();
  expect(r.series).toHaveLength(30);
  expect(r.series.every((d) => d.metrics === null && !d.verified)).toBe(true);
  expect(r.catalog).toHaveLength(2);
  expect(r.coverage.verified_days).toBe(0);
});
it("independently computes weighted position and total CTR rather than averaging averages", async () => {
  await seed("2026-09-01", [
    { clicks: 10, impressions: 100, position: 2 },
    { clicks: 0, impressions: 900, position: 20, device: "DESKTOP" },
  ]);
  const r = await performance(env, "2026-09", null, TIME);
  expect(r.current).toEqual({
    clicks: 10,
    impressions: 1000,
    ctr: 0.01,
    position: 18.2,
  });
  expect(r.comparison_available).toBe(false);
});
it("preserves a measured zero click value and a missing neighboring day separately", async () => {
  await seed("2026-09-02", [{ clicks: 0, impressions: 90, position: 12 }]);
  const r = await performance(env, "2026-09", null, TIME);
  expect(r.series[0].metrics).toBeNull();
  expect(r.series[1].metrics?.clicks).toBe(0);
  expect(r.series[1].metrics?.ctr).toBe(0);
});
it("does not turn an empty provider response or unobserved device into zero traffic", async () => {
  await seed("2026-09-01", []);
  await seed("2026-09-02", [{ clicks: 8, impressions: 100, position: 3 }]);
  const r = await performance(env, "2026-09", "DESKTOP", TIME);
  expect(r.coverage.verified_days).toBe(2);
  expect(r.current).toBeNull();
  expect(r.series.every((s) => s.metrics === null)).toBe(true);
});
it("excludes staging generations, incomplete days and unfinished Google days", async () => {
  await seed(
    "2026-09-01",
    [{ clicks: 99, impressions: 100, position: 1 }],
    "page",
    { id: "old" },
  );
  await seed(
    "2026-09-01",
    [{ clicks: 2, impressions: 100, position: 8 }],
    "page",
    { id: "active" },
  );
  await seed(
    "2026-09-02",
    [{ clicks: 99, impressions: 100, position: 1 }],
    "page",
    { complete: 0 },
  );
  await seed("2026-10-23", [{ clicks: 99, impressions: 100, position: 1 }]);
  expect((await performance(env, "2026-09", null, TIME)).current?.clicks).toBe(
    2,
  );
  expect((await performance(env, "2026-10", null, TIME)).current).toBeNull();
});
it("suppresses chart data when validated coverage counts no longer match raw records", async () => {
  await seed(
    "2026-09-01",
    [{ clicks: 5, impressions: 50, position: 5 }],
    "page",
    { count: 2 },
  );
  const r = await performance(env, "2026-09", null, TIME);
  expect(r.current).toBeNull();
  expect(r.coverage.invalid_days).toEqual(["2026-09-01"]);
});
it("rejects a corrupt CTR and an unknown device despite a completed marker", async () => {
  await seed("2026-09-01", [
    { clicks: 5, impressions: 100, position: 5, ctr: 0.7 },
  ]);
  await seed("2026-09-02", [
    { clicks: 5, impressions: 100, position: 5, device: "unknown" },
  ]);
  const r = await performance(env, "2026-09", null, TIME);
  expect(r.current).toBeNull();
  expect(r.coverage.invalid_days).toHaveLength(2);
});
it("keeps mobile and desktop series and totals independent", async () => {
  await seed("2026-09-01", [
    { clicks: 2, impressions: 100, position: 12 },
    { clicks: 90, impressions: 900, position: 4, device: "DESKTOP" },
  ]);
  expect(
    (await performance(env, "2026-09", "MOBILE", TIME)).current?.clicks,
  ).toBe(2);
  expect(
    (await performance(env, "2026-09", "DESKTOP", TIME)).current?.clicks,
  ).toBe(90);
});
it("shows monthly comparison only after both periods, fresh health and finalization are present", async () => {
  const cfg = await connected();
  for (const m of ["2026-08", "2026-09"])
    for (const day of dates(monthPeriod(m)))
      await seed(day, [{ clicks: 1, impressions: 100, position: 10 }]);
  await env.DB.prepare(
    "INSERT INTO health_checks VALUES('gsc','2026-10-24',?,'ok',NULL)",
  )
    .bind(TIME.toISOString())
    .run();
  expect(
    (await performance(cfg, "2026-09", null, TIME)).comparison_available,
  ).toBe(true);
  expect(
    (await performance(cfg, "2026-09", null, new Date("2026-11-01")))
      .comparison_available,
  ).toBe(false);
  await seed("2026-09-15", [], "page", { id: "verified-empty-day" });
  const empty = await performance(cfg, "2026-09", null, TIME);
  expect(empty.coverage.verified_days).toBe(30);
  expect(empty.coverage.observed_days).toBe(29);
  expect(empty.comparison_available).toBe(false);
});
it("query rows remain separate from page metrics and report their privacy limitation", async () => {
  await seed("2026-09-01", [{ clicks: 50, impressions: 1000, position: 5 }]);
  await seed(
    "2026-09-01",
    [{ clicks: 8, impressions: 100, position: 7, query: "broşür baskı" }],
    "query",
  );
  const r = await performanceQueries(env, params(), TIME);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0].clicks).toBe(8);
  expect((await performance(env, "2026-09", null, TIME)).current?.clicks).toBe(
    50,
  );
  expect(r.note).toContain("Anonimleştirilmiş");
});
it("aggregates query metrics with impression weights across countries without merging devices", async () => {
  await seed(
    "2026-09-01",
    [
      { clicks: 10, impressions: 100, position: 2 },
      { clicks: 0, impressions: 900, position: 20, country: "deu" },
      { clicks: 40, impressions: 400, position: 4, device: "DESKTOP" },
    ],
    "query",
  );
  const r = await performanceQueries(env, params({ device: "MOBILE" }), TIME);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0]).toMatchObject({
    clicks: 10,
    ctr: 0.01,
    position: 18.2,
    device: "MOBILE",
  });
});
it("does not invent a product match for an unverified URL, then uses its real mapping", async () => {
  await seed(
    "2026-09-01",
    [{ clicks: 1, impressions: 20, position: 4 }],
    "query",
  );
  expect(
    (await performanceQueries(env, params({ product: "brosur" }), TIME)).rows,
  ).toHaveLength(0);
  await env.DB.prepare("UPDATE products SET url_verified_at=? WHERE id=?")
    .bind(TIME.toISOString(), "brosur")
    .run();
  expect(
    (await performanceQueries(env, params({ product: "brosur" }), TIME)).rows,
  ).toHaveLength(1);
});
it("keeps brand intent filters distinct and supports Turkish search text literally", async () => {
  await seed(
    "2026-09-01",
    [
      {
        clicks: 2,
        impressions: 100,
        position: 4,
        query: "İSTANBUL broşür % baskı",
        is_brand: 0,
      },
      {
        clicks: 1,
        impressions: 20,
        position: 2,
        query: "Mavi Basım",
        is_brand: 1,
      },
    ],
    "query",
  );
  expect(
    (
      await performanceQueries(
        env,
        params({ q: "istanbul", brand: "non_brand" }),
        TIME,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await performanceQueries(
        env,
        params({ q: "%", brand: "non_brand" }),
        TIME,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (await performanceQueries(env, params({ brand: "brand" }), TIME)).rows[0]
      .query,
  ).toBe("Mavi Basım");
});
it("uses bound filters and a strict sort whitelist, including prototype keys", async () => {
  await seed(
    "2026-09-01",
    [{ clicks: 1, impressions: 10, position: 5 }],
    "query",
  );
  expect(
    (await performanceQueries(env, params({ q: "' OR 1=1 --" }), TIME)).rows,
  ).toHaveLength(0);
  for (const value of [
    "clicks;DELETE FROM products",
    "constructor",
    "toString",
    "__proto__",
  ])
    await expect(
      performanceQueries(env, params({ sort: value }), TIME),
    ).rejects.toThrow("INVALID_QUERY_SORT");
  expect(
    (
      await env.DB.prepare("SELECT count(*) n FROM products").first<{
        n: number;
      }>()
    )?.n,
  ).toBe(2);
});
it("paginates query groups without losing deterministic order or fabricating totals", async () => {
  await seed(
    "2026-09-01",
    Array.from({ length: 51 }, (_, i) => ({
      clicks: 1,
      impressions: 100,
      position: 5,
      query: `TEST ${String(i).padStart(2, "0")}`,
    })),
    "query",
  );
  const a = await performanceQueries(
      env,
      params({ sort: "query", direction: "asc" }),
      TIME,
    ),
    b = await performanceQueries(
      env,
      params({ sort: "query", direction: "asc", page: "2" }),
      TIME,
    );
  expect(a.rows).toHaveLength(50);
  expect(a.has_next).toBe(true);
  expect(b.rows).toHaveLength(1);
  expect(b.has_next).toBe(false);
  expect(b.rows[0].query).toBe("TEST 50");
});
it("does not write jobs, credentials, health counters or activate synchronization", async () => {
  await env.DB.prepare(
    "INSERT INTO health_checks VALUES('sync-budget','2026-10-24',?,'ok','8552')",
  )
    .bind(TIME.toISOString())
    .run();
  await performance(env, "2026-09", null, TIME);
  await performanceQueries(env, params(), TIME);
  expect(
    await env.DB.prepare(
      "SELECT code FROM health_checks WHERE provider='sync-budget'",
    ).first(),
  ).toMatchObject({ code: "8552" });
  expect(
    await env.DB.prepare("SELECT count(*) n FROM sync_jobs").first(),
  ).toMatchObject({ n: 0 });
  expect(
    await env.DB.prepare("SELECT count(*) n FROM oauth_credentials").first(),
  ).toMatchObject({ n: 0 });
});
it("exposes authenticated real-data endpoints, validates filters and keeps exports in device context", async () => {
  await seed("2026-09-01", [
    { clicks: 2, impressions: 100, position: 12 },
    { clicks: 90, impressions: 900, position: 4, device: "DESKTOP" },
  ]);
  for (const path of ["/api/performance", "/api/performance/queries"])
    expect(
      (await worker.fetch(new Request("https://app.example" + path), env))
        .status,
    ).toBe(401);
  for (const path of [
    "/api/performance?month=2026-99",
    "/api/performance?device=phone",
    "/api/performance/queries?page=-1",
    "/api/performance/queries?sort=constructor",
  ])
    expect((await worker.fetch(request(path), env)).status).toBe(400);
  for (const path of ["/api/report", "/api/export"]) {
    const response = await worker.fetch(
      request(path + "?month=2026-09&device=MOBILE"),
      env,
    );
    expect(response.status).toBe(200);
    const r = (await response.json()) as any;
    expect(r.filters.device).toBe("MOBILE");
    expect(r.products.find((p: any) => p.id === "brosur").current.clicks).toBe(
      2,
    );
  }
});
