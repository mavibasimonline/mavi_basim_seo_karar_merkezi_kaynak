import {Env,hash} from './types';

// Account analytics may lag. Local reservations are ADDED to the account total,
// intentionally overcounting rather than assuming those writes/reads are visible.
export const ACCOUNT_READ_STOP=3_500_000,ACCOUNT_WRITE_STOP=85_000;
export const LOCAL_READ_STOP=2_000_000,LOCAL_WRITE_STOP=65_000;
export function guardRequired(env:Env){return env.D1_READ_GUARD_ENABLED==='true'||!!env.CF_VERSION_METADATA;}
export class D1BudgetError extends Error {constructor(public code='D1_READ_BUDGET_WAIT',public reason='OPERATION_LIMIT'){super(code);}}
// Background collection must leave room for bounded login/status and report reads.
// These are held INSIDE the existing daily/account ceilings, never extra quota.
export const INTERACTIVE_READ_HEADROOM=1_000_000,INTERACTIVE_WRITE_HEADROOM=5_000;
interface State {day:string;observed_at:string;data_through:string;valid_until:string;account_reads:number;account_writes:number;mode:'open'|'slow'|'blocked';reason:string}
const databaseRoots=new WeakMap<D1Database,D1Database>();
export function originalDatabase(db:D1Database){return databaseRoots.get(db)||db;}
const statementProofs=new WeakMap<object,{sql:string;params:unknown[]}>();
const readEstimates=new WeakMap<object,number>();
interface Cost {reads:number;writes:number;count:number;max:number}
// These exact routes have bounded SQL shapes. The margin covers two-index-row
// cost upserts, at most one ledger growth per statement, reserve and settlement.
// General writes/analyses keep their original reservations and accounting.
const SESSION_SQL=new Set([
 'SELECT attempts, window_start FROM auth_attempts WHERE client_hash=?',
 'DELETE FROM auth_attempts WHERE client_hash=?',
 'INSERT INTO auth_attempts VALUES(?,?,?) ON CONFLICT(client_hash) DO UPDATE SET attempts=excluded.attempts, window_start=excluded.window_start',
]);
const CACHE_WRITE='INSERT INTO api_read_cache VALUES(?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET revision=excluded.revision,created_at=excluded.created_at,result_json=excluded.result_json';
function interactiveProfile(kind:string){
 if(kind==='/api/session')return {reserve:64,bookkeeping:16,statements:2,allows:(sql:string)=>SESSION_SQL.has(sql.replace(/\s+/g,' ').trim())};
 const select=(sql:string)=>/^\s*SELECT\b/i.test(sql)&&!sql.includes(';');
 // Two read-only statements: reserve/settle ledger + at most two growths + two cost inserts (at most 8 physical writes).
 if(kind==='/internal/report-source-read'||kind==='/internal/report-source-background')return {reserve:64,bookkeeping:8,statements:2,allows:select};
 if(kind==='/api/status')return {reserve:128,bookkeeping:64,statements:12,allows:select};
 if(kind==='/api/performance'||kind==='/api/performance/queries')return {reserve:128,bookkeeping:80,statements:16,allows:(sql:string)=>select(sql)||sql===CACHE_WRITE};
 return null;
}
export function queryAllowance(sql:string){
  if(/^\s*(WITH incoming|INSERT (?:OR (?:REPLACE|IGNORE) )?INTO (?:gsc_daily_|ga4_daily_))/i.test(sql))return 5_000;
  if(/gsc_daily_|ga4_daily_/i.test(sql))return 250_000;
  if(/keyword_metric_observations/i.test(sql))return 50_000;
  return 10_000;
}
export function stateIssue(state:State|null,time:Date):string|null{
  if(!state)return 'CHECKPOINT_MISSING';
  const now=time.getTime(),observed=Date.parse(state.observed_at),until=Date.parse(state.valid_until),through=Date.parse(state.data_through);
  if(![observed,until,through].every(Number.isFinite))return 'CHECKPOINT_INVALID';
  if(state.day!==time.toISOString().slice(0,10))return 'CHECKPOINT_WRONG_DAY';
  if(observed>now)return 'CHECKPOINT_FUTURE';
  if(now-observed>75*60_000)return 'CHECKPOINT_STALE';
  if(until<=now)return 'LEASE_EXPIRED';
  if(through>now)return 'ANALYTICS_FUTURE';
  if(now-through>2*3600_000)return 'ANALYTICS_STALE';
  if(!Number.isSafeInteger(state.account_reads)||state.account_reads<0||!Number.isSafeInteger(state.account_writes)||state.account_writes<0||!['open','slow','blocked'].includes(state.mode))return 'CHECKPOINT_INVALID';
  if(state.mode==='blocked')return 'CHECKPOINT_BLOCKED';
  if(state.account_reads>=ACCOUNT_READ_STOP)return 'ACCOUNT_READ_LIMIT';
  if(state.account_writes>=ACCOUNT_WRITE_STOP)return 'ACCOUNT_WRITE_LIMIT';
  return null;
}
function leaseExpiry(state:State){return Math.min(Date.parse(state.valid_until),Date.parse(state.observed_at)+75*60_000,Date.parse(state.data_through)+2*3600_000,Date.parse(state.day)+86400_000);}
export async function readBudgetStatus(env:Env,time=new Date()){
  if(!guardRequired(env))return {enabled:false,mode:'local',reason:'Yerel ortam; üretim hesabı kotası doğrulanmadı.'};
  const state=await env.DB.prepare('SELECT * FROM d1_quota_state WHERE day=?').bind(time.toISOString().slice(0,10)).first<State>();
  const issue=stateIssue(state,time),fresh=!issue&&state!==null;
  return {enabled:true,reason_code:issue,valid_until:state?.valid_until||null,effective_valid_until:state&&Number.isFinite(leaseExpiry(state))?new Date(leaseExpiry(state)).toISOString():null,mode:fresh?state.mode:'blocked',reason:fresh?state.reason:'Güncel hesap kotası doğrulaması bekleniyor.',observed_at:state?.observed_at||null,data_through:state?.data_through||null,account_reads:state?.account_reads??null,account_writes:state?.account_writes??null};
}

export async function withReadBudget<T>(env:Env,kind:string,work:(safe:Env)=>Promise<T>,time=new Date()):Promise<T>{
  if(!guardRequired(env))return work(env);
  const startedAt=Date.now(),stamp=time.toISOString(),day=stamp.slice(0,10);
  const state=await env.DB.prepare('SELECT * FROM d1_quota_state WHERE day=?').bind(day).first<State>();
  const issue=stateIssue(state,time);
  if(issue||!state)throw new D1BudgetError('D1_READ_BUDGET_WAIT',issue||'CHECKPOINT_MISSING');
  const expensive=/report|radar|data-integrity|questions|export|change-impact/.test(kind);
  if(state.mode==='slow'&&expensive)throw new D1BudgetError('D1_READ_BUDGET_WAIT','SLOW_MODE_HEAVY_OPERATION');
  const maximumReads=kind==='cron'?600_000:expensive?1_000_000:/performance/.test(kind)?600_000:200_000;
  let readReserve=20_000;
  const profile=interactiveProfile(kind);
  const writeReserve=profile?.reserve??(kind==='cron'?5_000:expensive?4_000:1_000);
  const background=kind==='cron'||kind==='/internal/report-source-background';
  const readLimit=Math.min(LOCAL_READ_STOP,ACCOUNT_READ_STOP-state.account_reads)-(background?INTERACTIVE_READ_HEADROOM:0),writeLimit=Math.min(LOCAL_WRITE_STOP,ACCOUNT_WRITE_STOP-state.account_writes)-(background?INTERACTIVE_WRITE_HEADROOM:0);
  async function reservationDenied(extraReads:number,extraWrites:number):Promise<never>{
    // One primary-key lookup only; no application rows, raw SQL or secrets in diagnostics.
    const ledger=await env.DB.prepare('SELECT reads,writes FROM d1_quota_ledger WHERE day=?').bind(day).first<{reads:number;writes:number}>();
    const nextReads=(ledger?.reads||0)+extraReads,nextWrites=(ledger?.writes||0)+extraWrites;
    const fullReadLimit=Math.min(LOCAL_READ_STOP,ACCOUNT_READ_STOP-state!.account_reads),fullWriteLimit=Math.min(LOCAL_WRITE_STOP,ACCOUNT_WRITE_STOP-state!.account_writes);
    const reason=nextReads>fullReadLimit?(fullReadLimit===LOCAL_READ_STOP?'LOCAL_READ_LIMIT':'ACCOUNT_READ_RESERVATION_LIMIT')
      :nextWrites>fullWriteLimit?(fullWriteLimit===LOCAL_WRITE_STOP?'LOCAL_WRITE_LIMIT':'ACCOUNT_WRITE_RESERVATION_LIMIT')
      :nextReads>readLimit?'BACKGROUND_READ_HEADROOM':nextWrites>writeLimit?'BACKGROUND_WRITE_HEADROOM':'RESERVATION_CONTENDED';
    throw new D1BudgetError('D1_READ_BUDGET_WAIT',reason);
  }
  const reserved=await env.DB.prepare(`INSERT INTO d1_quota_ledger(day,reads,writes,updated_at) SELECT ?,?,?,? WHERE ?<=? AND ?<=?
    ON CONFLICT(day) DO UPDATE SET reads=reads+excluded.reads,writes=writes+excluded.writes,updated_at=excluded.updated_at
    WHERE reads+excluded.reads<=? AND writes+excluded.writes<=? RETURNING day`)
    .bind(day,readReserve,writeReserve,stamp,readReserve,readLimit,writeReserve,writeLimit,readLimit,writeLimit).first();
  if(!reserved)await reservationDenied(readReserve,writeReserve);
  let reads=500,writes=profile?.bookkeeping??200,inFlight=0,unknown=false;
  let profileStatements=0;
  const costs=new Map<string,Cost>();
  const leaseUntil=leaseExpiry(state);
  let growing=Promise.resolve();
  const pending=new Set<Promise<unknown>>();
  async function enter(allowance:number){
    const previous=growing;let release!:()=>void;growing=new Promise<void>(resolve=>{release=resolve;});await previous;
    try{
      const operationTime=time.getTime()+Math.max(0,Date.now()-startedAt);
      if(operationTime>=leaseUntil||new Date(operationTime).toISOString().slice(0,10)!==day)throw new D1BudgetError('D1_READ_BUDGET_WAIT','LEASE_ENDED_DURING_OPERATION');
      const required=reads+inFlight+allowance;
      if(required>maximumReads||writes>=writeReserve)throw new D1BudgetError('D1_OPERATION_BUDGET_WAIT');
      if(required>readReserve){
        const additional=required-readReserve;
        const added=await original.prepare('UPDATE d1_quota_ledger SET reads=reads+? WHERE day=? AND reads+?<=? RETURNING day').bind(additional,day,additional,readLimit).first();
        if(!added)await reservationDenied(additional,0);readReserve+=additional;
      }
      inFlight+=allowance;
    }finally{release();}
  }
  async function perform<R>(sqls:string[],operation:()=>Promise<R>,estimate?:number):Promise<R>{
    if(profile){
      if(profileStatements+sqls.length>profile.statements||sqls.some(sql=>!profile.allows(sql)))throw new D1BudgetError('D1_OPERATION_BUDGET_WAIT','INTERACTIVE_SQL_SCOPE');
      profileStatements+=sqls.length;
    }
    const allowance=estimate??sqls.reduce((n,s)=>n+queryAllowance(s),0);
    await enter(allowance);
    try{
      const result=await operation();
      const results=(Array.isArray(result)?result:[result]) as D1Result[];
      for(let i=0;i<results.length;i++){
        const r=results[i],rr=r.meta?.rows_read,rw=r.meta?.rows_written;
        if(!Number.isSafeInteger(rr)||!Number.isSafeInteger(rw)||rr<0||rw<0){unknown=true;continue;}
        reads+=rr;writes+=rw;
        const key=await hash(sqls[i]||sqls[0]);const cost=costs.get(key)||{reads:0,writes:0,count:0,max:0};
        cost.reads+=rr;cost.writes+=rw;cost.count++;cost.max=Math.max(cost.max,rr);costs.set(key,cost);
      }
      if(reads>readReserve||writes>writeReserve)throw new D1BudgetError('D1_COST_ESTIMATE_EXCEEDED');
      return result;
    }catch(error){unknown=true;throw error;}finally{inFlight-=allowance;}
  }
  function execute<R>(sqls:string[],operation:()=>Promise<R>,estimate?:number):Promise<R>{
    const task=perform(sqls,operation,estimate);pending.add(task);task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
  }
  const original=env.DB;
  const raw=new WeakMap<object,{statement:D1PreparedStatement;sql:string}>();
  function prepared(sql:string,statement:D1PreparedStatement,params:unknown[]=[]):D1PreparedStatement{
    const proxy={
      bind(...values:unknown[]){return prepared(sql,statement.bind(...values),values);},
      all<T>(){return execute([sql],()=>statement.all<T>(),readEstimates.get(proxy));},
      run<T>(){return execute([sql],()=>statement.run<T>(),readEstimates.get(proxy));},
      async first<T>(column?:string){const result=await execute([sql],()=>statement.all<T>(),readEstimates.get(proxy));const row=result.results[0]??null;if(column&&row!==null){if(!Object.hasOwn(row as object,column))throw Error('D1_COLUMN_NOT_FOUND');return (row as Record<string,unknown>)[column] as T;}return row;},
      async raw<T>(options?:{columnNames?:boolean}){throw new D1BudgetError('D1_UNMETERED_METHOD');},
    } as D1PreparedStatement;
    statementProofs.set(proxy,{sql,params});raw.set(proxy,{statement,sql});return proxy;
  }
  const db={prepare(sql:string){return prepared(sql,original.prepare(sql));},async batch<T>(statements:D1PreparedStatement[]){
    if(!statements.length)return [];
    const unwrapped=statements.map(s=>raw.get(s));if(unwrapped.some(s=>!s))throw new D1BudgetError('D1_UNMETERED_METHOD');
    return execute(unwrapped.map(s=>s!.sql),()=>original.batch<T>(unwrapped.map(s=>s!.statement)));
  },exec(){throw new D1BudgetError('D1_UNMETERED_METHOD');}} as unknown as D1Database;
  databaseRoots.set(db,originalDatabase(original));
  try{return await work({...env,DB:db,SYNC_MAX_PAGES_PER_TICK:state.mode==='slow'?'1':env.SYNC_MAX_PAGES_PER_TICK});}
  finally{
    // Promise.all can reject while another metered query is still running. Wait
    // for every query before settling the reservation.
    await Promise.allSettled([...pending]);
    // Unknown metadata, SQL errors, process interruption: keep the full reservation.
    // Do not refund a reservation using an estimate or a missing meta field.
    if(!unknown){
      const stats=[...costs].slice(0,40).map(([fingerprint,c])=>original.prepare(`INSERT INTO d1_query_costs VALUES(?,?,?,?,?,?) ON CONFLICT(day,fingerprint) DO UPDATE SET executions=executions+excluded.executions,rows_read=rows_read+excluded.rows_read,rows_written=rows_written+excluded.rows_written,max_rows_read=max(max_rows_read,excluded.max_rows_read)`).bind(day,fingerprint,c.count,c.reads,c.writes,c.max));
      await original.batch([...stats,original.prepare('UPDATE d1_quota_ledger SET reads=max(0,reads+?),writes=max(0,writes+?),updated_at=? WHERE day=?').bind(reads-readReserve,writes-writeReserve,stamp,day)]);
    }
    if(reads>readReserve||writes>writeReserve){await original.prepare('UPDATE d1_quota_ledger SET reads=reads+?,writes=writes+? WHERE day=?').bind(Math.max(0,reads-readReserve),Math.max(0,writes-writeReserve),day).run();await original.prepare("UPDATE d1_quota_state SET mode='blocked',reason='Ölçülen sorgu maliyeti rezervasyonu aştı; inceleme gerekli.' WHERE day=?").bind(day).run();}
  }
}

export async function boundedDataScope(env:Env,start:string,end:string,scope:'page'|'query'|'organic',provider='gsc'){
  if(!guardRequired(env))return 0;
  const row=await env.DB.prepare('SELECT COALESCE(sum(row_count),0) rows FROM dataset_coverage WHERE provider=? AND scope=? AND complete=1 AND day BETWEEN ? AND ?').bind(provider,scope,start,end).first<{rows:number}>();
  // Aggregates and GROUP BY can scan far more than their output LIMIT. Bound
  // input evidence before running them. Narrower periods stay available.
  if(!row||!Number.isSafeInteger(row.rows)||row.rows<0||row.rows>20_000)throw new D1BudgetError('D1_SCOPE_BUDGET_WAIT');
  return row.rows;
}


// Narrow read estimate for indexed performance queries, never a raised limit.
// Coverage is validated before estimating. Actual metadata accounting, unknown
// cost retention and overrun blocking remain mandatory in perform().
export async function boundedCoverageRead(env:Env,statement:D1PreparedStatement,scope:'page'|'query',start:string,end:string){
 if(!guardRequired(env))return statement;
 const proof=statementProofs.get(statement),table=scope==='page'?'gsc_daily_by_page':'gsc_daily_by_query_device';
 if(!proof)throw new D1BudgetError('D1_UNMETERED_METHOD');
 const {sql,params}=proof,range=/c\.day BETWEEN \? AND \?/i.exec(sql);
 const offset=range?(sql.slice(0,range.index).match(/\?/g)||[]).length:-1;
 const scopeParam=/c\.scope=\?/.exec(sql),scopeOffset=scopeParam?(sql.slice(0,scopeParam.index).match(/\?/g)||[]).length:-1;
 const tables=[...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/gi)].map(m=>m[1]);
 const knownTables=new Set(['dataset_coverage',table,'products','pages','page_aliases','json_each']);
 if(tables.some(name=>!knownTables.has(name))||/\bUNION\b/i.test(sql))throw new D1BudgetError('D1_SCOPE_BUDGET_WAIT');
 if(!/^\s*SELECT\b/i.test(sql)||sql.includes(';')||!sql.includes('dataset_coverage c INDEXED BY coverage_active')||!sql.includes(table+' d')||!sql.includes('c.complete=1')||!(/d.dataset_id=c.dataset_id|c.dataset_id=d.dataset_id/.test(sql))||!(/d.date=c.day|c.day=d.date/.test(sql))||!range||params[offset]!==start||params[offset+1]!==end||!(sql.includes("c.scope='"+scope+"'")||scopeOffset>=0&&params[scopeOffset]===scope))throw new D1BudgetError('D1_SCOPE_BUDGET_WAIT');
 const rows=await boundedDataScope(env,start,end,scope);
 // Fact row + bounded unique product/page/alias index lookups; retain a large
 // metadata/index margin. Unknown or changed source counts still fail closed.
 readEstimates.set(statement,Math.min(queryAllowance(sql),10_000+rows*12));
 return statement;
}
