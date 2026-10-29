export interface Env {
  DRIVE_ARCHIVE_SERVICE?: Fetcher;
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_ORIGIN: string;
  ADMIN_TOKEN?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GSC_PROPERTY?: string;
  GA4_PROPERTY_ID?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  GOOGLE_ADS_CUSTOMER_ID?: string;
  GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
  GOOGLE_ADS_API_VERSION?: string;
  ENABLE_GOOGLE_ADS?: string;
  CRAWL_ENABLED?: string;
  AUTOMATION_ENABLED?: string;
  CATCHUP_ENABLED?: string;
  SYNC_DAILY_WRITE_LIMIT?:string;
  SYNC_INITIAL_BUDGET_DAY?:string;
  SYNC_INITIAL_WRITE_LIMIT?:string;
  D1_READ_GUARD_ENABLED?:string;
  SYNC_MAX_PAGES_PER_TICK?:string;
  CF_VERSION_METADATA?: {id:string;tag?:string;timestamp?:string};
}
export type Fetch = typeof fetch;
export const nowISO = () => new Date().toISOString();
export const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function dateDaysAgo(days: number, now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)).toISOString().slice(0, 10);
}
