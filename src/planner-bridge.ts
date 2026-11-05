// Verify/repair existing imports with bounded SQL and original D1 quota enforcement.
import type {Env} from './types';
import {withReadBudget,D1BudgetError} from './d1-read-budget';
type E=Env&{DRIVE_ARCHIVE_SERVICE?:Fetcher};
export async function syncPlanner(env:E,background=false){const svc=env.DRIVE_ARCHIVE_SERVICE;if(!svc)return {status:'held',code:'PLANNER_SERVICE_UNAVAILABLE'};
 const post=async(path:string,body:unknown)=>{const r=await svc.fetch('https://archive.private/api/internal/planner/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('PLANNER_PRIVATE_UNAVAILABLE');return r.json<any>();};
 try{const plan=await post('plan',{});if(plan.mode==='idle'||plan.mode==='held')return {status:plan.mode,...plan.status,code:plan.code};
  if(!['verify','repair'].includes(plan.mode))return {status:'held',code:'PLANNER_PLAN_INVALID'};
  if(plan.mode==='verify'){
   const data=await withReadBudget(env,background?'cron':'/internal/context-source-read',async safe=>{
    const sources=await safe.DB.prepare('SELECT rowid AS source_rowid,id,product_id,path,sha256,row_count FROM keyword_sources WHERE rowid>? ORDER BY rowid LIMIT 20').bind(plan.sources_after).all();
    const rows=await safe.DB.prepare('SELECT o.rowid AS source_rowid,o.source_id,o.row_number,o.keyword_id,o.raw_cells_json,k.product_id,k.keyword FROM keyword_metric_observations o CROSS JOIN keyword_catalog k ON k.id=o.keyword_id WHERE o.rowid>? ORDER BY o.rowid LIMIT 200').bind(plan.rows_after).all();
    return {dataset_sha256:plan.dataset_sha256,sources:sources.results,rows:rows.results};
   });return {status:'partial',...await post('verify',data)};
  }
  const result=await withReadBudget(env,background?'cron':'planner-repair',async safe=>{
   const s=plan.source,p=plan.product,rows=plan.observations;
   if(!s||!p||!Array.isArray(rows)||rows.length>8||!/^([a-f0-9]{64})$/.test(s.id)||p.id!==s.product_id)throw Error('PLANNER_REPAIR_INVALID');
   await safe.DB.prepare('INSERT OR IGNORE INTO product_groups(id,name) VALUES(?,?)').bind(p.group_id,p.group).run();
   await safe.DB.prepare('INSERT OR IGNORE INTO products(id,group_id,name,source_folder) VALUES(?,?,?,?)').bind(p.id,p.group_id,p.name,p.folder).run();
   await safe.DB.prepare('INSERT OR IGNORE INTO keyword_sources(id,product_id,path,sha256,exported_at,period_label,header_json,imported_at,row_count) VALUES(?,?,?,?,?,?,?,?,?)').bind(s.id,s.product_id,s.path,s.sha256,s.exported_at,s.period_label,JSON.stringify(s.header),new Date().toISOString(),s.row_count).run();
   if(rows.length){
    await safe.DB.prepare('INSERT OR IGNORE INTO keyword_catalog(id,product_id,keyword,variant_family) VALUES '+rows.map(()=>'(?,?,?,?)').join(',')).bind(...rows.flatMap((r:any)=>[r.keyword_id,r.product_id,r.keyword,r.variant_family])).run();
    await safe.DB.prepare('INSERT OR IGNORE INTO keyword_metric_observations(source_id,row_number,keyword_id,currency,avg_monthly_searches,advertiser_competition,advertiser_competition_index,monthly_json,raw_cells_json) VALUES '+rows.map(()=>'(?,?,?,?,?,?,?,?,?)').join(',')).bind(...rows.flatMap((r:any)=>[r.source_id,r.row_number,r.keyword_id,r.currency,r.avg_monthly_searches,r.advertiser_competition,r.advertiser_competition_index,JSON.stringify(r.monthly),JSON.stringify(r.raw_cells)])).run();
   }
   const sources=await safe.DB.prepare('SELECT id,product_id,path,sha256,row_count FROM keyword_sources WHERE id=?').bind(s.id).all();
   const readback=rows.length?await safe.DB.prepare('SELECT o.source_id,o.row_number,o.keyword_id,o.raw_cells_json,k.product_id,k.keyword FROM keyword_metric_observations o CROSS JOIN keyword_catalog k ON k.id=o.keyword_id WHERE o.source_id=? AND o.row_number IN ('+rows.map(()=>'?').join(',')+') LIMIT 8').bind(s.id,...rows.map((r:any)=>r.row_number)).all():{results:[]};
   return {dataset_sha256:plan.dataset_sha256,sources:sources.results,rows:readback.results,repair:true};
  });return {status:'partial',...await post('verify',result)};
 }catch(error){const code=error instanceof D1BudgetError?error.code:error instanceof Error&&/^PLANNER_[A-Z_]+$/.test(error.message)?error.message:'PLANNER_SOURCE_UNAVAILABLE',reason=error instanceof D1BudgetError?error.reason:null;try{await post('held',{code,reason});}catch{}return {status:'held',code,reason};}
}
