import {Env} from './types';

// Reserve before claiming/fetching. A crash retains the reservation until UTC reset.
// 200 rows: table + primary/secondary indexes, including REPLACE, plus metadata.
export const PAGE_WRITE_RESERVE=1500;
export function writeLimit(env:Env,time=new Date()){
  const day=time.toISOString().slice(0,10);
  const value=Number(day===env.SYNC_INITIAL_BUDGET_DAY?env.SYNC_INITIAL_WRITE_LIMIT:env.SYNC_DAILY_WRITE_LIMIT);
  return Number.isInteger(value)&&value>=PAGE_WRITE_RESERVE&&value<=60_000?value:10_000;
}
export async function syncBudget(env:Env,time=new Date()){
  const day=time.toISOString().slice(0,10),limit=writeLimit(env,time);
  const row=await env.DB.prepare("SELECT code FROM health_checks WHERE provider='sync-budget' AND day=?").bind(day).first<{code:string}>();
  const reserved=Number(row?.code||0);
  return {enabled:env.CATCHUP_ENABLED==='true',utc_day:day,write_limit:limit,reserved_writes:reserved,paused:reserved+PAGE_WRITE_RESERVE>limit,resumes_at:new Date(Date.parse(day)+86400_000).toISOString(),note:'Senkron yazma bütçesidir; hesap genelindeki D1 analitik kotası ayrıca izlenmelidir. Rezervasyonlar ve güvenlik payı dahildir.'};
}
export async function reserveSyncPage(env:Env,time:Date):Promise<boolean>{
  const limit=writeLimit(env,time);
  const result=await env.DB.prepare(`INSERT INTO health_checks(provider,day,checked_at,status,code) VALUES('sync-budget',? ,?,'ok',?)
    ON CONFLICT(provider,day) DO UPDATE SET code=CAST(CAST(health_checks.code AS INTEGER)+? AS TEXT),checked_at=excluded.checked_at
    WHERE CAST(health_checks.code AS INTEGER)+?<=? RETURNING code`)
    .bind(time.toISOString().slice(0,10),time.toISOString(),String(PAGE_WRITE_RESERVE),PAGE_WRITE_RESERVE,PAGE_WRITE_RESERVE,limit).first();
  return !!result;
}
export async function settleSyncPage(env:Env,time:Date,written:number){
  // Include claim, budget bookkeeping and a possible OAuth refresh. Missing cost
  // metadata must retain the full reservation, never assume a free write.
  const charged=Number.isFinite(written)&&written>=0?Math.ceil(written)+50:PAGE_WRITE_RESERVE;
  await env.DB.prepare("UPDATE health_checks SET code=CAST(CAST(code AS INTEGER)+? AS TEXT),checked_at=? WHERE provider='sync-budget' AND day=?")
    .bind(charged-PAGE_WRITE_RESERVE,time.toISOString(),time.toISOString().slice(0,10)).run();
}
export function writtenRows(results:D1Result[]):number{
  return results.every(r=>Number.isFinite(r.meta?.rows_written))?results.reduce((n,r)=>n+r.meta.rows_written,0):NaN;
}
