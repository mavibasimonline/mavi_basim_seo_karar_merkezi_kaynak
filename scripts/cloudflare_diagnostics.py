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
  if not sql.lstrip().upper().startswith(('SELECT ', 'WITH ')):
   raise ValueError('READ_ONLY_QUERY_REQUIRED')
  if not re.fullmatch(r'[a-f0-9-]{36}', database):raise ValueError('INVALID_DATABASE_ID')
  result=self.request('POST',f'/accounts/{self.account}/d1/database/{database}/query',{'sql':sql,'params':[]})
  if not result['ok']:return result
  return {'ok':True,'rows':[row for statement in result['result'] for row in statement.get('results',[])],
          'rows_read':sum(s.get('meta',{}).get('rows_read',0) for s in result['result'])}

def collect(client, config):
 if config.get('name')!='mavi-basim-seo-prod' or config.get('route') or config.get('routes'):
  raise ValueError('UNEXPECTED_WORKER_OR_SITE_ROUTE')
 databases=config.get('d1_databases',[])
 if len(databases)!=1 or databases[0].get('database_name')!='mavi-basim-seo' or databases[0].get('binding')!='DB':
  raise ValueError('UNEXPECTED_D1_BINDING')
 database=databases[0]['database_id']
 result={'observed_at':datetime.now(timezone.utc).isoformat(),'git_commit':os.environ.get('GITHUB_SHA'),
         'worker':'mavi-basim-seo-prod','database':'mavi-basim-seo','read_only':True,'queries':{}}
 for name,sql in QUERIES.items():result['queries'][name]=client.query(database,sql)
 base=f'/accounts/{client.account}/workers/scripts/mavi-basim-seo-prod'
 settings=client.request('GET',base+'/settings')
 if settings['ok']:
  flags={}
  for b in settings['result'].get('bindings',[]):
   if b.get('name') in ('AUTOMATION_ENABLED','CRAWL_ENABLED','ENABLE_GOOGLE_ADS','GSC_PROPERTY','SITE_ORIGIN') and b.get('type')=='plain_text':flags[b['name']]=b.get('text')
  result['runtime']={'ok':True,'flags':flags,'binding_names':sorted(b.get('name','') for b in settings['result'].get('bindings',[]))}
 else:result['runtime']=settings
 schedules=client.request('GET',base+'/schedules')
 result['schedules']={'ok':True,'crons':[s.get('cron') for s in schedules['result']]} if schedules['ok'] else schedules
 deployments=client.request('GET',base+'/deployments')
 if deployments['ok']:
  rows=deployments['result'].get('deployments',[]) if isinstance(deployments['result'],dict) else deployments['result']
  result['deployments']={'ok':True,'versions':[{'id':r.get('id'),'created_on':r.get('created_on'),'versions':r.get('versions'),'commit_labels':re.findall(r'\b[a-f0-9]{40}\b',json.dumps(r.get('annotations',{})))} for r in rows[:3]]}
 else:result['deployments']=deployments
 return result

if __name__=='__main__':
 try:
  config=json.loads(Path('deploy/wrangler.production.jsonc').read_text())
  result=collect(Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID')),config)
  output=Path('.local/production-diagnostics.json');output.parent.mkdir(exist_ok=True);output.write_text(json.dumps(result,ensure_ascii=False,indent=2))
  print(json.dumps(result,ensure_ascii=False,indent=2))
 except Exception:
  raise SystemExit('READ_ONLY_DIAGNOSTICS_FAILED; no credentials or raw provider errors printed')
