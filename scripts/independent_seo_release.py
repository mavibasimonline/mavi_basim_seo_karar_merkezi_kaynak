"""One-time guarded D1-free SEO layer deployment. Never migrates/deletes D1 or Drive archives."""
import json,os,re,subprocess,urllib.request,urllib.error,time,secrets
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api,active_version,cron_rows,free_plan
from release_readiness import get_json,REPOSITORY
ROOT=Path(__file__).resolve().parents[1]
APP='mavi-basim-seo-prod'
ARCHIVE='mavi-basim-drive-archive'
TITLE='release: activate guarded private GSC durable collector'
EXPECTED={
 'scripts/independent_seo_release.py',
 'tests/test_independent_seo_release.py',
 '.github/workflows/independent-seo-release.yml',
 'scripts/independent-acceptance-probe.ts',
  'tests/independent-acceptance-probe.test.ts',
}

def need(condition,code):
 if not condition:raise ValueError(code)
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,stderr=subprocess.DEVNULL).decode().strip()
def url_json(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'MaviBasimD1IndependentRelease/1.0','Accept':'application/json'}),timeout=20) as response:
  return json.loads(response.read(32768))
def http(url):
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'MaviBasimD1IndependentRelease/1.0'}),timeout=20) as response:return response.status,response.read(500000)
 except urllib.error.HTTPError as error:return error.code,error.read(32768)
def snapshot(client,name):
 script='/workers/scripts/'+name
 return {
  'version':active_version(api(client,'GET',script+'/deployments')),
  'crons':cron_rows(api(client,'GET',script+'/schedules')),
  'bindings':sorted(api(client,'GET',script+'/settings').get('bindings',[]),key=lambda b:b['name'])
 }
def deploy(config,sha):
 result=subprocess.run(['node','scripts/run.mjs','wrangler','deploy','--config',config,'--keep-vars','--tag',sha,'--message','D1-free verified Sheets SEO panel; original databases retained'],cwd=ROOT)
 need(result.returncode==0,'INDEPENDENT_WRANGLER_DEPLOY_FAILED')
def rollback(config,version):
 result=subprocess.run(['node','scripts/run.mjs','wrangler','rollback',version,'--config',config,'--message','D1-free SEO acceptance rollback','--yes'],cwd=ROOT)
 need(result.returncode==0,'INDEPENDENT_ROLLBACK_FAILED')
def acceptance_proof(proof):
 need(isinstance(proof,dict) and proof.get('ok') is True
      and type(proof.get('d1_requests')) is int and proof['d1_requests']==0
      and type(proof.get('question_d1_requests')) is int and proof['question_d1_requests']==0
      and isinstance(proof.get('products'),int) and not isinstance(proof.get('products'),bool)
      and proof['products']>0 and proof.get('stale') is False
      and proof.get('gsc_private_service') is True
      and type(proof.get('gsc_d1_requests')) is int and proof['gsc_d1_requests']==0
      and isinstance(proof.get('source_hash'),str) and re.fullmatch('[a-f0-9]{64}',proof['source_hash'])
      and isinstance(proof.get('month'),str) and re.fullmatch(r'20\d{2}-(0[1-9]|1[0-2])',proof['month']),
      'INDEPENDENT_REAL_DATA_ACCEPTANCE_FAILED')
 return proof

def safe_probe_code(body):
 try:
  code=json.loads(body).get('code','')
  if isinstance(code,str) and re.fullmatch(r'(INDEPENDENT_|SOURCE_|SHEETS_|ARCHIVE_|VERIFIED_)[A-Z0-9_]{1,100}',code):return code
 except (ValueError,AttributeError,TypeError):pass
 return 'INDEPENDENT_REMOTE_PROBE_HTTP_ERROR'

def probe_request(key):
 # Same declared client as the existing working remote-release probes.
 # Authentication stays mandatory; Python's default UA is rejected at the edge.
 return urllib.request.Request('http://127.0.0.1:8801/',headers={
  'Authorization':'Bearer '+key,'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json'})

def app_config(bindings):
 services={b['name']:b.get('service') for b in bindings if b.get('type')=='service'}
 need(services in ({'DRIVE_ARCHIVE_SERVICE':ARCHIVE},
                 {'DRIVE_ARCHIVE_SERVICE':ARCHIVE,'MONTHLY_ANALYSES':'mavi-basim-monthly-store'}),
      'INDEPENDENT_SERVICE_BINDINGS_UNREVIEWED')
 return 'deploy/wrangler.monthly-app.jsonc' if 'MONTHLY_ANALYSES' in services else 'deploy/wrangler.drive-independent.jsonc'

def run():
 sha=os.environ.get('GITHUB_SHA','')
 need(os.environ.get('GITHUB_REF')=='refs/heads/main' and os.environ.get('GITHUB_REPOSITORY')==REPOSITORY,'INDEPENDENT_MAIN_REQUIRED')
 need(re.fullmatch('[a-f0-9]{40}',sha) and git('rev-parse','HEAD')==sha,'INDEPENDENT_HEAD_MISMATCH')
 need(git('log','-1','--format=%s')==TITLE,'INDEPENDENT_ONE_TIME_TAG_REQUIRED')
 need(get_json('https://api.github.com/repos/'+REPOSITORY+'/branches/main',os.environ.get('GITHUB_TOKEN')).get('commit',{}).get('sha')==sha,'INDEPENDENT_MAIN_SUPERSEDED')
 changed=set(git('diff','--name-only','HEAD^','HEAD').splitlines())
 need(changed==EXPECTED,'INDEPENDENT_UNREVIEWED_FILES')
 need(git('rev-parse','HEAD^')=='4b04a4ebdb4ad037a6c9566c489d8f73c5969786','INDEPENDENT_UNREVIEWED_BASE')
 # Preserve the reviewed Cron/DO source set exactly as merged and CI verified.
 need("independentRefreshDue(time)" in (ROOT/'src/index.ts').read_text()
      and "private async independentSnapshot(maxAgeMs=24*3600000)" in (ROOT/'src/drive-independent.ts').read_text()
      and "/api/internal/independent-refresh" in (ROOT/'src/drive-independent.ts').read_text()
      and (ROOT/'src/independent-refresh.ts').is_file(),'INDEPENDENT_REFRESH_SOURCE_MISSING')
 need('gsc:oauth' in (ROOT/'src/drive-independent.ts').read_text()
      and '/api/internal/gsc-tick' in (ROOT/'src/drive-independent.ts').read_text()
      and '/refresh-gsc' in (ROOT/'src/drive-broker.ts').read_text()
      and 'independentGscCron' in (ROOT/'src/index.ts').read_text()
      and (ROOT/'src/independent-gsc.ts').is_file()
      and (ROOT/'src/independent-gsc-report.ts').is_file(),'INDEPENDENT_GSC_SOURCE_MISSING')
 rows=get_json('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/ci.yml/runs?head_sha='+sha+'&per_page=30',os.environ.get('GITHUB_TOKEN')).get('workflow_runs',[])
 need(any(r.get('head_sha')==sha and r.get('head_branch')=='main' and r.get('event')=='push' and r.get('conclusion')=='success' for r in rows),'INDEPENDENT_GREEN_MAIN_CI_REQUIRED')
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
 free_plan(api(client,'GET','/subscriptions'))
 workers=api(client,'GET','/workers/scripts')
 need(isinstance(workers,list) and {APP,ARCHIVE}.issubset({w.get('id') for w in workers}),'INDEPENDENT_EXISTING_FREE_WORKERS_REQUIRED')
 existing={APP:snapshot(client,APP),ARCHIVE:snapshot(client,ARCHIVE)}
 need(existing[APP]['version'] and existing[ARCHIVE]['version'],'INDEPENDENT_OLD_VERSIONS_REQUIRED')
 main_bindings={x['name']:x for x in existing[APP]['bindings']}
 archive_bindings={x['name']:x for x in existing[ARCHIVE]['bindings']}
 main_config=app_config(existing[APP]['bindings'])
 need('DB' in main_bindings and main_bindings['DB'].get('id') in (None,'18f8c90d-4af1-430c-ac86-ddf184c75a0b'),'INDEPENDENT_D1_BINDING_MISMATCH')
 need(main_bindings.get('DRIVE_ARCHIVE_SERVICE',{}).get('service')==ARCHIVE,'INDEPENDENT_PRIVATE_ARCHIVE_LINK_REQUIRED')
 need(archive_bindings.get('DRIVE_ARCHIVE_STORE',{}).get('class_name')=='IndependentDriveStore','INDEPENDENT_ARCHIVE_STORAGE_REQUIRED')
 original_health=url_json('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/health')
 need(original_health.get('ok') is True,'INDEPENDENT_OLD_HEALTH_FAILED')
 old_tag=original_health.get('deployment',{}).get('commit')
 need(re.fullmatch('[a-f0-9]{40}',old_tag or ''),'INDEPENDENT_OLD_SOURCE_UNVERIFIED')
 # Prove the fixed live Sheets in actual local SQLite DO before ANY deployment.
 from independent_real_data_acceptance import run as real_data_acceptance
 real_data_acceptance()
 changed_workers=[]
 try:
  changed_workers.append(ARCHIVE);deploy('deploy/wrangler.drive-archive.jsonc',sha)
  after_archive=snapshot(client,ARCHIVE)
  need(after_archive['bindings']==existing[ARCHIVE]['bindings'] and after_archive['crons']==existing[ARCHIVE]['crons'],'INDEPENDENT_ARCHIVE_BINDINGS_CHANGED')
  need(api(client,'GET','/workers/scripts/'+ARCHIVE+'/subdomain').get('enabled') is False,'INDEPENDENT_ARCHIVE_PUBLIC_EXPOSURE')
  # Remote preview is private to the account and proves real Sheets + private DO
  # before touching the live SEO application.
  folder=ROOT/'.local/independent-acceptance'
  folder.mkdir(parents=True,exist_ok=True)
  key=secrets.token_hex(32)
  config={'name':APP,'main':str(ROOT/'scripts/independent-acceptance-probe.ts'),
          'compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,
          'vars':{'PROBE_KEY':key},
          'services':[{'binding':'ARCHIVE','service':ARCHIVE}]}
  probe_config=folder/'wrangler.jsonc';probe_config.write_text(json.dumps(config))
  preview=None
  try:
   with (folder/'runtime.log').open('w') as logs:
    preview=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--remote','--config',str(probe_config),'--ip','127.0.0.1','--port','8801','--log-level','error'],cwd=ROOT,stdout=logs,stderr=logs)
    proof=None;deadline=time.monotonic()+120
    for attempt in range(40):
     if time.monotonic()>=deadline:break
     need(preview.poll() is None,'INDEPENDENT_REMOTE_PROBE_CRASHED')
     req=probe_request(key)
     try:
      with urllib.request.urlopen(req,timeout=30) as res:proof=json.loads(res.read(30000));break
     except urllib.error.HTTPError as error:
      code=safe_probe_code(error.read(32768))
      # Data/validation errors are terminal; only startup/transport errors retry.
      if code!='INDEPENDENT_REMOTE_PROBE_HTTP_ERROR':raise ValueError(code) from None
      if error.code in (400,401,403):raise ValueError('INDEPENDENT_REMOTE_PROBE_HTTP_'+str(error.code)) from None
      time.sleep(1)
     except (urllib.error.URLError,TimeoutError):time.sleep(1)
    need(proof is not None,'INDEPENDENT_REMOTE_PROBE_STARTUP_TIMEOUT')
    acceptance_proof(proof)
    print(json.dumps({'verified_private_archive':True,'month':proof['month'],'products':proof['products'],'d1_requests':0}),flush=True)
  finally:
   if preview is not None:
    preview.terminate()
    try:preview.wait(timeout=6)
    except subprocess.TimeoutExpired:preview.kill()
  changed_workers.append(APP);deploy(main_config,sha)
  after_main=snapshot(client,APP)
  need(after_main['crons']==existing[APP]['crons'] and after_main['bindings']==existing[APP]['bindings'],'INDEPENDENT_APP_BINDINGS_CHANGED')
  # Do not add a new DB instance, replace existing OAuth secrets, or expose the private archive worker.
  for attempt in range(7):
   try:
    health=url_json('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/health')
    if health.get('deployment',{}).get('commit')==sha:break
   except (ValueError,TimeoutError,urllib.error.URLError):pass
   time.sleep(2)
  else:raise ValueError('INDEPENDENT_RELEASE_NOT_CONVERGED')
  base='https://mavi-basim-seo-prod.mavibasimonline.workers.dev'
  html_status,body=http(base+'/independent-seo.html')
  need(html_status==200 and b'D1' in body and b'Google Sheets' in body,'INDEPENDENT_UI_NOT_AVAILABLE')
  for endpoint in ('/api/independent/status','/api/independent/report'):
   code,content=http(base+endpoint)
   need(code==401 and b'Giri' in content,'INDEPENDENT_PUBLIC_DATA_EXPOSED')
  need(snapshot(client,APP)['crons']==existing[APP]['crons'],'INDEPENDENT_CRON_CHANGED')
  print(json.dumps({'deployed':True,'source':sha,'d1_data_mutated':False,'new_billed_resources':False,'backup_mutated':False,'new_layer':'D1-free Sheets/DO','login_uses_d1':False,'authenticated_data_acceptance':'requires existing admin session','public_endpoints_closed':True,'existing_site_changed':False}),flush=True)
 except Exception:
  for worker,config in ((APP,main_config),(ARCHIVE,'deploy/wrangler.drive-archive.jsonc')):
   if worker in changed_workers:
    try:
     rollback(config,existing[worker]['version'])
     need(snapshot(client,worker)==existing[worker],'INDEPENDENT_ROLLBACK_VERIFICATION_FAILED')
    except Exception:print('INDEPENDENT_REVIEW_REQUIRED_ROLLBACK_'+worker,flush=True)
  raise
if __name__=='__main__':
 try:run()
 except Exception as e:
  print('INDEPENDENT_RELEASE_STOPPED:'+str(e)[:140],flush=True)
  raise SystemExit(1)
