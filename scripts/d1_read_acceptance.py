"""Small post-rollover production checks. Never starts Google sync or a crawl."""
import json,os
from datetime import datetime,timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from d1_quota_control import DATABASE
from d1_quota_checkpoint import observation,NOT_BEFORE

CHECKS={
 'state':'SELECT day,observed_at,data_through,valid_until,account_reads,account_writes,mode FROM d1_quota_state WHERE day=?',
 'ledger':'SELECT day,reads,writes,updated_at FROM d1_quota_ledger WHERE day=?',
 'costs':'SELECT fingerprint,executions,rows_read,rows_written,max_rows_read FROM d1_query_costs WHERE day=? ORDER BY rows_read DESC LIMIT 20',
 'scheduler':"SELECT day,checked_at,status,code FROM health_checks WHERE provider='scheduler' AND day=?",
 'recent_runs':"SELECT r.started_at,r.finished_at,r.status,r.rows_received FROM sync_runs r WHERE r.started_at>=? ORDER BY r.started_at DESC LIMIT 3",
}
PLANS={
 'active_data':"EXPLAIN QUERY PLAN SELECT d.clicks,d.impressions FROM dataset_coverage c INDEXED BY coverage_active CROSS JOIN gsc_daily_by_page d WHERE c.provider='gsc' AND c.scope='page' AND c.complete=1 AND c.day=? AND d.dataset_id=c.dataset_id AND d.date=c.day",
 'report_cache':"EXPLAIN QUERY PLAN SELECT result_json FROM analysis_runs WHERE month=? AND engine_version='1.2.2' AND json_extract(filters_json,'$.device') IS NULL ORDER BY created_at DESC LIMIT 1",
}

def collect(client,now=None):
 now=now or datetime.now(timezone.utc)
 if now<NOT_BEFORE:return {'passed':False,'reason':'WAIT_FOR_UTC_RESET','database_queries':0}
 usage=observation(client,now)
 if not usage.get('ok') or usage.get('mode')=='blocked':return {'passed':False,'reason':'ACCOUNT_ANALYTICS_NOT_SAFE','database_queries':0,'usage':usage}
 day=now.date().isoformat();results={};reads=0
 for name,sql in {**CHECKS,**PLANS}.items():
  result=client.request('POST',f'/accounts/{client.account}/d1/database/{DATABASE}/query',{'sql':sql,'params':[day+'T00:00:00Z' if name=='recent_runs' else day[:7] if name=='report_cache' else day]})
  if not result.get('ok'):return {'passed':False,'reason':'ACCEPTANCE_QUERY_FAILED','database_queries':len(results)+1}
  statements=result['result'];cost=sum(r.get('meta',{}).get('rows_read',0) for r in statements);reads+=cost
  if reads>20_000:return {'passed':False,'reason':'ACCEPTANCE_READ_CAP','rows_read':reads}
  results[name]=[r for s in statements for r in s.get('results',[])]
 state=results['state'];ledger=results['ledger'];progress=any(r['status']=='done' and r.get('finished_at') and r.get('rows_received',0)>0 for r in results['recent_runs'])
 safe=len(state)==1 and state[0]['mode'] in ('open','slow') and datetime.fromisoformat(state[0]['valid_until'].replace('Z','+00:00'))>now and len(ledger)==1 and 0<=ledger[0]['reads']<=2_000_000 and 0<=ledger[0]['writes']<=65_000
 active_plan=' '.join(str(r.get('detail','')) for r in results['active_data']);cache_plan=' '.join(str(r.get('detail','')) for r in results['report_cache'])
 plans='coverage_active' in active_plan and 'SEARCH d ' in active_plan and 'report_cache_lookup' in cache_plan
 return {'passed':bool(safe and plans and progress),'observed_at':now.isoformat(),'real_production_data':True,'google_sync_triggered':False,'site_crawl_triggered':False,'rows_read_by_acceptance':reads,'account_usage':usage,'checks':{'quota_state_and_ledger':bool(safe),'indexed_query_plans':plans,'nonempty_automatic_sync_observed':progress},'results':results,'note':'Kümülatif hesap sayacı diğer veritabanlarını da içerir. Gerçek uygulama okuması d1_query_costs ve ledger ile ayrıca izlenir; eksik aylık kapsam bu kabul ile tamamlanmış sayılmaz.'}

if __name__=='__main__':
 result=collect(Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID')))
 path=Path('.local/d1-read-acceptance.json');path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
 if not result['passed']:raise SystemExit('REAL_READ_ACCEPTANCE_PENDING')
