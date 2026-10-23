import { Env, nowISO } from './types';

export async function recordAppliedChange(env:Env,input:{recommendation_id:string;applied_at:string;evidence:string;old:unknown;new:unknown}):Promise<string>{
  const recommendation=await env.DB.prepare('SELECT id,decision FROM recommendations WHERE id=?').bind(input.recommendation_id).first<{id:string;decision:string}>();
  if(!recommendation||!Number.isFinite(Date.parse(input.applied_at))||Date.parse(input.applied_at)>Date.now()||typeof input.evidence!=='string'||input.evidence.trim().length<10)throw new Error('INVALID_APPLIED_CHANGE');
  const id=crypto.randomUUID();
  const statements=[env.DB.prepare('INSERT INTO applied_changes VALUES(?,?,?,?,?,?,?)').bind(id,recommendation.id,new Date(input.applied_at).toISOString(),nowISO(),JSON.stringify({source:'operator_attestation',text:input.evidence,publication_time_independently_verified:false}),JSON.stringify(input.old),JSON.stringify(input.new))];
  for(const days of [7,28,60,90])statements.push(env.DB.prepare("INSERT INTO outcome_windows VALUES(?,?,NULL,'waiting',?)").bind(id,days,JSON.stringify({limitation:'Operatörün bildirdiği uygulama tarihi; CMS/deploy kaydı bağımsız doğrulanmadı. Korelasyon nedensellik değildir.'})));
  await env.DB.batch(statements);
  return id;
}
export async function measureOneOutcome(env:Env,time=new Date()):Promise<void>{
  const next=await env.DB.prepare(`SELECT w.*,a.applied_at,a.recommendation_id,r.product_id,p.canonical_url
    FROM outcome_windows w JOIN applied_changes a ON a.id=w.applied_change_id JOIN recommendations r ON r.id=a.recommendation_id JOIN products p ON p.id=r.product_id
    WHERE w.status='waiting' AND julianday(?)>=julianday(a.applied_at)+w.days+3 ORDER BY a.applied_at,w.days LIMIT 1`)
    .bind(time.toISOString()).first<{applied_change_id:string;days:number;applied_at:string;canonical_url:string|null;product_id:string}>();
  if(!next||!next.canonical_url)return;
  // Exclude the application day: its exposure contains both versions.
  const base=new Date(next.applied_at.slice(0,10)+'T00:00:00Z').getTime();
  const date=(offset:number)=>new Date(base+offset*86400_000).toISOString().slice(0,10);
  const ranges={before:{start:date(-next.days),end:date(-1)},after:{start:date(1),end:date(next.days)}};
  const coverage=await env.DB.prepare("SELECT day FROM dataset_coverage WHERE provider='gsc' AND scope='page' AND complete=1 AND day BETWEEN ? AND ?").bind(ranges.before.start,ranges.after.end).all<{day:string}>();
  for(const period of [ranges.before,ranges.after]){
    for(let day=Date.parse(period.start);day<=Date.parse(period.end);day+=86400_000)if(!coverage.results.some(c=>c.day===new Date(day).toISOString().slice(0,10)))return;
  }
  const result:Record<string,unknown>={ranges,application_day_excluded:true,limitation:'Önce/sonra farkı nedensellik kanıtı değildir. Diğer sayfalar yalnızca gözlemsel kontrol grubudur; mevsimsellik kesin olarak elenemez.'};
  for(const [label,range] of Object.entries(ranges)){
    result[label]=(await env.DB.prepare(`SELECT CASE WHEN d.page=? THEN 'target' ELSE 'other_pages' END AS cohort,
      SUM(d.clicks) AS clicks,SUM(d.impressions) AS impressions,SUM(d.clicks)*1.0/NULLIF(SUM(d.impressions),0) AS ctr
      FROM gsc_daily_by_page d JOIN dataset_coverage c ON c.dataset_id=d.dataset_id AND c.day=d.date AND c.provider='gsc' AND c.scope='page' AND c.complete=1
      WHERE d.date BETWEEN ? AND ? GROUP BY cohort`).bind(next.canonical_url,range.start,range.end).all()).results;
  }
  // Missing target rows cannot be interpreted as zero traffic.
  if(!(result.before as {cohort:string}[]).some(r=>r.cohort==='target')||!(result.after as {cohort:string}[]).some(r=>r.cohort==='target'))return;
  await env.DB.prepare("UPDATE outcome_windows SET measured_at=?,status='measured',result_json=? WHERE applied_change_id=? AND days=?")
    .bind(time.toISOString(),JSON.stringify(result),next.applied_change_id,next.days).run();
}
