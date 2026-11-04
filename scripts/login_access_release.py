"""Publish only the sign-in UI/API fix. No collector deploy, D1 access or secret export."""
import json,os,re,secrets,subprocess,time,urllib.request,urllib.error
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api,free_plan
from release_readiness import get_json,REPOSITORY
from independent_seo_release import APP,ARCHIVE,ROOT,snapshot,app_config,deploy,rollback,verify_active_source,http,url_json,need,git
BASE='a8731f8ec7033a9d81dcbdc3a4fd6001d04c44f2'
TITLE='release: verified GSC history bootstrap 20261104'
EXPECTED={'.github/workflows/independent-seo-release.yml','public/app.js','public/independent-seo.html','src/index.ts','tests/independent-session.test.ts','tests/browser/independent-seo.spec.ts','scripts/login-access-probe.ts','scripts/login_access_release.py'}
PROTECTED=('src/independent-session.ts','src/security.ts','src/d1-read-budget.ts','src/drive-independent.ts','src/drive-broker.ts','src/independent-gsc.ts','src/independent-gsc-bridge.ts','src/independent-gsc-bootstrap.ts','src/independent-ga4.ts','src/independent-context-bridge.ts','deploy/wrangler.monthly-app.jsonc','deploy/wrangler.drive-archive.jsonc')

def accept(proof):
 fields={'passed','secure_cookie','session_verified','landing','gsc_readable','analysis_readable','logout_verified','unauthenticated_status','legacy_data_requests','d1_requests'}
 need(isinstance(proof,dict) and set(proof)==fields,'LOGIN_ACCESS_PRIVATE_FIELD_REJECTED')
 need(all(proof[k] is True for k in ('passed','secure_cookie','session_verified','gsc_readable','analysis_readable','logout_verified')),'LOGIN_ACCESS_ACCEPTANCE_FAILED')
 need(proof['landing']=='/independent-seo.html' and proof['unauthenticated_status']==401 and type(proof['d1_requests']) is int and proof['d1_requests']==0 and type(proof['legacy_data_requests']) is int and proof['legacy_data_requests']==0,'LOGIN_ACCESS_ACCEPTANCE_FAILED')
 return proof

def live_acceptance():
 folder=ROOT/'.local/login-access';folder.mkdir(parents=True,exist_ok=True);folder.chmod(0o700)
 key=secrets.token_hex(32);secret=folder/'.dev.vars';secret.write_text('PROBE_KEY='+key+'\n');secret.chmod(0o600)
 config=folder/'wrangler.jsonc';config.write_text(json.dumps({'name':APP,'main':str(ROOT/'scripts/login-access-probe.ts'),'compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,'unsafe':{'bindings':[{'name':'ADMIN_TOKEN','type':'inherit'}]},'services':[{'binding':'LIVE_APP','service':APP,'environment':'production'}]}));config.chmod(0o600)
 preview=None
 try:
  with (folder/'runtime.log').open('w') as logs:
   preview=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--remote','--config',str(config),'--ip','127.0.0.1','--port','8805','--log-level','error'],cwd=ROOT,stdout=logs,stderr=logs)
   def exchange(path,method='GET'):
    request=urllib.request.Request('http://127.0.0.1:8805'+path,method=method,data=b'{}' if method=='POST' else None,headers={'Authorization':'Bearer '+key,'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json','Content-Type':'application/json'})
    try:
     with urllib.request.urlopen(request,timeout=45) as response:return json.loads(response.read(8192))
    except urllib.error.HTTPError:raise ValueError('LOGIN_ACCESS_PRIVATE_PROBE_FAILED') from None
   for _ in range(40):
    need(preview.poll() is None,'LOGIN_ACCESS_PREVIEW_CRASHED')
    try:
     ready=exchange('/health')
     if ready.get('ready') and ready.get('admin_configured'):break
    except (OSError,ValueError):pass
    time.sleep(1)
   else:raise ValueError('LOGIN_ACCESS_PREVIEW_NOT_READY')
   # A successful sign-in is attempted once. An unconfirmed mutation is never retried.
   return accept(exchange('/accept','POST'))
 finally:
  if preview is not None:
   preview.terminate()
   try:preview.wait(timeout=6)
   except subprocess.TimeoutExpired:preview.kill()
  config.unlink(missing_ok=True);secret.unlink(missing_ok=True)

def run():
 sha=os.environ.get('GITHUB_SHA','')
 need(os.environ.get('GITHUB_REF')=='refs/heads/main' and os.environ.get('GITHUB_REPOSITORY')==REPOSITORY,'LOGIN_ACCESS_MAIN_REQUIRED')
 need(re.fullmatch('[a-f0-9]{40}',sha) and git('rev-parse','HEAD')==sha and git('log','-1','--format=%s')==TITLE,'LOGIN_ACCESS_SOURCE_REQUIRED')
 need(git('rev-parse','HEAD^')==BASE and set(git('diff','--name-only','HEAD^','HEAD').splitlines())==EXPECTED,'LOGIN_ACCESS_REVIEWED_SCOPE_REQUIRED')
 for path in PROTECTED:need(subprocess.check_output(['git','show',BASE+':'+path],cwd=ROOT)==(ROOT/path).read_bytes(),'LOGIN_ACCESS_PROTECTED_SOURCE_CHANGED')
 old_index=subprocess.check_output(['git','show',BASE+':src/index.ts'],cwd=ROOT).decode()
 need(old_index.split('  async scheduled(',1)[1]==(ROOT/'src/index.ts').read_text().split('  async scheduled(',1)[1],'LOGIN_ACCESS_CRON_SOURCE_CHANGED')
 need(get_json('https://api.github.com/repos/'+REPOSITORY+'/branches/main',os.environ.get('GITHUB_TOKEN')).get('commit',{}).get('sha')==sha,'LOGIN_ACCESS_MAIN_SUPERSEDED')
 runs=get_json('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/ci.yml/runs?head_sha='+sha+'&per_page=20',os.environ.get('GITHUB_TOKEN')).get('workflow_runs',[])
 need(any(r.get('head_sha')==sha and r.get('head_branch')=='main' and r.get('event')=='push' and r.get('conclusion')=='success' for r in runs),'LOGIN_ACCESS_GREEN_CI_REQUIRED')
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
 free_plan(api(client,'GET','/subscriptions'))
 before={w:snapshot(client,w) for w in (APP,ARCHIVE)};config=app_config(before[APP]['bindings'])
 need(before[APP]['crons']==['*/15 * * * *'],'LOGIN_ACCESS_CRON_DRIFT')
 need(url_json('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/health').get('deployment',{}).get('commit')==BASE,'LOGIN_ACCESS_LIVE_SOURCE_CHANGED')
 deployed=False
 try:
  deployed=True;deploy(config,sha);after=snapshot(client,APP);verify_active_source(client,APP,after['version'],sha)
  need(after['bindings']==before[APP]['bindings'] and after['crons']==before[APP]['crons'],'LOGIN_ACCESS_BINDINGS_CHANGED')
  need(snapshot(client,ARCHIVE)==before[ARCHIVE],'LOGIN_ACCESS_ARCHIVE_CHANGED')
  base='https://mavi-basim-seo-prod.mavibasimonline.workers.dev'
  for _ in range(7):
   health=url_json(base+'/api/health')
   if health.get('deployment',{}).get('commit')==sha and health['deployment'].get('version_id')==after['version']:break
   time.sleep(2)
  else:raise ValueError('LOGIN_ACCESS_HTTP_SOURCE_MISMATCH')
  for path in ('index.html','app.js','independent-seo.html'):
   status,data=http(base+'/'+path);need(status==200 and data==(ROOT/'public'/path).read_bytes(),'LOGIN_ACCESS_ASSET_MISMATCH')
  status,_=http(base+'/api/session');need(status==401,'LOGIN_ACCESS_PUBLIC_SESSION_EXPOSED')
  proof=live_acceptance()
  need(snapshot(client,APP)==after and snapshot(client,ARCHIVE)==before[ARCHIVE],'LOGIN_ACCESS_PRODUCTION_DRIFT')
  print(json.dumps({'deployed':True,'source':sha,'version':after['version'],'live_login':proof,'archive_unchanged':True,'cron_unchanged':True,'d1_requests':0,'new_billed_resources':False,'site_changed':False}),flush=True)
 except Exception:
  if deployed:
   rollback(config,before[APP]['version']);need(snapshot(client,APP)==before[APP],'LOGIN_ACCESS_ROLLBACK_FAILED')
  raise
if __name__=='__main__':
 try:run()
 except Exception as error:
  code=str(error);print('LOGIN_ACCESS_RELEASE_STOPPED:'+(code if re.fullmatch('[A-Z0-9_]{1,100}',code) else 'LOGIN_ACCESS_UNAVAILABLE'),flush=True);raise SystemExit(1)
