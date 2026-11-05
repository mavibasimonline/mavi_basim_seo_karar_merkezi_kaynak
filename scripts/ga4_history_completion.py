"""One-time, source-limited GA4 June-August completion through a private Cloudflare service binding."""
import json,os,secrets,subprocess,time,urllib.request,urllib.error
from pathlib import Path
from independent_seo_release import ROOT,APP,ARCHIVE,url_json,need,git
from release_readiness import get_json,REPOSITORY
TARGET='532525867'
MONTHS=('2026-06','2026-07','2026-08')
def run():
 sha=os.environ.get('GITHUB_SHA','')
 need(os.environ.get('GITHUB_REF')=='refs/heads/main' and sha==git('rev-parse','HEAD'),'GA4_ARCHIVE_MAIN_REQUIRED')
 need(get_json('https://api.github.com/repos/'+REPOSITORY+'/branches/main',os.environ.get('GITHUB_TOKEN')).get('commit',{}).get('sha')==sha,'GA4_ARCHIVE_MAIN_CHANGED')
 need(url_json('https://mavi-basim-seo-prod.mavibasimonline.workers.dev/api/health').get('deployment',{}).get('commit')==sha,'GA4_ARCHIVE_DEPLOYMENT_NOT_READY')
 folder=ROOT/'.local/ga4-history-completion';folder.mkdir(parents=True,exist_ok=True);folder.chmod(0o700)
 key=secrets.token_hex(32);secret=folder/'.dev.vars';secret.write_text('PROBE_KEY='+key+'\n');secret.chmod(0o600)
 cfg=folder/'wrangler.jsonc';cfg.write_text(json.dumps({'name':APP,'main':str(ROOT/'scripts/ga4-history-probe.ts'),'compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,'services':[{'binding':'ARCHIVE','service':ARCHIVE,'environment':'production'}]}));cfg.chmod(0o600)
 preview=None
 def exchange(path,method='GET'):
  req=urllib.request.Request('http://127.0.0.1:8806'+path,method=method,data=b'{}' if method=='POST' else None,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','Accept':'application/json'})
  try:
   with urllib.request.urlopen(req,timeout=50) as response:return json.loads(response.read(4096))
  except urllib.error.HTTPError as error:
   try:code=json.loads(error.read(1000)).get('code')
   except (ValueError,AttributeError):code=None
   raise ValueError(code if isinstance(code,str) and code.startswith('GA4_ARCHIVE_') else 'GA4_ARCHIVE_PROBE_UNAVAILABLE') from None
 try:
  with (folder/'runtime.log').open('w') as logfile:
   preview=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--remote','--config',str(cfg),'--ip','127.0.0.1','--port','8806','--log-level','error'],cwd=ROOT,stdout=logfile,stderr=logfile)
   for _ in range(50):
    need(preview.poll() is None,'GA4_ARCHIVE_PREVIEW_CRASHED')
    try:
     if exchange('/ready').get('ready'):break
    except (OSError,ValueError):pass
    time.sleep(1)
   else:raise ValueError('GA4_ARCHIVE_PREVIEW_UNAVAILABLE')
   state=exchange('/status')
   print(json.dumps({'ga4_connection':state}),flush=True)
   need(state.get('connected') and state.get('property_verified') and not state.get('reconnect'),'GA4_ARCHIVE_CONNECTION_REQUIRED')
   before=[exchange('/report?month='+m) for m in MONTHS]
   print(json.dumps({'ga4_before':before}),flush=True)
   last=None;attempts=0;deadline=time.monotonic()+400
   for _ in range(60):
    if time.monotonic()>deadline:break
    if all(r.get('available') and r.get('closed') and r.get('has_total') and r.get('has_cities') and r.get('has_devices') and r.get('has_pages') for r in before):break
    last=exchange('/tick','POST');attempts+=1
    if attempts%8==0 or last.get('status') in ('idle','held','unavailable'):print(json.dumps({'ga4_progress':{'attempts':attempts,'last':last}}),flush=True)
    if last.get('status') in ('held','unavailable','idle'):break
    if attempts%4==0:before=[exchange('/report?month='+m) for m in MONTHS]
   after=[exchange('/report?month='+m) for m in MONTHS]
   done=all(r.get('available') and r.get('closed') and r.get('has_total') and r.get('has_cities') and r.get('has_devices') and r.get('has_pages') and set(r.get('evidence_types',[]))=={'total','cities','devices','pages'} for r in after)
   print(json.dumps({'ga4_completion':{'verified':done,'months':after,'provider_steps':attempts,'last':last,'source':'Google Analytics 4 Data API','csv_record_source':'Separate user-supplied GA4 Traffic acquisition exports; not inserted as API metrics','d1_requests':0,'production_deployment_unchanged':True}}),flush=True)
   need(done,'GA4_ARCHIVE_MONTHS_INCOMPLETE')
 finally:
  if preview is not None:
   preview.terminate()
   try:preview.wait(timeout=6)
   except subprocess.TimeoutExpired:preview.kill()
  cfg.unlink(missing_ok=True);secret.unlink(missing_ok=True)
if __name__=='__main__':
 try:run()
 except Exception as error:
  code=str(error);print('GA4_ARCHIVE_STOPPED:'+(code if code.startswith('GA4_ARCHIVE_') else 'GA4_ARCHIVE_UNAVAILABLE'),flush=True);raise SystemExit(1)
