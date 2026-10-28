"""One guarded real product recrawl; no report refresh or public deployment."""
import json,os,secrets,subprocess,time,urllib.request
from pathlib import Path
from release_readiness import live_guard_deployment
from scoped_release import git,require,ROOT

def main():
 source=os.environ.get('RELEASE_SOURCE_COMMIT');live=live_guard_deployment()
 require(live and live.get('commit')==source,'CANARY_LIVE_SOURCE_REQUIRED')
 for path in ('src/crawler.ts','src/d1-read-budget.ts','src/types.ts'):
  require(git(ROOT,'show',source+':'+path)==(ROOT/path).read_bytes(),'CANARY_SOURCE_PARITY_REQUIRED')
 folder=ROOT/'.local/mapping-canary';folder.mkdir(parents=True,exist_ok=True)
 production=json.loads((ROOT/'deploy/wrangler.production.jsonc').read_text())
 config={'name':'mavi-local-mapping-canary','main':'../../scripts/mapping-canary.ts','compatibility_date':production['compatibility_date'],
  'workers_dev':False,'preview_urls':False,'vars':{'SITE_ORIGIN':'https://mavibasim.com','CRAWL_ENABLED':'true','D1_READ_GUARD_ENABLED':'true'},
  'd1_databases':[{k:production['d1_databases'][0][k] for k in ('binding','database_name','database_id')}|{'remote':True}]}
 (folder/'wrangler.jsonc').write_text(json.dumps(config));key=secrets.token_hex(32)
 secret=folder/'.dev.vars';secret.write_text('ADMIN_TOKEN='+key+'\n');secret.chmod(0o600)
 process=None;log=None
 try:
  log=(folder/'runtime.log').open('w')
  process=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--config',str(folder/'wrangler.jsonc'),'--ip','127.0.0.1','--port','8794','--log-level','error'],cwd=ROOT,stdout=log,stderr=log)
  def request(path,method='GET'):
   req=urllib.request.Request('http://127.0.0.1:8794'+path,method=method,headers={'Authorization':'Bearer '+key})
   with urllib.request.urlopen(req,timeout=90) as response:return json.loads(response.read(20000))
  ready=False
  for _ in range(40):
   require(process.poll() is None,'CANARY_RUNTIME_FAILED')
   try:request('/health');ready=True;break
   except (OSError,ValueError):time.sleep(1)
  require(ready,'CANARY_NOT_READY');result=request('/run','POST') # Never retry.
  (folder/'result.json').write_text(json.dumps(result,indent=2));require(result.get('verified') is True,'CANARY_NOT_VERIFIED')
  print(json.dumps(result)) # Only booleans. No private metrics, IDs or URLs.
 finally:
  if process is not None:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
  if log:log.close()
  secret.unlink(missing_ok=True)

if __name__=='__main__':
 try:main()
 except Exception as error:
  code=str(error) if isinstance(error,ValueError) and str(error) in ('CANARY_LIVE_SOURCE_REQUIRED','CANARY_SOURCE_PARITY_REQUIRED','CANARY_RUNTIME_FAILED','CANARY_NOT_READY','CANARY_NOT_VERIFIED') else type(error).__name__
  raise SystemExit('MAPPING_CANARY_STOPPED_NO_AUTOMATIC_RETRY:'+code) from None
