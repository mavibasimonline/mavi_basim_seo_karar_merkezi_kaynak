"""Controlled isolated verified-monthly-cache release. Existing D1 data and limits are immutable."""
import json,os,re,secrets,subprocess,time,urllib.request,urllib.error
from pathlib import Path
from datetime import datetime,timezone
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api,active_version,cron_rows,free_plan
from release_readiness import get_json,REPOSITORY
from independent_drive_release import assets
from d1_quota_checkpoint import observation
ROOT=Path(__file__).resolve().parents[1]
BASE='585e338843778d06a5535b53f074cac548549ffb'
SOURCE='4f8724a481a3fe9899ea1f4d1a7952b08ee29df2'
REVIEW='45cf43fae7bbc7f21ee2f5dbfedd133aa32ab6a2'
OLD_VERSION='710e7a45-1db7-4130-8e8f-fee09a9671ae'
APP='mavi-basim-seo-prod';STORE='mavi-basim-monthly-store';WARM='mavi-basim-monthly-source-warm'
DATABASE='18f8c90d-4af1-430c-ac86-ddf184c75a0b'
FILES={'src/analysis.ts','src/questions.ts','src/validation.ts','src/d1-read-budget.ts','src/index.ts','src/monthly-source.ts','src/monthly-model.ts','src/monthly-store.ts','src/monthly-route.ts','public/app.js','public/evidence.js','deploy/wrangler.monthly-app.jsonc','deploy/wrangler.monthly-store.jsonc','vitest.config.ts','vitest.monthly.config.ts','tests/monthly-source.test.ts','tests/monthly-route.test.ts','tests/monthly-store/store.test.ts','.github/workflows/ci.yml'}
def need(value,code):
 if not value:raise ValueError(code)
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,stderr=subprocess.DEVNULL)
def ci(sha,branch,event):
 rows=get_json('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/ci.yml/runs?head_sha='+sha+'&per_page=30',os.environ.get('GITHUB_TOKEN')).get('workflow_runs',[])
 need(any(r.get('head_sha')==sha and r.get('head_branch')==branch and r.get('event')==event and r.get('conclusion')=='success' and r.get('status')=='completed' for r in rows),'MONTHLY_EXACT_GREEN_CI_REQUIRED')
def source_check():
 need(re.fullmatch('[a-f0-9]{40}',SOURCE),'MONTHLY_SOURCE_PIN_REQUIRED')
 need(git('rev-parse',SOURCE+'^').decode().strip()==BASE,'MONTHLY_ISOLATED_BASE_REQUIRED')
 need(set(git('diff','--name-only',BASE,SOURCE).decode().splitlines())==FILES,'MONTHLY_SOURCE_SCOPE_CHANGED')
 for path in FILES-{'src/index.ts','public/app.js'}:need(git('show',SOURCE+':'+path)==(ROOT/path).read_bytes(),'MONTHLY_APPROVED_FILE_MISMATCH')
 def edits(a,b,path):return [s for s in git('diff','--unified=0',a,b,'--',path).decode().splitlines() if s.startswith(('+','-')) and not s.startswith(('+++','---'))]
 for path in ('src/index.ts','public/app.js'):need(edits(REVIEW,'HEAD',path)==edits(BASE,SOURCE,path),'MONTHLY_ISOLATED_ROUTING_MISMATCH')
 # No changes to OAuth, existing automation, schema, secrets, limits or source records.
 for path in ('src/google.ts','src/security.ts','src/types.ts','src/sync.ts','src/sync-budget.ts','src/drive-independent.ts','src/drive-broker.ts','package.json','package-lock.json','deploy/wrangler.production.jsonc'):
  need(git('show',BASE+':'+path)==git('show',SOURCE+':'+path),'MONTHLY_PROTECTED_FILE_CHANGED')
 old=git('show',BASE+':src/d1-read-budget.ts').decode();new=git('show',SOURCE+':src/d1-read-budget.ts').decode()
 for key in ('ACCOUNT_READ_STOP','ACCOUNT_WRITE_STOP','LOCAL_READ_STOP','LOCAL_WRITE_STOP','INTERACTIVE_READ_HEADROOM','INTERACTIVE_WRITE_HEADROOM'):
  need(re.search(r'\b'+key+r'=([\d_]+)',old).group(1)==re.search(r'\b'+key+r'=([\d_]+)',new).group(1),'MONTHLY_QUOTA_LIMIT_CHANGED')
def run():
 sha=os.environ.get('GITHUB_SHA','');need(os.environ.get('GITHUB_REF')=='refs/heads/main' and os.environ.get('GITHUB_REPOSITORY')==REPOSITORY,'MONTHLY_MAIN_CONTEXT_REQUIRED')
 need(get_json('https://api.github.com/repos/'+REPOSITORY+'/branches/main',os.environ.get('GITHUB_TOKEN')).get('commit',{}).get('sha')==sha,'MONTHLY_MAIN_SUPERSEDED')
 ci(sha,'main','push');ci(SOURCE,'release/monthly-snapshot-cache','workflow_dispatch');source_check()
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
 free_plan(api(client,'GET','/subscriptions'))
 inventory=api(client,'GET','/workers/scripts');need(isinstance(inventory,list) and len(inventory)<98,'MONTHLY_FREE_WORKER_LIMIT_REQUIRED')
 need(not any(w.get('id') in (STORE,WARM) for w in inventory),'MONTHLY_PREVIOUS_INSTALL_REQUIRES_REVIEW')
 def lock(worker):return {'version':active_version(api(client,'GET','/workers/scripts/'+worker+'/deployments')),'crons':cron_rows(api(client,'GET','/workers/scripts/'+worker+'/schedules')),'bindings':sorted(api(client,'GET','/workers/scripts/'+worker+'/settings').get('bindings',[]),key=lambda b:b['name'])}
 saved={w:lock(w) for w in (APP,'mavi-basim-drive-archive','mavi-basim-quota-observer')}
 need(saved[APP]['version']==OLD_VERSION,'MONTHLY_LIVE_VERSION_CHANGED')
 need(api(client,'GET','/workers/scripts/'+APP+'/versions/'+OLD_VERSION).get('annotations',{}).get('workers/tag')==BASE,'MONTHLY_LIVE_SOURCE_CHANGED')
 need(get_json('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/health').get('deployment',{}).get('commit')==BASE,'MONTHLY_HTTP_SOURCE_CHANGED')
 usage=observation(client);need(usage.get('ok') and usage.get('mode')=='open','MONTHLY_CURRENT_ACCOUNT_QUOTA_REQUIRED')
 day=datetime.now(timezone.utc).date().isoformat()
 def query(sql,params):
  result=api(client,'POST','/d1/database/'+DATABASE+'/query',{'sql':sql,'params':params})
  need(sum(s.get('meta',{}).get('rows_read',10000000) for s in result)<5000,'MONTHLY_READ_DIAGNOSTIC_BOUND')
  return [row for s in result for row in s.get('results',[])]
 def quota():
  state=query('SELECT account_reads,account_writes,mode,observed_at,valid_until FROM d1_quota_state WHERE day=?',[day]);ledger=query('SELECT reads,writes FROM d1_quota_ledger WHERE day=?',[day])
  need(len(state)==len(ledger)==1 and state[0]['mode']=='open' and datetime.fromisoformat(state[0]['valid_until'].replace('Z','+00:00'))>datetime.now(timezone.utc),'MONTHLY_FRESH_LEASE_REQUIRED')
  return {'reads':min(2000000,3500000-state[0]['account_reads'])-ledger[0]['reads'],'writes':min(65000,85000-state[0]['account_writes'])-ledger[0]['writes']}
 available=quota();need(available['writes']>=176 and available['reads']>=600000,'MONTHLY_INSUFFICIENT_REAL_WARM_CAPACITY')
 ids=[f'gsc:2026-07-{d:02}:{scope}' for d in range(1,27) for scope in ('page','query')]
 def preserved():return {'evidence':query("SELECT count(*) n FROM insight_runs WHERE kind='sheets-source-evidence'",[])[0]['n'],'gsc':query("SELECT count(*) n FROM sync_jobs j JOIN dataset_coverage c ON c.provider=j.provider AND c.day=j.day AND c.scope=j.scope AND c.dataset_id=j.generation WHERE j.id IN ("+','.join('?' for _ in ids)+") AND j.status='done' AND c.complete=1",ids)[0]['n']}
 before=preserved();need(before=={'evidence':1542,'gsc':52},'MONTHLY_PRESERVED_DATA_REQUIRED')
 bookmark=api(client,'GET','/d1/database/'+DATABASE+'/time_travel/bookmark');need(bool(re.fullmatch('[a-f0-9-]{20,100}',bookmark.get('bookmark',''))),'MONTHLY_NATIVE_BACKUP_REQUIRED')
 assets(BASE)
 folder=ROOT/'.local/monthly-source';subprocess.run(['git','worktree','add','--detach',str(folder),SOURCE],cwd=ROOT,check=True,capture_output=True);(folder/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
 appcfg=json.loads((folder/'deploy/wrangler.monthly-app.jsonc').read_text());oldcfg=json.loads(git('show',BASE+':deploy/wrangler.drive-independent.jsonc'))
 need(appcfg=={**oldcfg,'services':oldcfg['services']+[{'binding':'MONTHLY_ANALYSES','service':STORE}]},'MONTHLY_APP_CONFIG_CHANGED')
 storecfg=json.loads((folder/'deploy/wrangler.monthly-store.jsonc').read_text())
 need(storecfg.get('name')==STORE and storecfg.get('workers_dev') is False and storecfg.get('preview_urls') is False and storecfg.get('durable_objects')=={'bindings':[{'name':'MONTHLY_STORE','class_name':'MonthlySnapshotStore'}]} and storecfg.get('migrations')==[{'tag':'monthly-snapshots-v1','new_sqlite_classes':['MonthlySnapshotStore']}],'MONTHLY_PRIVATE_FREE_STORE_REQUIRED')
 need(not any(storecfg.get(k) for k in ('d1_databases','r2_buckets','kv_namespaces','limits','triggers','routes','queues')),'MONTHLY_STORE_MUST_NOT_HAVE_D1_OR_PAID_RESOURCES')
 variables={b['name']:b['text'] for b in saved[APP]['bindings'] if b.get('type')=='plain_text'}
 op=ROOT/'.local/monthly-probe';op.mkdir(parents=True,exist_ok=True);op.chmod(0o700)
 key=secrets.token_hex(32);secret=op/'.dev.vars';secret.write_text('RELEASE_PROBE_KEY='+key+'\n');secret.chmod(0o600)
 probe_cfg={'name':APP,'main':str(ROOT/'scripts/monthly-release-probe.ts'),'compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,'vars':variables,'unsafe':{'bindings':[{'name':'ADMIN_TOKEN','type':'inherit'}]},'services':[{'binding':'LIVE_APP','service':APP},{'binding':'REPORTS','service':STORE}]}
 (op/'wrangler.jsonc').write_text(json.dumps(probe_cfg))
 warmcfg={'name':WARM,'main':str(ROOT/'scripts/monthly-warm-source.ts'),'compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,'vars':variables,'d1_databases':[{'binding':'DB','database_name':'mavi-basim-seo','database_id':DATABASE}],'observability':{'enabled':False}}
 (op/'warm.jsonc').write_text(json.dumps(warmcfg))
 dormant={**storecfg,'main':str(folder/'src/monthly-store.ts'),'vars':{'STORE_ENABLED':'false'},'services':[{'binding':'SOURCE','service':WARM}]}
 (op/'store.jsonc').write_text(json.dumps(dormant))
 def deploy(cwd,config,extra=()):
  result=subprocess.run(['node',str(ROOT/'scripts/run.mjs'),'wrangler','deploy','--config',str(config),'--keep-vars','--tag',SOURCE,'--message','Verified monthly cache; existing D1 and automation preserved',*extra],cwd=cwd)
  need(result.returncode==0,'MONTHLY_DEPLOY_FAILED')
 def own(worker):
  current=lock(worker)['version'];need(api(client,'GET','/workers/scripts/'+worker+'/versions/'+current).get('annotations',{}).get('workers/tag')==SOURCE,'MONTHLY_FOREIGN_WORKER_NO_MUTATION')
 def probe(path):
  req=urllib.request.Request('http://127.0.0.1:8799'+path,headers={'Authorization':'Bearer '+key,'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json'})
  try:
   with urllib.request.urlopen(req,timeout=180) as r:return {'status':r.status,**json.loads(r.read(100000))}
  except urllib.error.HTTPError as e:return {'status':e.code,**json.loads(e.read(100000))}
 p=None;started=False;store_started=False;warm_started=False;complete=False
 try:
  deploy(ROOT,op/'warm.jsonc');warm_started=True
  deploy(ROOT,op/'store.jsonc');store_started=True
  with (op/'runtime.log').open('w') as log:
   p=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--remote','--config',str(op/'wrangler.jsonc'),'--ip','127.0.0.1','--port','8799','--log-level','error'],cwd=ROOT,stdout=log,stderr=log)
   for attempt in range(40):
    need(p.poll() is None,'MONTHLY_PROBE_RUNTIME_FAILED')
    try:
     if probe('/health').get('admin_configured'):break
    except (OSError,ValueError):pass
    time.sleep(1)
   else:raise ValueError('MONTHLY_PROBE_RUNTIME_TIMEOUT')
   warm=probe('/warm');print(json.dumps({'real_source_warm':warm}),flush=True)
   need(warm.get('ok') and warm.get('status')==200 and warm.get('source_cost',{}).get('physical_rows_written',1000000)<=56,'MONTHLY_VERIFIED_REAL_WARM_REQUIRED')
   need(probe('/cache-health').get('ready'),'MONTHLY_CACHE_NOT_READY')
   need(quota()['writes']>=64,'MONTHLY_LOGIN_CAPACITY_MUST_REMAIN')
   need(all(lock(w)==state for w,state in saved.items()),'MONTHLY_CONCURRENT_WORKER_CHANGE')
   ci(sha,'main','push');started=True
   deploy(folder,folder/'deploy/wrangler.monthly-app.jsonc')
   deploy(folder,folder/'deploy/wrangler.monthly-store.jsonc',('--var','STORE_ENABLED:true'))
   from production_guard import converged_smoke
   live=converged_smoke(client,SOURCE,OLD_VERSION)
   after={w:lock(w) for w in saved};need(all(after[w]==saved[w] for w in saved if w!=APP),'MONTHLY_INDEPENDENT_WORKER_CHANGED')
   need(after[APP]['crons']==saved[APP]['crons'],'MONTHLY_EXISTING_CRON_CHANGED')
   old_bindings={b['name']:b for b in saved[APP]['bindings']};new_bindings={b['name']:b for b in after[APP]['bindings']}
   need(all(new_bindings.get(k)==v for k,v in old_bindings.items()) and set(new_bindings)-set(old_bindings)=={'MONTHLY_ANALYSES'},'MONTHLY_EXISTING_BINDING_CHANGED')
   store=lock(STORE);need(store['crons']==[] and not any(b.get('type')=='d1' for b in store['bindings']),'MONTHLY_STORE_HAS_D1_OR_CRON')
   for worker in (STORE,WARM):
    subdomain=api(client,'GET','/workers/scripts/'+worker+'/subdomain');need(subdomain.get('enabled') is False and subdomain.get('previews_enabled') is False,'MONTHLY_PRIVATE_ENDPOINT_REQUIRED')
   alarm=probe('/activate');need(alarm.get('ok') and alarm.get('alarm',0)>time.time()*1000,'MONTHLY_AUTOMATIC_REFRESH_NOT_ARMED')
   accepted=probe('/accept');print(json.dumps({'live_monthly_acceptance':accepted}),flush=True);need(accepted.get('passed'),'MONTHLY_LIVE_ACCEPTANCE_FAILED')
   held=probe('/blocked-refresh');print(json.dumps({'actual_background_refresh':held}),flush=True)
   retained=probe('/accept');print(json.dumps({'live_retained_acceptance':retained}),flush=True)
   need(retained.get('passed'),'MONTHLY_RETAINED_CACHE_ACCEPTANCE_FAILED')
   if held.get('held'):need(retained.get('july_id')==accepted.get('july_id'),'MONTHLY_BLOCKED_REFRESH_REPLACED_SNAPSHOT')
   need(preserved()==before,'MONTHLY_DATA_CHANGED');assets(SOURCE)
   need(all(lock(w)==saved[w] for w in saved if w!=APP),'MONTHLY_INDEPENDENT_WORKER_CHANGED')
   own(WARM);api(client,'DELETE','/workers/scripts/'+WARM);warm_started=False
   complete=True
   print(json.dumps({'deployed':True,'source':SOURCE,'version':live['version_id'],'monthly_reports':True,'questions':True,'d1_reads_per_cached_request':0,'source_cost':warm['source_cost'],'automatic_refresh_alarm':alarm['alarm'],'background_refresh':held,'data_preserved':before,'drive_observer_cron_preserved':True,'rollback':False}),flush=True)
 except Exception:
  if started:
   current=lock(APP)['version']
   if current!=OLD_VERSION:
    own(APP);result=subprocess.run(['node','scripts/run.mjs','wrangler','rollback',OLD_VERSION,'--config','deploy/wrangler.drive-independent.jsonc','--message','Monthly cache acceptance rollback','--yes'],cwd=ROOT);need(result.returncode==0,'MONTHLY_ROLLBACK_FAILED')
  if store_started:
   own(STORE)
   # On a failed release the dormant store keeps its verified data, without alarms.
   deploy(ROOT,op/'store.jsonc',('--var','STORE_ENABLED:false'))
  raise
 finally:
  if p is not None:
   p.terminate()
   try:p.wait(timeout=5)
   except subprocess.TimeoutExpired:p.kill();p.wait()
  secret.unlink(missing_ok=True)
if __name__=='__main__':
 try:run()
 except Exception as error:
  code=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z0-9_]+',str(error)) else type(error).__name__
  raise SystemExit('MONTHLY_RELEASE_STOPPED_NO_RETRY:'+code)
