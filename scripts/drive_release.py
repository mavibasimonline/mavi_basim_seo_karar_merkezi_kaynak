"""Additional locks for the reviewed Drive-only release; never changes resources."""
import hashlib,json,os,sys,urllib.error,urllib.request
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api,active_version,cron_rows,free_plan
from scoped_release import DRIVE_SOURCE,PERFORMANCE_SOURCE,APP,git,require
from release_readiness import live_guard_deployment

ROOT=Path(__file__).resolve().parents[1]
SAVED=ROOT/'.local/drive-release-before.json'

def observer_lock(client):
 base='/workers/scripts/mavi-basim-quota-observer'
 return {'version':active_version(api(client,'GET',base+'/deployments')),
         'crons':cron_rows(api(client,'GET',base+'/schedules')),
         'settings_sha256':hashlib.sha256(json.dumps(api(client,'GET',base+'/settings'),sort_keys=True).encode()).hexdigest()}

def verify_source():
 # The deployed app keeps every existing SEO/UI/limit file byte-for-byte.
 require(os.environ.get('RELEASE_SOURCE_COMMIT')==DRIVE_SOURCE,'DRIVE_SOURCE_REQUIRED')
 for path in ('src/d1-read-budget.ts','src/security.ts','src/types.ts','src/sync-budget.ts','src/performance.ts','src/read-cache.ts','src/sync.ts','deploy/wrangler.production.jsonc','package.json','package-lock.json'):
  require(git(ROOT,'show',PERFORMANCE_SOURCE+':'+path)==git(ROOT,'show',DRIVE_SOURCE+':'+path),'DRIVE_PROTECTED_FILE_DRIFT')

def preflight(client):
 verify_source();free_plan(api(client,'GET','/subscriptions'))
 live=live_guard_deployment();require(live and live['commit']==PERFORMANCE_SOURCE,'DRIVE_LIVE_BASE_CHANGED')
 observer=observer_lock(client)
 require(observer['crons']==['2,17,32,47 * * * *'],'DRIVE_OBSERVER_CRON_CHANGED')
 crons=cron_rows(api(client,'GET','/workers/scripts/mavi-basim-seo-prod/schedules'))
 require(crons==['*/15 * * * *'],'DRIVE_APP_CRON_CHANGED')
 SAVED.parent.mkdir(exist_ok=True);SAVED.write_text(json.dumps({'observer':observer,'crons':crons}))
 return {'free_plan_verified':True,'observer_and_app_cron_locked':True,'oauth_tokens_read':False,'r2_enabled':False}

def verify_owner_boundary(opener=None):
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=opener or urllib.request.build_opener(NoRedirect())
 for path in ('/api/drive/status','/api/oauth/google/start?purpose=drive'):
  post='start?' in path
  request=urllib.request.Request(APP+path,method='POST' if post else 'GET',data=b'{}' if post else None,
    headers={'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json','Origin':APP,'Content-Type':'application/json'})
  try:
   with opener.open(request,timeout=15) as response:response.read(4097)
   raise ValueError('DRIVE_OWNER_SESSION_REQUIRED')
  except urllib.error.HTTPError as error:
   with error:raw=error.read(4097)
   require(error.code==401,'DRIVE_OWNER_HTTP_'+str(error.code))
   require(len(raw)<=4096,'DRIVE_OWNER_RESPONSE_LIMIT')
   try:body=json.loads(raw)
   except ValueError:raise ValueError('DRIVE_OWNER_RESPONSE_INVALID') from None
   require(body=={'error':'Giriş yapmanız gerekiyor.'},'DRIVE_OWNER_RESPONSE_INVALID')
 return True

def accepted(client):
 verify_source();saved=json.loads(SAVED.read_text())
 require(observer_lock(client)==saved['observer'],'DRIVE_OBSERVER_CHANGED')
 require(cron_rows(api(client,'GET','/workers/scripts/mavi-basim-seo-prod/schedules'))==saved['crons'],'DRIVE_APP_CRON_CHANGED')
 live=live_guard_deployment();require(live and live['commit']==DRIVE_SOURCE,'DRIVE_LIVE_COMMIT_MISMATCH')
 verify_owner_boundary()
 return {'deployment':live,'observer_preserved':True,'existing_cron_preserved':True,'drive_screen_deployed':True,'owner_session_required':True,'actual_archive_pending_google_consent':True}

if __name__=='__main__':
 try:
  client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
  mode=sys.argv[1]
  if mode=='preflight':result=preflight(client)
  elif mode=='accept':result=accepted(client)
  else:raise ValueError('DRIVE_RELEASE_MODE_REQUIRED')
  print(json.dumps(result))
 except Exception as error:
  code=str(error) if isinstance(error,ValueError) and __import__('re').fullmatch('[A-Z0-9_]+',str(error)) else type(error).__name__
  raise SystemExit('DRIVE_RELEASE_FAILED:'+code)
