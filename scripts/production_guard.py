"""Read deployment/settings and save rollback identity. No secret values are serialized."""
import json
import math
import os
import re
import urllib.request
from datetime import datetime,timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare,QUERIES
from release_checks import config_errors
from d1_quota_checkpoint import NOT_BEFORE

CONFIG=Path('deploy/wrangler.production.jsonc')
APP='https://mavi-basim-seo-prod.mavibasimonline.workers.dev'

def verify_schema(client,config,migrations_dir=None):
 # Code-only releases must never create the migrations table or apply pending
 # schema changes. Read the existing ledger through the fixed SELECT allowlist.
 if config_errors(config):raise ValueError('PRODUCTION_CONFIG_REJECTED')
 folder=Path(migrations_dir) if migrations_dir is not None else Path(__file__).resolve().parents[1]/'migrations'
 expected=sorted(p.name for p in folder.glob('*.sql') if p.is_file())
 if not expected or any(not re.fullmatch(r'[0-9]{4}_[a-z0-9_]+\.sql',name) for name in expected):raise ValueError('LOCAL_SCHEMA_MANIFEST_INVALID')
 result=client.query(config['d1_databases'][0]['database_id'],QUERIES['migrations'])
 if not isinstance(result,dict):raise ValueError('EXISTING_SCHEMA_READ_FAILED')
 rows=result.get('rows')
 if result.get('ok') is not True or not isinstance(rows,list):raise ValueError('EXISTING_SCHEMA_READ_FAILED')
 if any(not isinstance(row,dict) or not isinstance(row.get('name'),str) for row in rows):raise ValueError('EXISTING_SCHEMA_RECORD_INVALID')
 names=[row['name'] for row in rows]
 if len(names)!=len(set(names)) or names!=expected:raise ValueError('EXISTING_SCHEMA_MISMATCH')
 return {'verified':True,'migrations':names,'database_queries':1,'rows_returned':len(rows),'rows_read':result.get('rows_read'),'schema_changes':False,'migration_application_started':False}

def preflight(client,config,expected):
 errors=config_errors(config)
 if errors:raise ValueError('PRODUCTION_CONFIG_REJECTED')
 if datetime.now(timezone.utc)<NOT_BEFORE:raise ValueError('D1_QUOTA_RESET_REQUIRED')
 if not re.fullmatch(r'[a-f0-9-]{36}',expected or ''):raise ValueError('PREVIOUS_VERSION_REQUIRED')
 base=f'/accounts/{client.account}/workers/scripts/mavi-basim-seo-prod'
 deployments=client.request('GET',base+'/deployments')
 if not deployments['ok']:raise ValueError('WORKER_VERSION_READ_FAILED')
 records=deployments['result'].get('deployments',[]) if isinstance(deployments['result'],dict) else deployments['result']
 latest=sorted(records,key=lambda r:r.get('created_on',''),reverse=True)[0]
 versions=latest.get('versions',[])
 if len(versions)!=1 or versions[0].get('percentage')!=100 or versions[0].get('version_id')!=expected:raise ValueError('PRODUCTION_VERSION_CHANGED')
 settings=client.request('GET',base+'/settings');schedules=client.request('GET',base+'/schedules')
 if not settings['ok'] or not schedules['ok']:raise ValueError('RUNTIME_READ_FAILED')
 bindings=settings['result'].get('bindings',[]);names={b.get('name') for b in bindings};plain={b['name']:b.get('text','') for b in bindings if b.get('type')=='plain_text'}
 binding=next((b for b in bindings if b.get('name')=='DB' and b.get('type')=='d1'),{})
 if (binding.get('id') or binding.get('database_id'))!=config['d1_databases'][0]['database_id']:raise ValueError('D1_BINDING_DRIFT')
 usage=client.daily_usage()
 if not usage.get('ok') or usage.get('hours',0)==0:raise ValueError('D1_QUOTA_READ_REQUIRED')
 if any(isinstance(usage.get(key),bool) or not isinstance(usage.get(key),(int,float)) or not math.isfinite(usage[key]) or usage[key]<0 or int(usage[key])!=usage[key] for key in ('rows_read','rows_written')):raise ValueError('D1_QUOTA_READ_REQUIRED')
 if usage['rows_read']>3_500_000 or usage['rows_written']>85_000:raise ValueError('D1_DAILY_BUDGET_UNAVAILABLE')
 source=client.query(config['d1_databases'][0]['database_id'],QUERIES['source_counts'])
 if not source['ok'] or source['rows']!=[{'products':29,'csv_files':521,'csv_rows':9075}]:raise ValueError('SOURCE_ARCHIVE_COUNTS_CHANGED')
 for name in ('ADMIN_TOKEN','TOKEN_ENCRYPTION_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'):
  if name not in names:raise ValueError('EXISTING_AUTH_BINDING_MISSING')
 for name in ('SITE_ORIGIN','GSC_PROPERTY','GOOGLE_REDIRECT_URI','AUTOMATION_ENABLED','CRAWL_ENABLED','ENABLE_GOOGLE_ADS','GA4_PROPERTY_ID'):
  if plain.get(name,'')!=config['vars'].get(name,''):raise ValueError('RUNTIME_CONFIG_DRIFT')
 rows=schedules['result'].get('schedules',[]) if isinstance(schedules['result'],dict) else schedules['result']
 crons=[r['cron'] for r in rows]
 if crons not in (['*/15 * * * *'],['* * * * *']):raise ValueError('UNEXPECTED_CURRENT_CRON')
 if config['vars'].get('CATCHUP_ENABLED')=='true':
  day=datetime.now(timezone.utc).date().isoformat();budget=int(config['vars']['SYNC_INITIAL_WRITE_LIMIT'] if day==config['vars']['SYNC_INITIAL_BUDGET_DAY'] else config['vars']['SYNC_DAILY_WRITE_LIMIT'])
  if not usage['ok'] or usage.get('hours',0)==0:raise ValueError('D1_QUOTA_READ_REQUIRED')
  # Analytics already includes spent sync writes. Reserving the entire daily
  # allowance a second time blocks harmless releases after normal collection.
  counter=client.query(config['d1_databases'][0]['database_id'],QUERIES['sync_budget_history'])
  if not counter.get('ok'):raise ValueError('D1_SYNC_BUDGET_READ_REQUIRED')
  today=[r for r in counter['rows'] if r.get('day')==day]
  try:spent=float(today[0]['code']) if len(today)==1 else 0 if not today else float('nan')
  except (ValueError,TypeError,KeyError):raise ValueError('D1_SYNC_BUDGET_READ_REQUIRED')
  if not math.isfinite(spent) or spent<0:raise ValueError('D1_SYNC_BUDGET_READ_REQUIRED')
  remaining=max(0,budget-spent)
  projected=max(usage['rows_written'],spent)+remaining
  if projected+20_000>90_000 or usage['rows_read']>3_500_000:raise ValueError('D1_DAILY_BUDGET_UNAVAILABLE')
  usage={**usage,'sync_daily_limit':budget,'sync_reserved_writes':spent,'sync_remaining_allowance':remaining,'projected_writes':projected,'migration_write_reserve':20000,'total_projected_writes':projected+20000}
 return {'worker':'mavi-basim-seo-prod','previous_version':expected,'previous_crons':crons,'binding_names':sorted(names),'source_counts':source['rows'][0],'schema_changes':False,'secret_changes':False,'daily_d1_usage':usage}

def restore_cron(client,saved):
 if saved.get('worker')!='mavi-basim-seo-prod' or saved.get('previous_crons') not in (['*/15 * * * *'],['* * * * *']):raise ValueError('INVALID_ROLLBACK_RECORD')
 result=client.request('PUT',f'/accounts/{client.account}/workers/scripts/mavi-basim-seo-prod/schedules',[{'cron':c} for c in saved['previous_crons']])
 if not result['ok']:raise ValueError('CRON_ROLLBACK_FAILED')

def pause_cron(client):
 path=f'/accounts/{client.account}/workers/scripts/mavi-basim-seo-prod/schedules'
 changed=client.request('PUT',path,[])
 if not changed.get('ok'):raise ValueError('SAFE_CRON_HOLD_FAILED')
 verified=client.request('GET',path)
 if not verified.get('ok'):raise ValueError('SAFE_CRON_HOLD_FAILED')
 rows=verified['result'].get('schedules',[]) if isinstance(verified['result'],dict) else verified['result']
 if rows:raise ValueError('SAFE_CRON_HOLD_FAILED')

def smoke(commit,opener=None):
 if not re.fullmatch(r'[a-f0-9]{40}',commit):raise ValueError('INVALID_COMMIT')
 request=urllib.request.Request(APP+'/api/health?release='+commit,headers={'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json'})
 with (opener or urllib.request.build_opener()).open(request,timeout=30) as r:
  payload=json.loads(r.read(20000))
 if payload.get('deployment',{}).get('commit')!=commit or payload.get('deployment',{}).get('runtime_revision')!='gsc-catchup-v1' or payload.get('deployment',{}).get('read_guard_revision')!='d1-account-reads-v1':raise ValueError('DEPLOYED_COMMIT_MISMATCH')
 return payload['deployment']

def postflight(client,config,saved,commit,opener=None):
 deployment=smoke(commit,opener)
 # HTTP identity must match the actual 100% Worker deployment and preserved D1/auth bindings.
 verified=preflight(client,config,deployment.get('version_id'))
 settings=client.request('GET',f'/accounts/{client.account}/workers/scripts/mavi-basim-seo-prod/settings')
 plain={b['name']:b.get('text','') for b in settings.get('result',{}).get('bindings',[]) if b.get('type')=='plain_text'}
 if plain.get('D1_READ_GUARD_ENABLED')!='true' or plain.get('SYNC_MAX_PAGES_PER_TICK')!='1':raise ValueError('D1_READ_GUARD_NOT_ACTIVE')
 if not set(saved['binding_names']).issubset(verified['binding_names']):raise ValueError('EXISTING_BINDING_REMOVED')
 return {'deployment':deployment,'source_counts':verified['source_counts'],'existing_bindings_preserved':True}

if __name__=='__main__':
 import sys
 try:
  client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
  mode=sys.argv[1];path=Path('.local/production-before.json');path.parent.mkdir(exist_ok=True)
  if mode=='preflight':
   result=preflight(client,json.loads(CONFIG.read_text()),os.environ.get('EXPECTED_PREVIOUS_VERSION'));path.write_text(json.dumps(result,indent=2));print(json.dumps(result))
   if os.environ.get('GITHUB_OUTPUT'):
    with open(os.environ['GITHUB_OUTPUT'],'a') as out:out.write('previous_version='+result['previous_version']+'\n')
  elif mode=='verify-schema':
   result=verify_schema(client,json.loads(CONFIG.read_text()));Path('.local/schema-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
  elif mode=='pause-cron':pause_cron(client);print('Failed-release cron held; queue and Google/source records preserved')
  elif mode=='restore-cron':restore_cron(client,json.loads(path.read_text()));print('Previous cron restored; no database or secret modified')
  elif mode=='smoke':print(json.dumps(postflight(client,json.loads(CONFIG.read_text()),json.loads(path.read_text()),os.environ.get('RELEASE_SOURCE_COMMIT') or os.environ.get('GITHUB_SHA',''))))
  else:raise ValueError('INVALID_OPERATION')
 except Exception as error:
  code=str(error) if isinstance(error,ValueError) and re.fullmatch(r'[A-Z0-9_]+',str(error)) else type(error).__name__
  raise SystemExit('PRODUCTION_GUARD_FAILED:'+code)
