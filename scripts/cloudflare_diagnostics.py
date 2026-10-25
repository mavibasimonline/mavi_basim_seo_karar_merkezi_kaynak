"""Read-only, sanitized production diagnostics using existing server-side CI bindings."""
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

QUERIES = {
 'migrations': 'SELECT name FROM d1_migrations ORDER BY id',
 'jobs': "SELECT provider,status,scope,count(*) jobs,min(day) earliest_day,max(day) latest_day,min(updated_at) oldest_update,max(updated_at) latest_update,sum(cursor) staged_offsets FROM sync_jobs GROUP BY provider,status,scope",
 'recent_jobs': "SELECT id,day,scope,status,cursor,attempts,next_attempt_at,lease_until,updated_at,error_code FROM sync_jobs WHERE provider='gsc' ORDER BY updated_at DESC LIMIT 15",
 'recent_runs': 'SELECT j.provider,j.day,j.scope,r.status,r.started_at,r.finished_at,r.rows_received FROM sync_runs r JOIN sync_jobs j ON j.id=r.job_id ORDER BY r.started_at DESC LIMIT 20',
 'errors': 'SELECT e.code,e.retry_at,e.created_at,j.provider,j.day,j.scope FROM sync_errors e JOIN sync_runs r ON r.id=e.run_id JOIN sync_jobs j ON j.id=r.job_id ORDER BY e.created_at DESC LIMIT 20',
 'health': 'SELECT provider,day,checked_at,status,code FROM health_checks ORDER BY checked_at DESC LIMIT 20',
 'coverage': 'SELECT provider,scope,substr(day,1,7) month,complete,count(*) days,sum(row_count) rows,min(day) earliest_day,max(day) latest_day,max(fetched_at) last_verified FROM dataset_coverage GROUP BY provider,scope,month,complete ORDER BY month DESC,provider,scope',
 'priority_months': "WITH RECURSIVE days(day) AS (SELECT '2026-07-01' UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<'2026-09-30'),scopes(scope) AS (VALUES('page'),('query')) SELECT substr(d.day,1,7) month,s.scope,count(*) expected_days,sum(CASE WHEN c.complete=1 THEN 1 ELSE 0 END) complete_days FROM days d CROSS JOIN scopes s LEFT JOIN dataset_coverage c ON c.provider='gsc' AND c.day=d.day AND c.scope=s.scope GROUP BY month,s.scope ORDER BY month,s.scope",
 'backfill': 'SELECT provider,oldest_enqueued_day,updated_at FROM backfill_progress',
 'source_counts': 'SELECT (SELECT count(*) FROM products) products,(SELECT count(*) FROM keyword_sources) csv_files,(SELECT count(*) FROM keyword_metric_observations) csv_rows',
 'product_url_verification': 'SELECT count(*) products,sum(CASE WHEN canonical_url IS NOT NULL THEN 1 ELSE 0 END) mapped,sum(CASE WHEN url_verified_at IS NOT NULL THEN 1 ELSE 0 END) verified FROM products',
 'crawl_queue': "SELECT kind,count(*) queued,sum(CASE WHEN next_crawl_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END) due,min(next_crawl_at) next_due FROM crawl_queue GROUP BY kind",
 'crawl_runs': "SELECT url,started_at,finished_at,status_code,error_code FROM crawls ORDER BY started_at DESC LIMIT 35",
 'product_snapshots': "SELECT p.id,p.canonical_url,p.url_verified_at,s.observed_at,json_extract(s.snapshot_json,'$.status') http_status,json_extract(s.snapshot_json,'$.canonical[0]') canonical,json_extract(s.snapshot_json,'$.rendering') rendering FROM products p LEFT JOIN seo_snapshots s ON s.id=(SELECT id FROM seo_snapshots WHERE url=p.canonical_url ORDER BY observed_at DESC,rowid DESC LIMIT 1) ORDER BY p.id",
 'sync_budget_history': "SELECT day,checked_at,status,code FROM health_checks WHERE provider='sync-budget' ORDER BY day DESC LIMIT 3",
 'report_history': "SELECT month,engine_version,created_at FROM analysis_runs ORDER BY created_at DESC LIMIT 3",
 'authorization_record': "SELECT provider,scopes,updated_at FROM oauth_credentials WHERE provider='google'",
}

class Cloudflare:
 def __init__(self, token, account, opener=None):
  if not token or not re.fullmatch(r'[a-f0-9]{32}', account or ''):
   raise ValueError('CLOUDFLARE_BINDINGS_MISSING')
  self.token, self.account = token, account
  self.opener = opener or urllib.request.build_opener()

 def request(self, method, path, body=None):
  if not path.startswith('/accounts/' + self.account + '/'):
   raise ValueError('UNEXPECTED_CLOUDFLARE_DESTINATION')
  req = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
    data=None if body is None else json.dumps(body).encode(),method=method,
    headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
  try:
   with self.opener.open(req, timeout=45) as response:
    raw = response.read(2_000_001)
    if len(raw)>2_000_000: return {'ok': False, 'code': 'CF_RESPONSE_LIMIT'}
    result = json.loads(raw)
  except urllib.error.HTTPError as error:
   return {'ok': False, 'code': 'CF_HTTP_' + str(error.code)}
  except (OSError, ValueError):
   return {'ok': False, 'code': 'CF_TRANSPORT_OR_JSON_ERROR'}
  if not result.get('success'):
   return {'ok':False,'code':'CF_API_ERROR','error_codes':[e.get('code') for e in result.get('errors',[]) if isinstance(e.get('code'),int)]}
  return {'ok':True,'result':result.get('result')}

 def query(self, database, sql):
  if sql not in QUERIES.values():
   raise ValueError('READ_ONLY_QUERY_REQUIRED')
  if not re.fullmatch(r'[a-f0-9-]{36}', database):raise ValueError('INVALID_DATABASE_ID')
  result=self.request('POST',f'/accounts/{self.account}/d1/database/{database}/query',{'sql':sql,'params':[]})
  if not result['ok']:return result
  return {'ok':True,'rows':[row for statement in result['result'] for row in statement.get('results',[])],
          'rows_read':sum(s.get('meta',{}).get('rows_read',0) for s in result['result'])}

 def daily_usage(self):
  # Account-wide UTC quota, including today's source import and other databases.
  now=datetime.now(timezone.utc);start=now.replace(hour=0,minute=0,second=0,microsecond=0).isoformat()
  query='query DailyD1($accountTag: string, $filter: ZoneWorkersRequestsFilter_InputObject) { viewer { accounts(filter: {accountTag: $accountTag}) { d1AnalyticsAdaptiveGroups(limit: 10000, filter: $filter) { sum { rowsRead rowsWritten } dimensions { datetimeHour } } } } }'
  body={'query':query,'variables':{'accountTag':self.account,'filter':{'AND':[{'datetimeHour_geq':start,'datetimeHour_leq':now.isoformat()}]}}}
  req=urllib.request.Request('https://api.cloudflare.com/client/v4/graphql',data=json.dumps(body).encode(),method='POST',headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'})
  try:
   with self.opener.open(req,timeout=45) as response:raw=response.read(2_000_001)
   if len(raw)>2_000_000:return {'ok':False,'code':'CF_RESPONSE_LIMIT'}
   data=json.loads(raw)
   if data.get('errors'):return {'ok':False,'code':'CF_ANALYTICS_UNAVAILABLE'}
   rows=[r for a in data['data']['viewer']['accounts'] for r in a['d1AnalyticsAdaptiveGroups']]
   return {'ok':True,'utc_start':start,'observed_at':now.isoformat(),'account_wide':True,'rows_read':sum(r['sum']['rowsRead'] for r in rows),'rows_written':sum(r['sum']['rowsWritten'] for r in rows),'hours':len(rows),'note':'Adaptive analytics may be delayed; daily Free limits are 5,000,000 reads / 100,000 writes.'}
  except urllib.error.HTTPError as error:return {'ok':False,'code':'CF_ANALYTICS_HTTP_'+str(error.code)}
  except (OSError,ValueError,KeyError,TypeError):return {'ok':False,'code':'CF_ANALYTICS_UNAVAILABLE'}


def acceptance(result, now=None):
 now=now or datetime.now(timezone.utc)
 cutoff=datetime(2026,10,25,tzinfo=timezone.utc)
 def rows(name):
  value=result.get('queries',{}).get(name,{})
  return value.get('rows',[]) if value.get('ok') else []
 after=now>=cutoff
 budget=any(r.get('day','')>='2026-10-25' and r.get('checked_at','')>='2026-10-25T00:00:00' for r in rows('sync_budget_history'))
 progress=any(r.get('status')=='done' and (r.get('finished_at') or '')>='2026-10-25T00:00:00' and (r.get('rows_received') or 0)>0 for r in rows('recent_runs'))
 months=rows('priority_months')
 covered=sum(r.get('complete_days',0) for r in months)
 snapshots=rows('product_snapshots')
 verified=sum(bool(r.get('url_verified_at')) and r.get('http_status')==200 and r.get('canonical')==r.get('canonical_url') and r.get('rendering')=='static-html' for r in snapshots)
 return {'observed_at':now.isoformat(),'cutoff_turkey':'2026-10-25T03:00:00+03:00',
  'rollover': 'verified' if after and budget and progress else 'not_yet_due' if not after else 'waiting_for_real_progress',
  'new_day_budget_observed':budget,'completed_nonempty_run_after_cutoff':progress,
  'priority_coverage':{'completed':covered,'expected':184,'passed':len(months)==6 and covered==184},
  'product_crawl':{'verified':verified,'expected':29,'passed':len(snapshots)==29 and verified==29},
  'monthly_report':'blocked_missing_coverage' if covered!=184 else 'requires_authenticated_report_and_independent_metric_acceptance',
  'note':'Real read-only production observations; no Google sync, crawl or report generation triggered. Scheduled diagnosis is evidence collection, not a guarantee of completion.'}

def collect(client, config):
 if config.get('name')!='mavi-basim-seo-prod' or config.get('route') or config.get('routes'):
  raise ValueError('UNEXPECTED_WORKER_OR_SITE_ROUTE')
 databases=config.get('d1_databases',[])
 if len(databases)!=1 or databases[0].get('database_name')!='mavi-basim-seo' or databases[0].get('binding')!='DB':
  raise ValueError('UNEXPECTED_D1_BINDING')
 database=databases[0]['database_id']
 result={'observed_at':datetime.now(timezone.utc).isoformat(),'git_commit':os.environ.get('GITHUB_SHA'),
         'worker':'mavi-basim-seo-prod','database':'mavi-basim-seo','read_only':True,'queries':{}}
 result['daily_d1_usage']=client.daily_usage()
 usage=result['daily_d1_usage']
 safe=usage.get('ok') and usage.get('hours',0)>0 and usage.get('rows_read',5_000_000)<3_500_000
 for name,sql in QUERIES.items():result['queries'][name]=client.query(database,sql) if safe else {'ok':False,'code':'D1_READ_QUOTA_HOLD'}
 base=f'/accounts/{client.account}/workers/scripts/mavi-basim-seo-prod'
 settings=client.request('GET',base+'/settings')
 if settings['ok']:
  flags={}
  for b in settings['result'].get('bindings',[]):
   if b.get('name') in ('AUTOMATION_ENABLED','CRAWL_ENABLED','ENABLE_GOOGLE_ADS','GSC_PROPERTY','SITE_ORIGIN','CATCHUP_ENABLED','SYNC_DAILY_WRITE_LIMIT','SYNC_INITIAL_BUDGET_DAY','SYNC_INITIAL_WRITE_LIMIT','D1_READ_GUARD_ENABLED','SYNC_MAX_PAGES_PER_TICK') and b.get('type')=='plain_text':flags[b['name']]=b.get('text')
  result['runtime']={'ok':True,'flags':flags,'binding_names':sorted(b.get('name','') for b in settings['result'].get('bindings',[]))}
 else:result['runtime']=settings
 schedules=client.request('GET',base+'/schedules')
 if schedules['ok']:
  schedule_rows=schedules['result'].get('schedules',[]) if isinstance(schedules['result'],dict) else schedules['result']
  result['schedules']={'ok':True,'crons':[s.get('cron') for s in (schedule_rows or []) if isinstance(s,dict)]}
 else:result['schedules']=schedules
 deployments=client.request('GET',base+'/deployments')
 if deployments['ok']:
  rows=deployments['result'].get('deployments',[]) if isinstance(deployments['result'],dict) else deployments['result']
  result['deployments']={'ok':True,'versions':[{'id':r.get('id'),'created_on':r.get('created_on'),'versions':[{'version_id':v.get('version_id'),'percentage':v.get('percentage')} for v in r.get('versions',[])],'commit_labels':re.findall(r'\b[a-f0-9]{40}\b',json.dumps(r.get('annotations',{})))} for r in rows[:3]]}
 else:result['deployments']=deployments
 result['acceptance']=acceptance(result)
 return result

if __name__=='__main__':
 try:
  config=json.loads(Path('deploy/wrangler.production.jsonc').read_text())
  result=collect(Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID')),config)
  output=Path('.local/production-diagnostics.json');output.parent.mkdir(exist_ok=True);output.write_text(json.dumps(result,ensure_ascii=False,indent=2))
  print(json.dumps(result,ensure_ascii=False,indent=2))
 except Exception as error:
  code=str(error) if isinstance(error,ValueError) and re.fullmatch(r'[A-Z_]+',str(error)) else type(error).__name__
  raise SystemExit('READ_ONLY_DIAGNOSTICS_FAILED:'+code+'; no credentials or raw provider errors printed')
