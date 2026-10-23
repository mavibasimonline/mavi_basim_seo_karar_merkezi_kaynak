import { Env, Fetch, dateDaysAgo, nowISO } from './types';
import { ProviderError } from './google';
import { fetchGsc, fetchGa4, fetchKeywordPlanner, GscRow, Ga4Row } from './providers';

export interface Job { id: string; provider: string; day: string; scope: string; generation: string; cursor: number; attempts: number; lease_token: string; quality_failed: number }
type Row = Record<string, string | number | null>;

export function insertRows(db: D1Database, table: string, rows: Row[], guard?: Job): D1PreparedStatement[] {
  if (!rows.length) return [];
  const columns = Object.keys(rows[0]);
  const size = Math.floor((90 - (guard ? 2 : 0)) / columns.length);
  const queries: D1PreparedStatement[] = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    const chunk = rows.slice(offset, offset + size);
    const values = chunk.flatMap(row => columns.map(key => row[key]));
    const placeholders = chunk.map(() => `(${columns.map(() => '?').join(',')})`).join(',');
    const statement = guard
      ? `WITH incoming(${columns.join(',')}) AS (VALUES ${placeholders}) INSERT OR REPLACE INTO ${table}(${columns.join(',')}) SELECT * FROM incoming WHERE EXISTS(SELECT 1 FROM sync_jobs WHERE id=? AND lease_token=? AND status='running')`
      : `INSERT OR IGNORE INTO ${table}(${columns.join(',')}) VALUES ${placeholders}`;
    queries.push(db.prepare(statement).bind(...values, ...(guard ? [guard.id, guard.lease_token] : [])));
  }
  return queries;
}
export async function enqueueDaily(env: Env, time = new Date()): Promise<boolean> {
  const day = time.toISOString().slice(0,10);
  const stamp = time.toISOString();
  const already = await env.DB.prepare("SELECT 1 FROM health_checks WHERE provider='scheduler' AND day=?").bind(day).first();
  if (already) return false;
  const connected = await env.DB.prepare("SELECT 1 FROM oauth_credentials WHERE provider='google'").first();
  const jobs: Row[] = [];
  if (connected) {
    for (let days = 3; days <= 92; days++) {
      const date = dateDaysAgo(days,time);
      for (const [provider,scope] of [['gsc','page'],['gsc','query'], ...(env.GA4_PROPERTY_ID ? [['ga4','organic']] : [])]) {
        jobs.push({ id: `${provider}:${date}:${scope}`, provider, day: date, scope, generation: crypto.randomUUID(), next_attempt_at: stamp, created_at: stamp, updated_at: stamp });
      }
    }
  }
  const statements = insertRows(env.DB,'sync_jobs',jobs);
  statements.push(env.DB.prepare("UPDATE sync_jobs SET status='pending',generation=lower(hex(randomblob(16))),cursor=0,quality_failed=0,attempts=0,next_attempt_at=?,updated_at=? WHERE status='done' AND day>=? AND day<=? AND substr(updated_at,1,10)<?")
    .bind(stamp,stamp,dateDaysAgo(9,time),dateDaysAgo(3,time),day));
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO health_checks VALUES('scheduler',?,?,?,?)").bind(day,stamp,connected ? 'queued' : 'blocked',connected ? null : 'GOOGLE_NOT_CONNECTED'));
  await env.DB.batch(statements);
  return true;
}
export async function claimJob(env: Env, time = new Date()): Promise<Job | null> {
  const stamp = time.toISOString();
  const token = crypto.randomUUID();
  return env.DB.prepare(`UPDATE sync_jobs SET status='running',lease_token=?,lease_until=?,updated_at=?
    WHERE id=(SELECT id FROM sync_jobs WHERE ((status IN ('pending','retry') AND next_attempt_at<=?) OR (status='running' AND lease_until<?))
    ORDER BY day DESC, provider, scope LIMIT 1) RETURNING *`)
    .bind(token,new Date(time.getTime()+180_000).toISOString(),stamp,stamp,stamp).first<Job>();
}
async function storePage(env: Env, job: Job, rows: GscRow[] | Ga4Row[], next: number | null, complete: boolean, notes: string, run: string): Promise<void> {
  let table: string;
  let records: Row[];
  if (job.provider === 'gsc') {
    table = job.scope === 'page' ? 'gsc_daily_by_page' : 'gsc_daily_by_query_device';
    records = (rows as GscRow[]).map(row => ({ dataset_id: job.generation, ...row }));
  } else {
    table = 'ga4_daily_by_city_device';
    records = (rows as Ga4Row[]).map(row => ({ dataset_id: job.generation, ...row }));
  }
  const statements = insertRows(env.DB,table,records,job);
  const stamp = nowISO();
  if (next === null) {
    statements.push(env.DB.prepare(`INSERT INTO dataset_coverage(provider,day,scope,dataset_id,complete,query_partial,row_count,fetched_at,notes)
      SELECT provider,day,scope,generation,?, ?, (SELECT count(*) FROM ${table} WHERE dataset_id=sync_jobs.generation),?,?
      FROM sync_jobs WHERE id=? AND lease_token=? AND status='running'
      ON CONFLICT(provider,day,scope) DO UPDATE SET dataset_id=excluded.dataset_id,complete=excluded.complete,query_partial=excluded.query_partial,row_count=excluded.row_count,fetched_at=excluded.fetched_at,notes=excluded.notes`)
      .bind(Number(complete && !job.quality_failed),Number(job.scope === 'query'),stamp,notes,job.id,job.lease_token));
  }
  statements.push(env.DB.prepare("UPDATE sync_jobs SET status=?,cursor=?,quality_failed=max(quality_failed,?),attempts=0,lease_token=NULL,lease_until=NULL,error_code=NULL,updated_at=? WHERE id=? AND lease_token=?")
    .bind(next === null ? 'done' : 'pending',next || 0,Number(!complete),stamp,job.id,job.lease_token));
  statements.push(env.DB.prepare("UPDATE sync_runs SET status='done',finished_at=?,rows_received=? WHERE id=?").bind(stamp,rows.length,run));
  statements.push(env.DB.prepare('INSERT INTO health_checks VALUES(?,?,?,?,?) ON CONFLICT(provider,day) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,code=excluded.code')
    .bind(job.provider,stamp.slice(0,10),stamp,complete ? 'ok' : 'partial',complete ? null : 'DATA_QUALITY_INCOMPLETE'));
  await env.DB.batch(statements);
}
export async function processJob(env: Env, job: Job, fetcher: Fetch = fetch): Promise<void> {
  const run = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sync_runs(id,job_id,started_at,status) VALUES(?,?,?,'running')").bind(run,job.id,nowISO()).run();
  try {
    if (job.provider === 'gsc') {
      const page = await fetchGsc(env,job.day,job.scope,job.cursor,fetcher);
      if (job.cursor + page.rows.length >= 50_000 && page.next !== null) throw new ProviderError('GSC_DAILY_ROW_LIMIT');
      await storePage(env,job,page.rows,page.next,page.complete,page.notes,run);
    } else if (job.provider === 'ga4') {
      const page = await fetchGa4(env,job.day,job.cursor,fetcher);
      await storePage(env,job,page.rows,page.next,page.complete,page.notes,run);
    } else if (job.provider === 'ads') {
      const words = await env.DB.prepare('SELECT keyword FROM keyword_catalog WHERE product_id=? ORDER BY keyword LIMIT 1000').bind(job.scope).all<{keyword:string}>();
      const reply = await fetchKeywordPlanner(env,words.results.map(r=>r.keyword),fetcher);
      const stamp=nowISO();
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO ads_observations VALUES(?,?,?,?,?)").bind(job.generation,job.scope,stamp,JSON.stringify({network:'GOOGLE_SEARCH',language:'tr',country:'TR',variants:'Google closeVariants birleştirebilir; hacimleri toplama.'}),JSON.stringify(reply)),
        env.DB.prepare("UPDATE sync_jobs SET status='done',lease_until=NULL,lease_token=NULL,updated_at=? WHERE id=? AND lease_token=?").bind(stamp,job.id,job.lease_token),
        env.DB.prepare("UPDATE sync_runs SET status='done',finished_at=? WHERE id=?").bind(stamp,run),
      ]);
    } else throw new ProviderError('UNKNOWN_PROVIDER');
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError('INTERNAL_SYNC_ERROR',true);
    const attempts = job.attempts + 1;
    const retry = failure.retryable && attempts < 6;
    const wait = Math.max(failure.retryAfterSeconds,Math.min(3600,60*2**(attempts-1))) + Math.floor(Math.random()*20);
    const stamp = nowISO();
    const next = new Date(Date.now()+wait*1000).toISOString();
    await env.DB.batch([
      env.DB.prepare('UPDATE sync_jobs SET status=?,attempts=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,error_code=?,updated_at=? WHERE id=? AND lease_token=?')
        .bind(retry?'retry':'blocked',attempts,next,failure.code,stamp,job.id,job.lease_token),
      env.DB.prepare("UPDATE sync_runs SET status='failed',finished_at=? WHERE id=?").bind(stamp,run),
      env.DB.prepare('INSERT INTO sync_errors(run_id,code,retry_at,created_at) VALUES(?,?,?,?)').bind(run,failure.code,retry?next:null,stamp),
      env.DB.prepare('INSERT INTO health_checks VALUES(?,?,?,?,?) ON CONFLICT(provider,day) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,code=excluded.code')
        .bind(job.provider,stamp.slice(0,10),stamp,'failed',failure.code),
    ]);
  }
}
export async function enqueueAds(env: Env): Promise<void> {
  if (env.ENABLE_GOOGLE_ADS !== 'true' || !env.GOOGLE_ADS_DEVELOPER_TOKEN) return;
  const stamp=nowISO(), month=stamp.slice(0,7);
  const products=await env.DB.prepare('SELECT id FROM products ORDER BY id').all<{id:string}>();
  await env.DB.batch(insertRows(env.DB,'sync_jobs',products.results.map(p=>({id:`ads:${month}:${p.id}`,provider:'ads',day:month+'-01',scope:p.id,generation:crypto.randomUUID(),next_attempt_at:stamp,created_at:stamp,updated_at:stamp}))));
}
