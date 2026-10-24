"""Bounded real-site acceptance of the EXISTING crawler, using remote D1 binding.

The Worker runs on loopback in CI, never a new public production endpoint.
No Google credential, production auth key, migration or CSV import is needed.
"""
import argparse
import json
import os
import re
import secrets
import subprocess
import time
import urllib.request
import uuid
from datetime import datetime,timezone
from pathlib import Path
from release_checks import config_errors

ROOT=Path(__file__).resolve().parents[1]
EXPECTED={'products':29,'csv_files':521,'csv_rows':9075}

def pilot_config(config):
 if config_errors(config):raise ValueError('PRODUCTION_CONFIG_REJECTED')
 database=config['d1_databases'][0]
 if database['database_name']!='mavi-basim-seo' or not uuid.UUID(database['database_id']).int:raise ValueError('UNEXPECTED_D1')
 return {'name':'mavi-basim-local-crawl-acceptance','main':'../../src/crawl-pilot.ts','compatibility_date':config['compatibility_date'],
  'workers_dev':False,'preview_urls':False,'vars':{'SITE_ORIGIN':'https://mavibasim.com','CRAWL_ENABLED':'true'},
  'd1_databases':[{'binding':'DB','database_name':database['database_name'],'database_id':database['database_id'],'remote':True}]}

def accepted(state,all_products=False):
 targets=tuple(t['id'] for t in state.get('targets',[])) if all_products else ('brosur','el-ilani')
 if all_products and len(set(targets))!=29:return False
 return all(any(t.get('id')==product and t.get('canonical_url')=='https://mavibasim.com/'+product and t.get('url_verified_at') for t in state.get('targets',[]))
  and any(e.get('product')==product and e.get('status')==200 and e.get('canonical')=='https://mavibasim.com/'+product and e.get('title') and re.fullmatch(r'[a-f0-9]{64}',e.get('body_hash','')) and e.get('rendering')=='static-html' for e in state.get('snapshot_evidence',[]))
  for product in targets)

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--max-pages',type=int,default=12);parser.add_argument('--all-products',action='store_true');parser.add_argument('--performance-only',action='store_true');args=parser.parse_args()
 if not 1<=args.max_pages<=12:raise ValueError('PILOT_PAGE_BOUND_REQUIRED')
 if not os.environ.get('CLOUDFLARE_API_TOKEN') or not os.environ.get('CLOUDFLARE_ACCOUNT_ID'):raise ValueError('CLOUDFLARE_BINDINGS_MISSING')
 config=pilot_config(json.loads((ROOT/'deploy/wrangler.production.jsonc').read_text()))
 folder=ROOT/'.local/crawl-pilot';folder.mkdir(parents=True,exist_ok=True)
 config_path=folder/'wrangler.jsonc';config_path.write_text(json.dumps(config));key=secrets.token_hex(32)
 secret_path=folder/'.dev.vars';secret_path.write_text('PILOT_RUN_KEY='+key+'\n');secret_path.chmod(0o600)
 log=open(folder/'runner.log','w');process=None;summary={'real_data':True,'site':'https://mavibasim.com','max_pages':args.max_pages,'production_worker_modified':False,'google_sync_triggered':False,'started_at':datetime.now(timezone.utc).isoformat()}
 try:
  process=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--config',str(config_path),'--ip','127.0.0.1','--port','8792','--log-level','error'],cwd=ROOT,stdout=log,stderr=log)
  def request(path,method='GET'):
   req=urllib.request.Request('http://127.0.0.1:8792'+path,method=method,headers={'Authorization':'Bearer '+key,'User-Agent':'MaviBasimReleaseCheck/1.0'})
   with urllib.request.urlopen(req,timeout=35) as response:return json.load(response)
  ready=False
  for _ in range(45):
   if process.poll() is not None:raise ValueError('LOCAL_PILOT_RUNTIME_FAILED')
   try:request('/health');ready=True;break
   except (OSError,ValueError):time.sleep(1)
  if not ready:raise ValueError('LOCAL_PILOT_RUNTIME_NOT_READY')
  before=request('/state');summary['before']=before
  if before.get('source_counts')!=EXPECTED:raise ValueError('SOURCE_COUNTS_MISMATCH')
  if args.performance_only:
   result=request('/performance-check');summary['performance_checks']=result;summary['site_crawl_triggered']=False
   if not all(result['checks'].values()) or not result['has_real_observations'] or result['catalog_products']!=29:raise ValueError('REAL_PERFORMANCE_CHECK_FAILED')
  else:
   latest=before
   for page in range(args.max_pages):
    if accepted(latest,args.all_products):break
    if page:time.sleep(6) # Existing crawler also enforces robots delay atomically.
    latest=request('/run','POST');summary['attempts']=page+1
    print(json.dumps({'attempt':page+1,'recent':latest['recent'],'verified_targets':[t['id'] for t in latest['targets'] if t.get('url_verified_at')]}),flush=True)
  after=request('/state');summary['after']=after
  if after.get('source_counts')!=EXPECTED:raise ValueError('SOURCE_COUNTS_CHANGED')
  summary['passed']=args.performance_only or accepted(after,args.all_products)
  if not summary['passed']:raise ValueError('REAL_CRAWL_ACCEPTANCE_INCOMPLETE')
 finally:
  summary['finished_at']=datetime.now(timezone.utc).isoformat();(ROOT/'.local/crawl-pilot-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
  if process is not None:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
  log.close();secret_path.unlink(missing_ok=True)
 print('Real performance check passed; no site crawl or Google sync triggered' if args.performance_only else 'Real crawler pilot passed; production flags unchanged; source archive preserved')

if __name__=='__main__':
 try:main()
 except Exception as error:
  code=str(error) if isinstance(error,ValueError) and str(error).replace('_','').isupper() else type(error).__name__
  raise SystemExit('CRAWL_PILOT_FAILED:'+code)
