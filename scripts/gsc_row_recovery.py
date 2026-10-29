"""Bounded August incident inspection/requeue. No OAuth access, sync or migration."""
import json,os,re,sys
from datetime import datetime,timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare,QUERIES
from d1_quota_checkpoint import observation
from d1_quota_control import DATABASE
from release_readiness import get_json,APP

JOB_IDS=['gsc:2026-08-18:page','gsc:2026-08-18:query']
READS={
 'google_authorizations':"SELECT provider,scopes,updated_at FROM oauth_credentials",
 'sheets_archived':"SELECT count(*) records FROM insight_runs WHERE kind='sheets-source-evidence'",
 'original_missing_jobs':"WITH RECURSIVE days(day) AS (SELECT '2026-07-01' UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<'2026-07-26'),scopes(scope) AS (VALUES('page'),('query')) SELECT count(*) expected,sum(CASE WHEN c.complete=1 THEN 1 ELSE 0 END) completed FROM days d CROSS JOIN scopes s LEFT JOIN dataset_coverage c ON c.provider='gsc' AND c.day=d.day AND c.scope=s.scope",
 'jobs':"SELECT id,day,scope,status,cursor,attempts,error_code,updated_at FROM sync_jobs WHERE id IN (?,?)",
 'quota':"SELECT day,valid_until,account_reads,account_writes,mode FROM d1_quota_state WHERE day=?",
 'ledger':"SELECT day,reads,writes,updated_at FROM d1_quota_ledger WHERE day=?",
 'coverage':QUERIES['priority_months'],
 'recent':"SELECT j.day,j.scope,r.started_at,r.finished_at,r.status,r.rows_received,r.trigger_source FROM sync_runs r JOIN sync_jobs j ON j.id=r.job_id ORDER BY r.started_at DESC LIMIT 5",
}
# Only the two diagnosed legacy URL categories. The owned-URL validator no longer
# emits either code, so a new failure cannot be reset by this incident operation.
# Generation, cursor, attempts, data and error history stay unchanged. This SQL is
# prepared for a separately approved release/recovery; importing it runs nothing.
REQUEUE="""UPDATE sync_jobs SET status='pending',next_attempt_at=?,updated_at=?,error_code='GSC_OWNED_URL_RECOVERY_RETRY'
 WHERE id IN (?,?) AND provider='gsc' AND day='2026-08-18' AND scope IN ('page','query')
 AND id='gsc:'||day||':'||scope
 AND status='blocked' AND error_code IN ('INVALID_GSC_ROW_PAGE_WWW','INVALID_GSC_ROW_PAGE_HTTP_APEX') AND lease_token IS NULL
 AND EXISTS(SELECT 1 FROM d1_quota_state WHERE day=? AND mode='open' AND valid_until>? AND account_reads<3500000 AND account_writes<85000)
 RETURNING id,status,cursor,attempts"""

def run(client,operation,sha,now=None,probe=None):
 now=now or datetime.now(timezone.utc);stamp=now.isoformat();day=now.date().isoformat()
 if operation not in ('inspect','requeue'):raise ValueError('INVALID_RECOVERY_OPERATION')
 usage=observation(client,now)
 if not usage.get('ok') or usage.get('mode')!='open':raise ValueError('FRESH_SAFE_ACCOUNT_ANALYTICS_REQUIRED')
 out={'observed_at':stamp,'operation':operation,'account_usage':usage,'google_sync_triggered':False,'site_crawl_triggered':False,'production_worker_modified':False,'queries':{},'rows_read':0,'rows_written':0}
 def query(sql,params):
  r=client.request('POST',f'/accounts/{client.account}/d1/database/{DATABASE}/query',{'sql':sql,'params':params})
  if not r.get('ok'):raise ValueError('RECOVERY_QUERY_FAILED')
  for s in r['result']:
   m=s.get('meta',{})
   if any(type(m.get(k)) is not int or m[k]<0 for k in ('rows_read','rows_written')):raise ValueError('REAL_QUERY_COST_REQUIRED')
   out['rows_read']+=m['rows_read'];out['rows_written']+=m['rows_written']
  if out['rows_read']>5000 or out['rows_written']>30:raise ValueError('RECOVERY_COST_CAP')
  return [v for s in r['result'] for v in s.get('results',[])]
 for name,sql in READS.items():out['queries'][name]=query(sql,JOB_IDS if name=='jobs' else [day] if name in ('quota','ledger') else [])
 if operation=='requeue':
  if not re.fullmatch(r'[a-f0-9]{40}',sha or ''):raise ValueError('EXACT_RELEASE_COMMIT_REQUIRED')
  live=(probe or (lambda:get_json(APP+'/api/health?gsc-recovery=owned-url-variants-v2')))().get('deployment',{})
  if live.get('commit')!=sha or live.get('read_guard_revision')!='d1-account-reads-v1' or live.get('gsc_validation_revision')!='owned-url-variants-v2':raise ValueError('OWNED_URL_CODE_NOT_LIVE')
  state=out['queries']['quota'];ledger=out['queries']['ledger']
  if len(state)!=1 or state[0]['mode']!='open' or datetime.fromisoformat(state[0]['valid_until'].replace('Z','+00:00'))<=now:raise ValueError('CURRENT_QUOTA_LEASE_REQUIRED')
  if len(ledger)!=1 or ledger[0]['reads']>1900000 or ledger[0]['writes']>64000:raise ValueError('LOCAL_QUOTA_HEADROOM_REQUIRED')
  out['requeued']=query(REQUEUE,[stamp,stamp,*JOB_IDS,day,stamp])
  if len(out['requeued'])>2:raise ValueError('RECOVERY_JOB_CAP')
 return out

if __name__=='__main__':
 try:
  if sys.argv[1]!='inspect':raise ValueError('READ_ONLY_DRIVE_CHECK_REQUIRED')
  result=run(Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID')),sys.argv[1],os.environ.get('GITHUB_SHA'))
  result['drive_connection_configured']={key:bool(os.environ.get(key)) for key in ('GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN','GOOGLE_SERVICE_ACCOUNT_JSON')}
  path=Path('.local/gsc-row-recovery.json');path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
 except Exception as e:
  code=str(e) if isinstance(e,ValueError) and re.fullmatch('[A-Z_]+',str(e)) else type(e).__name__
  raise SystemExit('GSC_RECOVERY_FAILED:'+code)
