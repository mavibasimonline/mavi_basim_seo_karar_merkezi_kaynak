import { Env, Fetch } from './types';
import { googleJSON, ProviderError } from './google';
import { isBrand, siteURL } from './urls';

export const PAGE_SIZE = 200;
export interface GscRow { date: string; page: string; country: string; device: string; query?: string; is_brand?: number; clicks: number; impressions: number; ctr: number; position: number }
export interface Ga4Row { date: string; landing_page: string; country: string; city: string; device: string; sessions: number; engaged_sessions: number; key_events: number | null }
export interface Page<T> { rows: T[]; next: number | null; complete: boolean; notes: string }
interface GscReply { rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[]; responseAggregationType?: string; metadata?: { first_incomplete_date?: string } }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Fixed categories only: never persist the rejected URL, query, metrics or tokens.
export function gscRowIssue(row: GscRow, day: string): string|null {
  if(row.date!==day)return 'DATE';
  if(!siteURL(row.page)){
    try{
      const url=new URL(row.page);
      if(!url.username&&!url.password){
        if(url.hostname==='mavibasim.com'&&url.protocol==='http:')return 'PAGE_HTTP_APEX';
        if(url.hostname==='www.mavibasim.com'&&['http:','https:'].includes(url.protocol))return 'PAGE_WWW';
      }
    }catch{/* Only a fixed category leaves this validator. */}
    return 'PAGE_ORIGIN';
  }
  if(!/^[a-zA-Z]{3}$/.test(row.country))return 'COUNTRY';
  if(!['MOBILE','DESKTOP','TABLET'].includes(row.device))return 'DEVICE';
  if(![row.clicks,row.impressions,row.ctr,row.position].every(finite))return 'METRIC_NUMBER';
  if(row.clicks<0||row.impressions<row.clicks||!Number.isInteger(row.clicks)||!Number.isInteger(row.impressions))return 'COUNTS';
  if(row.ctr<0||row.ctr>1||row.position<0)return 'METRIC_RANGE';
  if(row.impressions>0&&Math.abs(row.ctr-row.clicks/row.impressions)>0.000001)return 'CTR_RATIO';
  if(row.query!==undefined&&(!row.query.trim()||row.query.length>2000))return 'QUERY';
  return null;
}
export function validateGscRow(row: GscRow, day: string): void {
  const issue=gscRowIssue(row,day);
  if(issue)throw new ProviderError('INVALID_GSC_ROW_'+issue);
}
export async function fetchGsc(env: Env, day: string, scope: string, cursor = 0, fetcher: Fetch = fetch): Promise<Page<GscRow>> {
  if (!env.GSC_PROPERTY || !['page','query'].includes(scope)) throw new ProviderError('GSC_CONFIGURATION_MISSING');
  const dimensions = scope === 'query' ? ['date','page','query','country','device'] : ['date','page','country','device'];
  const reply = await googleJSON<GscReply>(env, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(env.GSC_PROPERTY)}/searchAnalytics/query`, {
    startDate: day, endDate: day, dimensions, type: 'web', dataState: 'final', aggregationType: 'byPage', rowLimit: PAGE_SIZE, startRow: cursor,
  }, fetcher);
  if (!reply || (reply.rows !== undefined && !Array.isArray(reply.rows)) || reply.responseAggregationType !== 'byPage') throw new ProviderError('INVALID_GSC_RESPONSE');
  const keysSeen = new Set<string>();
  const rows = (reply.rows || []).map(raw => {
    if (!Array.isArray(raw.keys) || raw.keys.length !== dimensions.length || !raw.keys.every(k => typeof k === 'string')) throw new ProviderError('INVALID_GSC_DIMENSIONS');
    const dims = Object.fromEntries(dimensions.map((key, i) => [key, raw.keys[i]]));
    const row: GscRow = { date: dims.date, page: siteURL(dims.page) || dims.page, country: dims.country, device: dims.device.toUpperCase(), clicks: raw.clicks, impressions: raw.impressions, ctr: raw.ctr, position: raw.position };
    if (scope === 'query') { row.query = dims.query; row.is_brand = Number(isBrand(dims.query)); }
    validateGscRow(row, day);
    const key = JSON.stringify([row.date,row.page,row.query,row.country,row.device]);
    if (keysSeen.has(key)) throw new ProviderError('DUPLICATE_GSC_ROW');
    keysSeen.add(key);
    return row;
  });
  const partial = !!reply.metadata?.first_incomplete_date && reply.metadata.first_incomplete_date <= day;
  return { rows, next: rows.length === PAGE_SIZE ? cursor + rows.length : null, complete: !partial,
    notes: scope === 'query' ? 'GSC sorguları anonimleştirme ve üst satır sınırı nedeniyle eksik olabilir; eksik sorgu sıfır değildir.' : 'GSC web, byPage, final; günler Search Console Pasifik saat dilimindedir.' };
}

interface Ga4Reply {
  dimensionHeaders?: { name: string }[]; metricHeaders?: { name: string }[];
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  rowCount?: number; metadata?: { dataLossFromOtherRow?: boolean; subjectToThresholding?: boolean; samplingMetadatas?: unknown[]; timeZone?: string };
}
export async function fetchGa4(env: Env, day: string, cursor = 0, fetcher: Fetch = fetch): Promise<Page<Ga4Row>> {
  if (!/^\d+$/.test(env.GA4_PROPERTY_ID || '')) throw new ProviderError('GA4_NOT_CONFIGURED');
  const dimensions = ['date','landingPagePlusQueryString','country','city','deviceCategory'];
  // Key events intentionally omitted: configuration/attribution must be verified first.
  const metrics = ['sessions','engagedSessions'];
  const reply = await googleJSON<Ga4Reply>(env, `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`, {
    dateRanges: [{ startDate: day, endDate: day }], dimensions: dimensions.map(name => ({ name })), metrics: metrics.map(name => ({ name })),
    dimensionFilter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Organic Search', caseSensitive: true } } },
    orderBys: dimensions.map(dimensionName => ({ dimension: { dimensionName } })), limit: PAGE_SIZE, offset: cursor, keepEmptyRows: false,
  }, fetcher);
  if (!reply || JSON.stringify(reply.dimensionHeaders?.map(h => h.name)) !== JSON.stringify(dimensions)
      || JSON.stringify(reply.metricHeaders?.map(h => h.name)) !== JSON.stringify(metrics)
      || !Number.isInteger(reply.rowCount) || reply.rowCount! < 0 || (reply.rows !== undefined && !Array.isArray(reply.rows))) throw new ProviderError('INVALID_GA4_RESPONSE');
  const rows = (reply.rows || []).map(raw => {
    if (!Array.isArray(raw.dimensionValues) || !Array.isArray(raw.metricValues) || raw.dimensionValues.length !== 5 || raw.metricValues.length !== 2) throw new ProviderError('INVALID_GA4_DIMENSIONS');
    const [date, landing_page, country, city, device] = raw.dimensionValues.map(v => v.value);
    const [sessions, engaged_sessions] = raw.metricValues.map(v => Number(v.value));
    if (date !== day.replaceAll('-','') || ![landing_page,country,city,device].every(v => typeof v === 'string' && !!v)
        || ![sessions,engaged_sessions].every(v => Number.isSafeInteger(v) && v >= 0) || engaged_sessions > sessions) throw new ProviderError('INVALID_GA4_ROW');
    return { date: day, landing_page, country, city, device, sessions, engaged_sessions, key_events: null };
  });
  if (cursor + rows.length > reply.rowCount! || (!rows.length && cursor < reply.rowCount!)) throw new ProviderError('INCOMPLETE_GA4_PAGINATION');
  const partial = reply.metadata?.dataLossFromOtherRow || reply.metadata?.subjectToThresholding || !!reply.metadata?.samplingMetadatas?.length;
  return { rows, next: cursor + rows.length < reply.rowCount! ? cursor + rows.length : null, complete: !partial,
    notes: `Yalnızca Organic Search oturumları; sorgu/tıklama metriği değildir. GA4 saat dilimi: ${reply.metadata?.timeZone || 'bilinmiyor'}. Key events yapılandırması doğrulanmadığından null.` };
}

export interface AdsReply { results?: { text: string; closeVariants?: string[]; keywordMetrics?: { avgMonthlySearches?: string; competition?: string; monthlySearchVolumes?: { year: string; month: string; monthlySearches?: string }[] } }[] }
export async function fetchKeywordPlanner(env: Env, keywords: string[], fetcher: Fetch = fetch): Promise<AdsReply> {
  if (env.ENABLE_GOOGLE_ADS !== 'true' || !env.GOOGLE_ADS_DEVELOPER_TOKEN || !/^\d+$/.test(env.GOOGLE_ADS_CUSTOMER_ID || '') || !/^v\d+$/.test(env.GOOGLE_ADS_API_VERSION || '')) throw new ProviderError('ADS_ACCESS_NOT_CONFIGURED');
  if (!keywords.length || keywords.length > 1000) throw new ProviderError('INVALID_ADS_KEYWORD_COUNT');
  const headers: Record<string,string> = { 'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN };
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const reply = await googleJSON<AdsReply>(env, `https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION}/customers/${env.GOOGLE_ADS_CUSTOMER_ID}:generateKeywordHistoricalMetrics`, {
    keywords, keywordPlanNetwork: 'GOOGLE_SEARCH', language: 'languageConstants/1037', geoTargetConstants: ['geoTargetConstants/2792'],
  }, fetcher, headers);
  if (!Array.isArray(reply.results) || reply.results.some(r => typeof r.text !== 'string')) throw new ProviderError('INVALID_ADS_RESPONSE');
  return reply;
}
