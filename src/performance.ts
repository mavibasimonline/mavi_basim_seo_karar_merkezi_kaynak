import { Env, dateDaysAgo } from "./types";
import {
  dates,
  monthPeriod,
  lastCompleteMonth,
  Metrics,
  validMetrics,
} from "./analysis";

export function deviceFilter(value: string | null) {
  if (!value || value === "ALL") return null;
  if (!["MOBILE", "DESKTOP", "TABLET"].includes(value))
    throw Error("INVALID_DEVICE");
  return value;
}
function periodFor(month: string, time: Date) {
  const p = monthPeriod(month);
  if (month < "2020-01" || month > time.toISOString().slice(0, 7))
    throw Error("INVALID_MONTH");
  return p;
}
type Daily = {
  day: string;
  dataset_id: string;
  row_count: number;
  actual_rows: number;
  bad_rows: number;
  selected_rows: number;
  clicks: number | null;
  impressions: number | null;
  weighted_position: number | null;
  fetched_at: string;
};
const tables = {
  page: "gsc_daily_by_page",
  query: "gsc_daily_by_query_device",
} as const;
// Whole-dataset counts are checked before any device/search filter is applied.
async function daily(
  env: Env,
  start: string,
  end: string,
  scope: keyof typeof tables,
  device: string | null,
  time: Date,
): Promise<Daily[]> {
  return (
    await env.DB.prepare(
      `SELECT c.day,c.dataset_id,c.row_count,c.fetched_at,count(d.dataset_id) actual_rows,
    COALESCE(sum(CASE WHEN d.dataset_id IS NOT NULL AND (d.clicks!=CAST(d.clicks AS INTEGER) OR d.impressions!=CAST(d.impressions AS INTEGER)
      OR d.clicks<0 OR d.impressions<d.clicks OR d.position<0 OR d.device NOT IN ('MOBILE','DESKTOP','TABLET')
      OR length(d.country)!=3 OR d.country GLOB '*[^A-Za-z]*' OR d.page NOT LIKE 'https://mavibasim.com/%'
      OR (d.impressions=0 AND d.ctr!=0) OR (d.impressions>0 AND abs(d.ctr-d.clicks/d.impressions)>0.000001)
      ${scope === "query" ? "OR trim(d.query)='' OR length(d.query)>2000 OR d.is_brand NOT IN (0,1)" : ""}) THEN 1 ELSE 0 END),0) bad_rows,
    sum(CASE WHEN d.dataset_id IS NOT NULL AND (? IS NULL OR d.device=?) THEN 1 ELSE 0 END) selected_rows,
    sum(CASE WHEN ? IS NULL OR d.device=? THEN d.clicks END) clicks,
    sum(CASE WHEN ? IS NULL OR d.device=? THEN d.impressions END) impressions,
    sum(CASE WHEN ? IS NULL OR d.device=? THEN d.position*d.impressions END) weighted_position
    FROM dataset_coverage c LEFT JOIN ${tables[scope]} d ON d.dataset_id=c.dataset_id AND d.date=c.day
    WHERE c.provider='gsc' AND c.scope=? AND c.complete=1 AND c.day BETWEEN ? AND ? AND c.day<=?
    GROUP BY c.day,c.dataset_id,c.row_count,c.fetched_at ORDER BY c.day`,
    )
      .bind(
        device,
        device,
        device,
        device,
        device,
        device,
        device,
        device,
        scope,
        start,
        end,
        dateDaysAgo(3, time),
      )
      .all<Daily>()
  ).results;
}
function aggregate(row: {
  selected_rows: number;
  clicks: number | null;
  impressions: number | null;
  weighted_position: number | null;
}): Metrics | null {
  if (!row.selected_rows) return null; // No observed row is not a measured zero.
  const clicks = row.clicks!,
    impressions = row.impressions!;
  const result = {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    position: impressions ? row.weighted_position! / impressions : null,
  };
  return validMetrics(result) ? result : null;
}
function checked(row: Daily) {
  return (
    row.actual_rows === row.row_count &&
    row.bad_rows === 0 &&
    (!row.selected_rows || aggregate(row) !== null)
  );
}
function sum(rows: Daily[]) {
  return aggregate(
    rows.reduce(
      (a, r) => ({
        selected_rows: a.selected_rows + r.selected_rows,
        clicks: a.clicks + (r.clicks || 0),
        impressions: a.impressions + (r.impressions || 0),
        weighted_position: a.weighted_position + (r.weighted_position || 0),
      }),
      { selected_rows: 0, clicks: 0, impressions: 0, weighted_position: 0 },
    ),
  );
}

export async function performance(
  env: Env,
  month = lastCompleteMonth(),
  device: string | null = null,
  time = new Date(),
) {
  device = deviceFilter(device);
  const period = periodFor(month, time),
    previous = monthPeriod(month, -1);
  const [rows, credential, health, catalog, archive] = await Promise.all([
    daily(env, previous.start, period.end, "page", device, time),
    env.DB.prepare(
      "SELECT 1 present FROM oauth_credentials WHERE provider='google'",
    ).first(),
    env.DB.prepare(
      "SELECT status,code,checked_at FROM health_checks WHERE provider='gsc' ORDER BY day DESC LIMIT 1",
    ).first<{ status: string; code: string | null; checked_at: string }>(),
    env.DB.prepare(
      "SELECT p.id,p.name,p.canonical_url url,p.url_verified_at,g.name group_name,count(s.id) keyword_sources,COALESCE(sum(s.row_count),0) keyword_rows FROM products p JOIN product_groups g ON g.id=p.group_id LEFT JOIN keyword_sources s ON s.product_id=p.id GROUP BY p.id ORDER BY p.name",
    ).all(),
    env.DB.prepare(
      "SELECT count(*) csv_files,COALESCE(sum(row_count),0) csv_rows FROM keyword_sources",
    ).first(),
  ]);
  const usable = rows.filter(checked),
    currentRows = usable.filter((r) => r.day >= period.start),
    previousRows = usable.filter((r) => r.day <= previous.end);
  const current = sum(currentRows),
    before = sum(previousRows),
    complete = currentRows.length === period.days,
    previousComplete = previousRows.length === previous.days;
  const observed = currentRows.filter((r) => r.selected_rows > 0).length,
    previousObserved = previousRows.filter((r) => r.selected_rows > 0).length;
  const fetched =
    currentRows
      .map((r) => r.fetched_at)
      .sort()
      .at(-1) || null;
  const recent = (value: string | null | undefined) =>
    !!value &&
    time.getTime() - Date.parse(value) >= 0 &&
    time.getTime() - Date.parse(value) < 72 * 3600_000;
  const fresh =
    !!credential &&
    health?.status === "ok" &&
    recent(health.checked_at) &&
    recent(fetched);
  const finished =
    Date.parse(period.end + "T23:59:59Z") + 3 * 86400_000 < time.getTime();
  return {
    source: "Google Search Console",
    scope: "page/country/device",
    timezone: "America/Los_Angeles",
    measured_at: time.toISOString(),
    last_fetched_at: fetched,
    google_connected: !!credential,
    fresh,
    health,
    period,
    previous_period: previous,
    device,
    catalog: catalog.results,
    archive,
    coverage: {
      verified_days: currentRows.length,
      observed_days: observed,
      expected_days: period.days,
      complete,
      measurement_complete: observed === period.days,
      previous_verified_days: previousRows.length,
      previous_expected_days: previous.days,
      previous_complete: previousComplete,
      invalid_days: rows.filter((r) => !checked(r)).map((r) => r.day),
    },
    current,
    previous: before,
    comparison_available:
      !!current &&
      !!before &&
      complete &&
      previousComplete &&
      observed === period.days &&
      previousObserved === previous.days &&
      finished &&
      fresh,
    series: dates(period).map((day) => {
      const row = currentRows.find((r) => r.day === day);
      return {
        day,
        verified: !!row,
        metrics: row ? aggregate(row) : null,
        fetched_at: row?.fetched_at || null,
        dataset_id: row?.dataset_id || null,
      };
    }),
    notes: [
      "Yalnız doğrulanmış aktif GSC sayfa veri kümeleri kullanılır; eksik gün ve gözlenmeyen cihaz sıfır değildir.",
      "CTR = toplam tıklama / toplam gösterim. Ortalama konum = toplam(konum × gösterim) / toplam gösterim.",
      "Kısmi dönemlerden tam aylık karşılaştırma veya SEO kararı üretilmez. GSC sayfa boyutları mülk toplamından farklı olabilir.",
    ],
  };
}

export async function performanceQueries(
  env: Env,
  params: URLSearchParams,
  time = new Date(),
) {
  const period = periodFor(
      params.get("month") || lastCompleteMonth(time),
      time,
    ),
    device = deviceFilter(params.get("device"));
  const search = params.get("q") || "",
    product = params.get("product") || "",
    brand = params.get("brand") || "all";
  if (
    search.length > 200 ||
    product.length > 100 ||
    !["all", "brand", "non_brand"].includes(brand)
  )
    throw Error("INVALID_QUERY_FILTER");
  const sorts = {
    clicks: "clicks",
    impressions: "impressions",
    ctr: "ctr",
    position: "position",
    query: "query",
  } as const;
  const sort = params.get("sort") || "impressions",
    direction = params.get("direction") || "desc";
  if (!Object.hasOwn(sorts, sort) || !["asc", "desc"].includes(direction))
    throw Error("INVALID_QUERY_SORT");
  const page = Number(params.get("page") || "1");
  if (!Number.isInteger(page) || page < 1 || page > 200)
    throw Error("INVALID_QUERY_PAGE");
  const coverage = await daily(
      env,
      period.start,
      period.end,
      "query",
      device,
      time,
    ),
    ids = coverage.filter(checked).map((r) => r.dataset_id);
  const note =
    "GSC görünür sorgu alt kümesidir. Anonimleştirilmiş veya API tarafından sağlanmayan sorgular eksik olabilir; sayfa toplamlarıyla eşit kabul edilmez. Keyword Planner hacmi içermez.";
  if (!ids.length)
    return {
      source: "Google Search Console",
      period,
      device,
      page,
      rows: [],
      has_next: false,
      verified_days: 0,
      note,
    };
  const pattern =
    "%" + search.toLocaleLowerCase("tr-TR").replace(/[\\%_]/g, "\\$&") + "%";
  const rows = (
    await env.DB.prepare(
      `SELECT d.query,d.page,d.device,d.is_brand,p.id product_id,p.name product_name,
    sum(d.clicks) clicks,sum(d.impressions) impressions,CASE WHEN sum(d.impressions)>0 THEN sum(d.clicks)/sum(d.impressions) END ctr,
    CASE WHEN sum(d.impressions)>0 THEN sum(d.position*d.impressions)/sum(d.impressions) END position,max(c.fetched_at) fetched_at
    FROM gsc_daily_by_query_device d JOIN dataset_coverage c ON c.dataset_id=d.dataset_id AND c.day=d.date AND c.provider='gsc' AND c.scope='query' AND c.complete=1
    LEFT JOIN products p ON p.canonical_url=d.page AND p.url_verified_at IS NOT NULL
    WHERE d.dataset_id IN (${ids.map(() => "?").join(",")}) AND (? IS NULL OR d.device=?)
    AND lower(replace(replace(d.query,'İ','i'),'I','ı')) LIKE ? ESCAPE '\\'
    AND (?='' OR p.id=?) AND (?='all' OR d.is_brand=?)
    GROUP BY d.query,d.page,d.device,d.is_brand,p.id,p.name ORDER BY ${sorts[sort as keyof typeof sorts]} ${direction},d.query,d.page,d.device LIMIT 51 OFFSET ?`,
    )
      .bind(
        ...ids,
        device,
        device,
        pattern,
        product,
        product,
        brand,
        brand === "brand" ? 1 : 0,
        (page - 1) * 50,
      )
      .all()
  ).results;
  return {
    source: "Google Search Console",
    period,
    device,
    page,
    rows: rows.slice(0, 50),
    has_next: rows.length > 50,
    verified_days: ids.length,
    note,
  };
}
