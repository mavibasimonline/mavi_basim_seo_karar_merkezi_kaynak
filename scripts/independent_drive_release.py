"""Controlled independent Drive installation. NO D1 endpoint, token migration or paid activation."""
import base64,hashlib,json,os,re,subprocess,time,urllib.error,urllib.parse,urllib.request
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api,active_version,cron_rows,free_plan
from release_readiness import get_json,REPOSITORY,live_guard_deployment

ROOT=Path(__file__).resolve().parents[1]
LIVE='0e2361cc7360a2a549584948b63e3881dd526aa7'
REVIEW='03b27ececf0af2214ca747f939fdfea33de21435'
SOURCE='3bdf21cb662ad32bc5568165379264aeed26c5c1'
APP='mavi-basim-seo-prod';ARCHIVE='mavi-basim-drive-archive';OBSERVER='mavi-basim-quota-observer'
ORIGIN='https://mavi-basim-seo-prod.mavibasimonline.workers.dev'
ALLOWED={'src/index.ts','src/types.ts','src/drive-broker.ts','src/drive-independent.ts','src/drive-records.ts',
 'public/drive-independent.html','public/drive-independent.js','deploy/wrangler.drive-independent.jsonc','deploy/wrangler.drive-archive.jsonc',
 'tests/drive-independent-routing.test.ts','tests/drive-independent/worker.test.ts','vitest.config.ts','vitest.drive-independent.config.ts','.github/workflows/ci.yml'}

def need(value,code):
 if not value:raise ValueError(code)
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,stderr=subprocess.DEVNULL)
def source_tree(main):
 need(re.fullmatch('[a-f0-9]{40}',SOURCE or ''),'INDEPENDENT_SOURCE_PIN_REQUIRED')
 chain=git('rev-list','--reverse','--parents',LIVE+'..'+SOURCE).decode().splitlines();previous=LIVE
 need(1<=len(chain)<=3,'INDEPENDENT_SOURCE_BASE_CHANGED')
 for line in chain:
  commit,*parents=line.split();need(parents==[previous],'INDEPENDENT_SOURCE_BASE_CHANGED');previous=commit
 need(set(git('diff','--name-only',LIVE,SOURCE).decode().splitlines())==ALLOWED,'INDEPENDENT_SOURCE_SCOPE_CHANGED')
 for path in ALLOWED-{'src/index.ts'}:need(git('show',SOURCE+':'+path)==git('show',main+':'+path),'INDEPENDENT_REVIEWED_FILE_MISMATCH')
 def edits(a,b):return [s for s in git('diff','--unified=0',a,b,'--','src/index.ts').decode().splitlines() if s.startswith(('+','-')) and not s.startswith(('+++','---'))]
 need(edits(REVIEW,main)==edits(LIVE,SOURCE),'INDEPENDENT_REVIEWED_ROUTING_MISMATCH')
 for path in ('src/google.ts','src/security.ts','src/d1-read-budget.ts','src/sync.ts','src/sync-budget.ts','package.json','package-lock.json','deploy/wrangler.production.jsonc'):
  need(git('show',LIVE+':'+path)==git('show',SOURCE+':'+path),'INDEPENDENT_PROTECTED_FILE_CHANGED')

def config_check(app,archive):
 old=json.loads(git('show',LIVE+':deploy/wrangler.production.jsonc'))
 need(app=={**old,'services':[{'binding':'DRIVE_ARCHIVE_SERVICE','service':ARCHIVE}]},'INDEPENDENT_APP_CONFIG_REJECTED')
 expected={'$schema':'../node_modules/wrangler/config-schema.json','name':ARCHIVE,'main':'../src/drive-independent.ts','compatibility_date':'2026-10-01',
  'workers_dev':False,'preview_urls':False,'services':[{'binding':'OAUTH_BROKER','service':APP,'entrypoint':'DriveGoogleBroker'}],
  'vars':{'ARCHIVE_ENABLED':'true'},'durable_objects':{'bindings':[{'name':'DRIVE_ARCHIVE_STORE','class_name':'IndependentDriveStore'}]},
  'migrations':[{'tag':'drive-independent-v1','new_sqlite_classes':['IndependentDriveStore']}],
  'observability':{'enabled':False},'version_metadata':{'binding':'CF_VERSION_METADATA'}}
 need(archive==expected,'INDEPENDENT_PRIVATE_SQLITE_CONFIG_REJECTED')

def locks(client,worker):
 base='/workers/scripts/'+worker
 return {'version':active_version(api(client,'GET',base+'/deployments')),
         'bindings':api(client,'GET',base+'/settings').get('bindings',[]),
         'crons':cron_rows(api(client,'GET',base+'/schedules'))}
def assets(source):
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*a,**k):return None
 opener=urllib.request.build_opener(NoRedirect());paths=git('ls-tree','-r','--name-only',source,'public').decode().splitlines()
 need(0<len(paths)<50,'INDEPENDENT_ASSETS_REQUIRED')
 for path in paths:
  route={'public/index.html':'/','public/drive.html':'/drive','public/drive-independent.html':'/drive-independent'}.get(path,'/'+urllib.parse.quote(path.removeprefix('public/'),safe='/'))
  req=urllib.request.Request(ORIGIN+route+'?independent-source='+source,headers={'User-Agent':'MaviBasimReleaseCheck/1.0','Accept-Encoding':'identity'})
  with opener.open(req,timeout=20) as response:data=response.read(1500001)
  need(data==git('show',source+':'+path),'INDEPENDENT_ASSET_BYTES_MISMATCH')
 return len(paths)

def exact_ci(sha,branch,event):
 rows=get_json('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/ci.yml/runs?head_sha='+sha+'&per_page=30',os.environ.get('GITHUB_TOKEN')).get('workflow_runs',[])
 need(any(r.get('head_sha')==sha and r.get('head_branch')==branch and r.get('event')==event and r.get('status')=='completed' and r.get('conclusion')=='success' for r in rows),'INDEPENDENT_EXACT_CI_REQUIRED')

def deploy(folder,config,enabled=None):
 command=['node',str(ROOT/'scripts/run.mjs'),'wrangler','deploy','--config',str(config),'--keep-vars','--tag',SOURCE,'--message','Independent Drive; protected SEO source '+LIVE]
 if enabled is not None:command+=['--var','ARCHIVE_ENABLED:'+str(enabled).lower()]
 result=subprocess.run(command,cwd=folder)
 need(result.returncode==0,'INDEPENDENT_WORKER_DEPLOY_FAILED')

def install():
 main=os.environ.get('GITHUB_SHA','');need(os.environ.get('GITHUB_REF')=='refs/heads/main' and os.environ.get('GITHUB_REPOSITORY')==REPOSITORY,'INDEPENDENT_MAIN_CONTEXT_REQUIRED')
 need(get_json('https://api.github.com/repos/'+REPOSITORY+'/branches/main',os.environ.get('GITHUB_TOKEN')).get('commit',{}).get('sha')==main,'INDEPENDENT_MAIN_SUPERSEDED')
 exact_ci(main,'main','push');exact_ci(SOURCE,'release/drive-independent-ready','workflow_dispatch');source_tree(main)
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
 free_plan(api(client,'GET','/subscriptions'))
 inventory=api(client,'GET','/workers/scripts');need(isinstance(inventory,list) and len(inventory)<100,'INDEPENDENT_FREE_WORKER_LIMIT_REQUIRED')
 need(not any(w.get('id')==ARCHIVE for w in inventory),'INDEPENDENT_EXISTING_ARCHIVE_REQUIRES_REVIEW')
 saved=locks(client,APP);observer=locks(client,OBSERVER);live=live_guard_deployment()
 need(live and live['commit']==LIVE and live['version_id']==saved['version']==os.environ.get('EXPECTED_PREVIOUS_VERSION'),'INDEPENDENT_LIVE_BASE_CHANGED')
 need(saved['crons']==['*/15 * * * *'] and observer['crons']==['2,17,32,47 * * * *'],'INDEPENDENT_PROTECTED_CRON_CHANGED')
 before_files=assets(LIVE)
 folder=ROOT/'.local/independent-source';need(not folder.exists(),'INDEPENDENT_STAGE_EXISTS')
 subprocess.run(['git','worktree','add','--detach',str(folder),SOURCE],cwd=ROOT,check=True,capture_output=True);(folder/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
 appcfg=folder/'deploy/wrangler.drive-independent.jsonc';archivecfg=folder/'deploy/wrangler.drive-archive.jsonc'
 config_check(json.loads(appcfg.read_text()),json.loads(archivecfg.read_text()))
 bootstrap=ROOT/'.local/independent-bootstrap';bootstrap.mkdir(exist_ok=True)
 dormant=json.loads(archivecfg.read_text())
 dormant.update(main=str(folder/'src/drive-independent.ts'),services=[{'binding':'OAUTH_BROKER','service':APP}],vars={'ARCHIVE_ENABLED':'false'})
 (bootstrap/'wrangler.jsonc').write_text(json.dumps(dormant))
 started=False;archive_full=False
 try:
  # A private dormant target lets the existing app bind the new service safely.
  # No old token/key is read; this brand-new key exists only in Actions memory
  # for this API call and then in Cloudflare's server-side secret binding.
  deploy(ROOT,bootstrap/'wrangler.jsonc',False)
  api(client,'PUT','/workers/scripts/'+ARCHIVE+'/secrets',{'name':'ARCHIVE_ENCRYPTION_KEY','type':'secret_text','text':base64.b64encode(os.urandom(32)).decode()})
  need(locks(client,APP)==saved and locks(client,OBSERVER)==observer,'INDEPENDENT_CONCURRENT_WORKER_CHANGE')
  started=True;deploy(folder,appcfg)
  deploy(folder,archivecfg,True);archive_full=True
  from production_guard import converged_smoke
  actual=converged_smoke(client,SOURCE,saved['version'])
  after=locks(client,APP);need(after['crons']==saved['crons'] and locks(client,OBSERVER)==observer,'INDEPENDENT_PROTECTED_WORKER_CHANGED')
  old={b['name']:b for b in saved['bindings']};new={b['name']:b for b in after['bindings']}
  need(set(new)==set(old)|{'DRIVE_ARCHIVE_SERVICE'} and all(new[k]==v for k,v in old.items()),'INDEPENDENT_EXISTING_BINDING_CHANGED')
  need(new['DRIVE_ARCHIVE_SERVICE'].get('service')==ARCHIVE,'INDEPENDENT_SERVICE_TARGET_CHANGED')
  settings=api(client,'GET','/workers/scripts/'+ARCHIVE+'/settings');bindings=settings.get('bindings',[])
  need({b.get('name') for b in bindings}=={'ARCHIVE_ENCRYPTION_KEY','ARCHIVE_ENABLED','DRIVE_ARCHIVE_STORE','OAUTH_BROKER','CF_VERSION_METADATA'},'INDEPENDENT_ARCHIVE_BINDING_REJECTED')
  need(any(b.get('name')=='ARCHIVE_ENABLED' and b.get('text')=='true' for b in bindings),'INDEPENDENT_ARCHIVE_NOT_ENABLED')
  need(any(b.get('name')=='DRIVE_ARCHIVE_STORE' and b.get('type')=='durable_object_namespace' for b in bindings),'INDEPENDENT_SQLITE_STORE_REQUIRED')
  need(cron_rows(api(client,'GET','/workers/scripts/'+ARCHIVE+'/schedules'))==[],'INDEPENDENT_UNREVIEWED_ARCHIVE_CRON')
  visibility=api(client,'GET','/workers/scripts/'+ARCHIVE+'/subdomain');need(visibility.get('enabled') is False and visibility.get('previews_enabled') is False,'INDEPENDENT_PUBLIC_ARCHIVE_FORBIDDEN')
  readiness=get_json(ORIGIN+'/api/drive-independent/health')
  need(readiness=={'ok':True,'storage':'durable-object-sqlite','d1_requests':0,'separate_oauth':True},'INDEPENDENT_REAL_STORE_OR_BROKER_UNAVAILABLE')
  for path,method in [('/api/drive-independent/status','GET'),('/api/drive-independent/start','POST')]:
   request=urllib.request.Request(ORIGIN+path,method=method,data=b'{}' if method=='POST' else None,headers={'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json','Content-Type':'application/json','Origin':ORIGIN})
   try:urllib.request.urlopen(request,timeout=15).close();raise ValueError('INDEPENDENT_OWNER_BOUNDARY_REQUIRED')
   except urllib.error.HTTPError as error:
    need(error.code==401 and json.loads(error.read(4097))=={'error':'Giriş yapmanız gerekiyor.'},'INDEPENDENT_OWNER_BOUNDARY_REQUIRED')
  verified=assets(SOURCE)
  return {'status':'ready_for_google_consent','source':SOURCE,'deployment':actual,'verified_static_files':verified,'previous_static_files':before_files,
          'd1_requests':0,'old_tokens_read':False,'old_tokens_changed':False,'observer_preserved':True,'cron_preserved':True,'free_plan_verified':True,
          'oauth_url':ORIGIN+'/drive-independent','records_written':0,'automatic_start_after_consent':True,'daily_durable_alarm':True}
 except Exception:
  if archive_full:
   try:deploy(folder,archivecfg,False)
   except Exception:print('INDEPENDENT_ARCHIVE_HOLD_REQUIRES_REVIEW',flush=True)
  if started:
   now=locks(client,APP)
   if now['version']!=saved['version']:
    metadata=api(client,'GET','/workers/scripts/'+APP+'/versions/'+now['version'])
    need(metadata.get('annotations',{}).get('workers/tag')==SOURCE,'INDEPENDENT_FOREIGN_DEPLOYMENT_NO_ROLLBACK')
    result=subprocess.run(['node','scripts/run.mjs','wrangler','rollback',saved['version'],'--config','deploy/wrangler.production.jsonc','--message','Independent Drive acceptance rollback','--yes'],cwd=ROOT)
    need(result.returncode==0,'INDEPENDENT_APP_ROLLBACK_FAILED')
   need(locks(client,APP)['crons']==saved['crons'] and locks(client,OBSERVER)==observer,'INDEPENDENT_ROLLBACK_LOCK_FAILED')
  raise

if __name__=='__main__':
 try:print(json.dumps(install(),ensure_ascii=False))
 except Exception as error:
  code=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z0-9_]+',str(error)) else type(error).__name__
  raise SystemExit('INDEPENDENT_DRIVE_STOPPED_NO_RETRY:'+code)
