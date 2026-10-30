"""Controlled isolated login-budget release. No schema, token, Cron or limit changes."""
import json,os,re,secrets,subprocess,time,urllib.request,urllib.error
from pathlib import Path
from datetime import datetime,timezone
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api,active_version,cron_rows,free_plan
from release_readiness import get_json,REPOSITORY
from independent_drive_release import assets
from d1_quota_checkpoint import observation
ROOT=Path(__file__).resolve().parents[1]
BASE='c64e0c3128a41c5851833cf644faa8c48b6bba53'
SOURCE='585e338843778d06a5535b53f074cac548549ffb'
APP='mavi-basim-seo-prod';OLD_VERSION='42e30a8d-7070-4644-9202-2c51c472e976'
def need(value,code):
 if not value:raise ValueError(code)
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,stderr=subprocess.DEVNULL)
def ci(sha,branch,event):
 rows=get_json('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/ci.yml/runs?head_sha='+sha+'&per_page=30',os.environ.get('GITHUB_TOKEN')).get('workflow_runs',[])
 need(any(r.get('head_sha')==sha and r.get('head_branch')==branch and r.get('event')==event and r.get('conclusion')=='success' and r.get('status')=='completed' for r in rows),'LOGIN_EXACT_GREEN_CI_REQUIRED')
def run():
 sha=os.environ.get('GITHUB_SHA','');need(os.environ.get('GITHUB_REF')=='refs/heads/main','LOGIN_MAIN_CONTEXT_REQUIRED')
 ci(sha,'main','push');ci(SOURCE,'release/login-write-reservation','workflow_dispatch')
 need(git('rev-parse',SOURCE+'^').decode().strip()==BASE,'LOGIN_ISOLATED_BASE_REQUIRED')
 changed=set(git('diff','--name-only',BASE,SOURCE).decode().splitlines())
 need(changed=={'src/d1-read-budget.ts','tests/login-write-reservation.test.ts','.github/workflows/ci.yml'},'LOGIN_SOURCE_SCOPE_CHANGED')
 for path in changed:need(git('show',SOURCE+':'+path)==(ROOT/path).read_bytes(),'LOGIN_APPROVED_SOURCE_MISMATCH')
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
 free_plan(api(client,'GET','/subscriptions'))
 def locks():return {w:{'version':active_version(api(client,'GET','/workers/scripts/'+w+'/deployments')),'crons':cron_rows(api(client,'GET','/workers/scripts/'+w+'/schedules')),'bindings':sorted(api(client,'GET','/workers/scripts/'+w+'/settings').get('bindings',[]),key=lambda b:b['name'])} for w in (APP,'mavi-basim-drive-archive','mavi-basim-quota-observer')}
 saved=locks();need(saved[APP]['version']==OLD_VERSION,'LOGIN_LIVE_VERSION_CHANGED')
 need(api(client,'GET','/workers/scripts/'+APP+'/versions/'+OLD_VERSION).get('annotations',{}).get('workers/tag')==BASE,'LOGIN_LIVE_SOURCE_CHANGED')
 usage=observation(client);need(usage.get('ok') and usage.get('mode')=='open','LOGIN_CURRENT_ACCOUNT_QUOTA_REQUIRED')
 day=datetime.now(timezone.utc).date().isoformat()
 def query(sql,params):
  result=api(client,'POST','/d1/database/18f8c90d-4af1-430c-ac86-ddf184c75a0b/query',{'sql':sql,'params':params})
  need(sum(s.get('meta',{}).get('rows_read',10000000) for s in result)<3000,'LOGIN_READ_DIAGNOSTIC_BOUND')
  return [row for s in result for row in s.get('results',[])]
 def quota():
  state=query('SELECT account_writes,mode,observed_at,valid_until FROM d1_quota_state WHERE day=?',[day]);ledger=query('SELECT writes FROM d1_quota_ledger WHERE day=?',[day])
  need(len(state)==len(ledger)==1 and state[0]['mode']=='open' and datetime.fromisoformat(state[0]['valid_until'].replace('Z','+00:00'))>datetime.now(timezone.utc),'LOGIN_FRESH_LEASE_REQUIRED')
  return min(65000,85000-state[0]['account_writes'])-ledger[0]['writes']
 need(quota()>=512,'LOGIN_INSUFFICIENT_REAL_CAPACITY')
 ids=[f'gsc:2026-07-{d:02}:{scope}' for d in range(1,27) for scope in ('page','query')]
 def preserved():return {'evidence':query("SELECT count(*) n FROM insight_runs WHERE kind='sheets-source-evidence'",[])[0]['n'],'gsc':query("SELECT count(*) n FROM sync_jobs j JOIN dataset_coverage c ON c.provider=j.provider AND c.day=j.day AND c.scope=j.scope AND c.dataset_id=j.generation WHERE j.id IN ("+','.join('?' for _ in ids)+") AND j.status='done' AND c.complete=1",ids)[0]['n']}
 before=preserved();need(before=={'evidence':1542,'gsc':52},'LOGIN_PRESERVED_DATA_REQUIRED')
 bookmark=api(client,'GET','/d1/database/18f8c90d-4af1-430c-ac86-ddf184c75a0b/time_travel/bookmark');need(bool(re.fullmatch('[a-f0-9-]{20,100}',bookmark.get('bookmark',''))),'LOGIN_NATIVE_BACKUP_REQUIRED')
 assets(BASE)
 folder=ROOT/'.local/login-release-source';subprocess.run(['git','worktree','add','--detach',str(folder),SOURCE],cwd=ROOT,check=True,capture_output=True);(folder/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
 op=ROOT/'.local/login-probe';op.mkdir(parents=True,exist_ok=True);op.chmod(0o700)
 probe_key=secrets.token_hex(32);secret=op/'.dev.vars';secret.write_text('RELEASE_PROBE_KEY='+probe_key+'\n');secret.chmod(0o600)
 variables={b['name']:b['text'] for b in saved[APP]['bindings'] if b.get('type')=='plain_text'}
 cfg={'name':APP,'main':'../../scripts/login-release-probe.ts','compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,'vars':variables,'unsafe':{'bindings':[{'name':'ADMIN_TOKEN','type':'inherit'}]},'services':[{'binding':'LIVE_APP','service':APP}],'d1_databases':[{'binding':'DB','database_name':'mavi-basim-seo','database_id':'18f8c90d-4af1-430c-ac86-ddf184c75a0b'}]}
 (op/'wrangler.jsonc').write_text(json.dumps(cfg));p=None;started=False
 def probe(path):
  req=urllib.request.Request('http://127.0.0.1:8799'+path,headers={'Authorization':'Bearer '+probe_key,'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json'})
  with urllib.request.urlopen(req,timeout=90) as r:return json.loads(r.read(30000))
 try:
  with (op/'runtime.log').open('w') as log:
   p=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--remote','--config',str(op/'wrangler.jsonc'),'--ip','127.0.0.1','--port','8799','--log-level','error'],cwd=ROOT,stdout=log,stderr=log)
   for attempt in range(35):
    need(p.poll() is None,'LOGIN_PROBE_RUNTIME_FAILED')
    try:
     if probe('/health').get('admin_configured'):break
    except (OSError,ValueError):pass
    time.sleep(1)
   else:raise ValueError('LOGIN_PROBE_RUNTIME_TIMEOUT')
   measured=probe('/measure');print(json.dumps({'login_real_cost':measured}),flush=True)
   need(measured.get('status')==200 and measured.get('cookie_issued') and measured.get('metadata_known') and 0<=measured['physical_rows_written']<=measured['ledger_charge']<=64,'LOGIN_REAL_COST_ACCEPTANCE_FAILED')
   need(quota()>=384,'LOGIN_INSUFFICIENT_POSTCHECK_CAPACITY');need(locks()==saved,'LOGIN_CONCURRENT_WORKER_CHANGE')
   ci(sha,'main','push');started=True
   result=subprocess.run(['node',str(ROOT/'scripts/run.mjs'),'wrangler','deploy','--config','deploy/wrangler.drive-independent.jsonc','--keep-vars','--tag',SOURCE,'--message','Bounded login and UI writes; protected data and quotas'],cwd=folder)
   need(result.returncode==0,'LOGIN_DEPLOY_FAILED')
   from production_guard import converged_smoke
   live=converged_smoke(client,SOURCE,OLD_VERSION)
   after=locks();need(all(after[w]==saved[w] for w in saved if w!=APP),'LOGIN_INDEPENDENT_WORKER_CHANGED')
   need(after[APP]['crons']==saved[APP]['crons'] and after[APP]['bindings']==saved[APP]['bindings'],'LOGIN_EXISTING_BINDINGS_OR_CRON_CHANGED')
   accepted=probe('/accept');print(json.dumps({'live_login_acceptance':accepted}),flush=True)
   need(accepted.get('passed'),'LOGIN_LIVE_ACCEPTANCE_FAILED')
   need(preserved()==before,'LOGIN_DATA_CHANGED');assets(SOURCE)
   print(json.dumps({'deployed':True,'source':SOURCE,'version':live['version_id'],'login_works':True,'panel_bootstrap_works':True,'limits_unchanged':True,'data_preserved':before,'drive_and_observer_preserved':True,'actual_login_cost':measured}),flush=True)
 except Exception:
  if started:
   current=locks()[APP]['version']
   if current!=OLD_VERSION:
    need(api(client,'GET','/workers/scripts/'+APP+'/versions/'+current).get('annotations',{}).get('workers/tag')==SOURCE,'LOGIN_FOREIGN_VERSION_NO_ROLLBACK')
    result=subprocess.run(['node','scripts/run.mjs','wrangler','rollback',OLD_VERSION,'--config','deploy/wrangler.drive-independent.jsonc','--message','Login acceptance rollback','--yes'],cwd=ROOT);need(result.returncode==0,'LOGIN_ROLLBACK_FAILED')
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
  raise SystemExit('LOGIN_RELEASE_STOPPED_NO_RETRY:'+code)
