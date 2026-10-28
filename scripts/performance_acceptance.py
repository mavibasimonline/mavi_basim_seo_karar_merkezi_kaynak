"""Bounded API reproduction using exact live source and guarded remote D1; no deploy."""
import json,secrets,subprocess,time,urllib.request,urllib.error
from pathlib import Path
import os
from scoped_release import git,require,PERFORMANCE_SOURCE
from release_readiness import live_guard_deployment
root=Path(__file__).resolve().parents[1]
require(os.environ.get('RELEASE_SOURCE_COMMIT')==PERFORMANCE_SOURCE,'PERFORMANCE_SOURCE_REQUIRED')
for path in ('src/d1-read-budget.ts','src/performance.ts','src/read-cache.ts','src/security.ts','src/types.ts','src/urls.ts','src/periods.ts','src/analysis.ts'):
 require(git(root,'show',PERFORMANCE_SOURCE+':'+path)==(root/path).read_bytes(),'PERFORMANCE_SOURCE_PARITY_REQUIRED')
config=json.loads((root/'deploy/wrangler.production.jsonc').read_text())
folder=root/'.local/performance-probe';folder.mkdir(parents=True,exist_ok=True)
key=secrets.token_hex(32);secret=folder/'.dev.vars';secret.write_text('ADMIN_TOKEN='+key+'\n');secret.chmod(0o600)
c={'name':'mavi-local-performance-probe','main':'../../src/index.ts','compatibility_date':config['compatibility_date'],'workers_dev':False,'vars':{**config['vars'],'D1_READ_GUARD_ENABLED':'true','AUTOMATION_ENABLED':'false','CRAWL_ENABLED':'false'},'d1_databases':[{**{k:config['d1_databases'][0][k] for k in ('binding','database_name','database_id')},'remote':True}]}
(folder/'wrangler.jsonc').write_text(json.dumps(c));p=None
try:
 with (folder/'runtime.log').open('w') as log:
  p=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--config',str(folder/'wrangler.jsonc'),'--ip','127.0.0.1','--port','8795','--log-level','error'],cwd=root,stdout=log,stderr=log)
  for i in range(40):
   if p.poll() is not None:raise ValueError('PROBE_RUNTIME_FAILED')
   try:
    with urllib.request.urlopen('http://127.0.0.1:8795/api/health',timeout=2) as r:r.read(10000)
    break
   except OSError:time.sleep(1)
  else:raise ValueError('PROBE_RUNTIME_TIMEOUT')
  for path in ('/api/status','/api/performance?month=2026-10','/api/performance/queries?month=2026-10','/api/performance/queries?month=2026-10&product=brosur'):
   started=time.monotonic();req=urllib.request.Request('http://127.0.0.1:8795'+path,headers={'Authorization':'Bearer '+key})
   try:r=urllib.request.urlopen(req,timeout=90)
   except urllib.error.HTTPError as error:r=error
   with r:
    raw=r.read(5000001);out={'path':path,'status':r.status,'seconds':round(time.monotonic()-started,2)}
    try:
     body=json.loads(raw);out.update({k:body[k] for k in ('code','reason') if k in body})
     if r.status==200:
      if 'read_budget' in body:out['budget_mode']=body['read_budget'].get('mode')
      if 'products' in body:out['brosur_has_gsc']=any(x.get('id')=='brosur' and x.get('current') is not None for x in body['products'])
      if 'rows' in body:out['query_rows_present']=bool(body['rows'])
    except ValueError:out['body_kind']='non-JSON'
    print(json.dumps(out),flush=True)
    require(r.status==200,'PERFORMANCE_API_NOT_AVAILABLE')
    require(out.get('brosur_has_gsc',True) and out.get('query_rows_present',True),'PERFORMANCE_MEASUREMENT_REQUIRED')
finally:
 if p is not None:
  p.terminate()
  try:p.wait(timeout=10)
  except subprocess.TimeoutExpired:p.kill();p.wait()
 secret.unlink(missing_ok=True)
