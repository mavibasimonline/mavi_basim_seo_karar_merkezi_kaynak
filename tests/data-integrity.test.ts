import { beforeEach, it, expect } from "vitest";
import { init, env, connected, enqueue, fetcher } from "./helpers";
import { auditSeed, AUDIT_TIME } from "./audit-fixtures";
import {
  archiveIssues,
  reliability,
  dataIntegrity,
  SourceRecord,
} from "../src/data-integrity";
import { analyze, Metrics } from "../src/analysis";
import { metricErrors, validateAnalysis } from "../src/validation";
import { claimJob, processJob } from "../src/sync";
const metric: Metrics = {
  clicks: 100,
  impressions: 1000,
  ctr: 0.1,
  position: 2.8,
};
beforeEach(init);
const cases: [string, Metrics | null, Metrics | null, boolean][] = [
  ["I01 doğru ağırlıklı konum", metric, metric, true],
  [
    "I02 ortalamaların ortalaması reddedilir",
    { ...metric, position: 6 },
    metric,
    false,
  ],
  ["I03 yanlış CTR reddedilir", { ...metric, ctr: 0.2 }, metric, false],
  ["I04 NaN reddedilir", { ...metric, clicks: NaN }, metric, false],
  [
    "I05 sonsuz değer reddedilir",
    { ...metric, impressions: Infinity },
    metric,
    false,
  ],
  ["I06 negatif değer reddedilir", { ...metric, clicks: -1 }, metric, false],
  [
    "I07 gösterimden fazla tıklama reddedilir",
    { ...metric, clicks: 2000 },
    metric,
    false,
  ],
  ["I08 eksik ölçüm sıfır değildir", null, metric, false],
  ["I09 kanıtsız ölçüm reddedilir", metric, null, false],
  ["I10 iki tarafta yokluk uydurulmaz", null, null, true],
  [
    "I11 gerçek sıfır gösterim null oran taşır",
    { clicks: 0, impressions: 0, ctr: null, position: null },
    { clicks: 0, impressions: 0, ctr: null, position: null },
    true,
  ],
  [
    "I12 sıfır gösterimde sahte sıfır CTR reddedilir",
    { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    { clicks: 0, impressions: 0, ctr: null, position: null },
    false,
  ],
];
it.each(cases)("%s", (name, a, e, pass) =>
  expect(metricErrors(a, e, "test").length === 0).toBe(pass),
);
const original: SourceRecord = {
  product_id: "brosur",
  path: "print/brosur/Keyword Stats 2026-10-01 at 01_00_00.csv",
  sha256: "known-source-hash",
  row_count: 10,
  exported_at: "2026-10-01T01:00:00",
};
it.each([
  ["I13 hash değişimi", { sha256: "changed" }],
  ["I14 yanlış ürün", { product_id: "zarf" }],
  ["I15 yanlış satır sayısı", { row_count: 11 }],
  ["I16 yanlış rapor tarihi", { exported_at: "2026-10-02T01:00:00" }],
  ["I17 eksik DB satırı", { actual_rows: 9 }],
  ["I18 yanlış klasör", { source_folder: "print/zarf" }],
  ["I19 bilinmeyen kaynak", { path: "other/file.csv" }],
] as [string, Partial<SourceRecord>][])("%s", (name, patch) =>
  expect(
    archiveIssues([{ ...original, ...patch }], [original]).length,
  ).toBeGreaterThan(0),
);
it("I20 eksik dosya raporlanır", () =>
  expect(archiveIssues([], [original])[0].code).toBe("SOURCE_MISSING"));
it("I21 yinelenen dosya toplam talep sayılmaz", () =>
  expect(archiveIssues([original, original], [original])[0].code).toBe(
    "DUPLICATE_SOURCE_PATH",
  ));
it("I22 bütün provenance eşleşince kaynak geçer", () =>
  expect(
    archiveIssues(
      [{ ...original, actual_rows: 10, source_folder: "print/brosur" }],
      [original],
    ),
  ).toEqual([]));
const state = {
  connected: true,
  missing: false,
  failed: false,
  errors: false,
  partial: false,
  queryDifference: false,
};
it.each([
  ["I23 sağlam ölçüm", {}, "Doğrulandı"],
  ["I24 bağlantısız", { connected: false }, "Veri yetersiz"],
  ["I25 eksik tarih", { missing: true }, "Veri yetersiz"],
  ["I26 API hatası", { failed: true }, "Senkronizasyon hatası"],
  ["I27 hesap hatası", { errors: true }, "Kısmen doğrulandı"],
  ["I28 örneklenmiş yanıt", { partial: true }, "Kısmen doğrulandı"],
  [
    "I29 sorgu/sayfa farkı",
    { queryDifference: true },
    "Kaynaklar arasında açıklanması gereken fark",
  ],
] as [string, Partial<typeof state>, string][])("%s", (name, patch, expected) =>
  expect(reliability({ ...state, ...patch })).toBe(expected),
);
const mutations: [string, (p: any, r: any) => void, string][] = [
  [
    "I30 cihaz toplamı",
    (p) => {
      p.devices[0].current.clicks++;
    },
    "CALCULATION_MISMATCH",
  ],
  [
    "I31 sorgu CTR",
    (p) => {
      p.queries[0].current.ctr = 0.5;
    },
    "CALCULATION_MISMATCH",
  ],
  [
    "I32 önceki sorgu konumu",
    (p) => {
      p.queries[0].previous.position = 99;
    },
    "CALCULATION_MISMATCH",
  ],
  [
    "I33 koruma bayrağı",
    (p) => {
      p.queries[0].protect = false;
    },
    "PROTECTION_FLAG_MISSING",
  ],
  [
    "I34 görünür marka toplamı",
    (p) => {
      p.brand.non_brand.clicks++;
    },
    "CALCULATION_MISMATCH",
  ],
  [
    "I35 UI sorgu yansıtması",
    (p) => {
      p.queries[0].clicks = 0;
    },
    "QUERY_PROJECTION_MISMATCH",
  ],
  [
    "I36 tıklama farkı",
    (p) => {
      p.calculation.click_delta = 999;
    },
    "CLICK_DELTA_MISMATCH",
  ],
  [
    "I37 değişim oranı",
    (p) => {
      p.calculation.click_change = 999;
    },
    "CLICK_RATIO_MISMATCH",
  ],
  [
    "I38 gösterim farkı",
    (p) => {
      p.calculation.impression_delta = 999;
    },
    "IMPRESSION_CHANGE_MISMATCH",
  ],
  [
    "I39 gün sayısı",
    (p, r) => {
      r.period.days = 31;
    },
    "PERIOD_DAY_COUNT_MISMATCH",
  ],
  [
    "I40 eksik kanıt",
    (p) => {
      p.evidence = [];
    },
    "MISSING_EVIDENCE_GATE",
  ],
  [
    "I41 yanlış marka sınıfı",
    (p) => {
      p.queries[0].is_brand = true;
    },
    "BRAND_CLASSIFICATION_MISMATCH",
  ],
];
it.each(mutations)("%s", async (name, mutate, code) => {
  await auditSeed();
  const report = await analyze(env, "2026-09", AUDIT_TIME);
  mutate(
    report.products.find((p) => p.id === "brosur"),
    report,
  );
  expect((await validateAnalysis(env, report)).join()).toContain(code);
});
it("I42 normal sorgu gizliliği farkı veri bozulması sayılmaz", async () => {
  await auditSeed();
  await env.DB.prepare(
    "UPDATE gsc_daily_by_query_device SET clicks=5,ctr=0.05",
  ).run();
  const r = await dataIntegrity(env, "2026-09", AUDIT_TIME);
  expect(r.metric_errors).toEqual([]);
  expect(r.products.find((p) => p.product_id === "brosur")!.state).toBe(
    "Kaynaklar arasında açıklanması gereken fark",
  );
  expect(r.issues.some((i) => i.source === "gsc")).toBe(false);
});
it("I43 geçersiz kaynak CTR kararı durdurur; eski audit sonucu silinmez", async () => {
  await auditSeed();
  await dataIntegrity(env, "2026-09", AUDIT_TIME);
  await env.DB.prepare("UPDATE gsc_daily_by_page SET ctr=0.8").run();
  const r = await dataIntegrity(env, "2026-09", AUDIT_TIME);
  expect(r.issues.some((i) => i.code === "INVALID_SOURCE_METRICS")).toBe(true);
  expect(
    await env.DB.prepare(
      "SELECT status,code FROM health_checks WHERE provider='gsc' ORDER BY day DESC LIMIT 1",
    ).first(),
  ).toMatchObject({ status: "failed", code: "DATA_AUDIT_FAILED" });
  expect(
    (await analyze(env, "2026-09", AUDIT_TIME)).products.find(
      (p) => p.id === "brosur",
    )!.decision,
  ).toBe("Veri bekle");
  expect(
    (await env.DB.prepare(
      "SELECT count(*) n FROM insight_runs WHERE kind='data-integrity'",
    ).first<{ n: number }>())!.n,
  ).toBe(2);
});
it("I44 başarılı senkron kaynak özel sayım makbuzu üretir; tekrar çoğalmaz", async () => {
  const cfg = await connected();
  await enqueue();
  const job = (await claimJob(cfg))!;
  const mock = fetcher(async () =>
    Response.json({
      responseAggregationType: "byPage",
      rows: [
        {
          keys: ["2026-09-01", "https://mavibasim.com/brosur", "tur", "MOBILE"],
          clicks: 1,
          impressions: 10,
          ctr: 0.1,
          position: 2,
        },
      ],
    }),
  );
  await processJob(cfg, job, mock);
  await processJob(cfg, job, mock);
  const receipts = (
    await env.DB.prepare(
      "SELECT result_json FROM insight_runs WHERE kind='sync-audit'",
    ).all<{ result_json: string }>()
  ).results;
  expect(receipts).toHaveLength(1);
  expect(JSON.parse(receipts[0].result_json)).toMatchObject({
    source: "gsc",
    expected_rows: 1,
    actual_rows: 1,
    status: "Doğrulandı",
  });
});
it("I45 DB tekrar kayıt ve yanlış foreign key ile kaynak kirlenemez", async () => {
  await auditSeed();
  await expect(
    env.DB.prepare(
      "INSERT INTO gsc_daily_by_page SELECT * FROM gsc_daily_by_page LIMIT 1",
    ).run(),
  ).rejects.toThrow();
  await expect(
    env.DB.prepare(
      "INSERT INTO keyword_catalog VALUES('bad','missing-product','x','x')",
    ).run(),
  ).rejects.toThrow();
});

it("I46 aynı zaman damgasıyla başarısız sağlık eski Koru önbelleğini geçersiz kılar", async () => {
  await auditSeed(new Date());
  const { getReport } = await import("../src/index");
  const a = await getReport(env, "2026-09");
  expect(a.products.find((p) => p.id === "brosur")!.decision).toBe("Koru");
  await env.DB.prepare(
    "UPDATE health_checks SET checked_at=?,status='failed',code='DATA_AUDIT_FAILED' WHERE provider='gsc'",
  )
    .bind(a.created_at)
    .run();
  const b = await getReport(env, "2026-09");
  expect(b.products.find((p) => p.id === "brosur")!.decision).toBe(
    "Veri bekle",
  );
});
it("I47 son iki kapanmış ayın bitmiş işleri günlük yeniden doğrulamaya girer", async () => {
  const cfg = await connected();
  const { enqueueDaily } = await import("../src/sync");
  await enqueueDaily(cfg, new Date("2026-11-22T00:00:00Z"));
  for (const day of ["2026-10-31", "2026-09-30"]) {
    await env.DB.prepare(
      "UPDATE sync_jobs SET status='done',updated_at='2026-11-22T00:00:00Z' WHERE day=?",
    )
      .bind(day)
      .run();
    for (const scope of ["page", "query"])
      await env.DB.prepare(
        "INSERT INTO dataset_coverage VALUES('gsc',?,?,?,1,0,0,'2026-11-22T00:00:00Z','TEST-ONLY finalized empty dataset')",
      )
        .bind(day, scope, day + scope)
        .run();
  }
  await enqueueDaily(cfg, new Date("2026-11-23T00:00:00Z"));
  for (const day of ["2026-10-31", "2026-09-30"])
    expect(
      (await env.DB.prepare(
        "SELECT count(*) n FROM sync_jobs WHERE day=? AND provider='gsc' AND status='pending' AND updated_at='2026-11-23T00:00:00.000Z'",
      )
        .bind(day)
        .first<{ n: number }>())!.n,
    ).toBe(2);
});

it("I48 29 üründe tek denetim Free 50 D1 sorgu bütçesini aşmaz", async () => {
  await auditSeed();
  const { default: manifest } = await import("../src/source-manifest.json");
  for (const id of new Set(manifest.map((s) => s.product_id)))
    if (!["brosur", "el-ilani"].includes(id))
      await env.DB.prepare(
        "INSERT INTO products(id,group_id,name,source_folder) VALUES(?,?,?,?)",
      )
        .bind(id, "print", id, "fixture/" + id)
        .run();
  let prepared = 0;
  const db = new Proxy(env.DB, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (key === "prepare") prepared++;
        return Reflect.apply(value, target, args);
      };
    },
  });
  const r = await dataIntegrity({ ...env, DB: db }, "2026-09", AUDIT_TIME);
  expect(r.products).toHaveLength(29);
  expect(prepared).toBeLessThanOrEqual(50);
});
it("bounded range audit never treats intentionally truncated analysis as corrupt Google data or writes failed health", async () => {
  const row = {
    date: "2026-09-01",
    page: "https://mavibasim.com/brosur",
    device: "MOBILE",
    country: "tur",
    clicks: 1,
    impressions: 100,
    position: 3,
  };
  const db = new Proxy(env.DB, {
    get(target, key) {
      if (key !== "prepare") {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (sql: string) => {
        if (sql.includes("SELECT d.* FROM gsc_daily_by_page"))
          return {
            bind() {
              return this;
            },
            async all() {
              return { results: Array(50001).fill(row) };
            },
          };
        return target.prepare(sql);
      };
    },
  });
  await expect(
    dataIntegrity({ ...env, DB: db }, "2026-09", AUDIT_TIME),
  ).rejects.toThrow("AUDIT_ROW_LIMIT");
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM health_checks WHERE code='DATA_AUDIT_FAILED'",
    ).first(),
  ).toMatchObject({ n: 0 });
});
