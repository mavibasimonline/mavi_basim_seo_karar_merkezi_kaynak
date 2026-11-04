"""Account-only GSC evidence probe; no production deploy, D1 reads or source-row logging."""
import argparse
import json
import os
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from quota_observer_release import api, active_version, cron_rows, free_plan
from release_readiness import get_json, REPOSITORY

ROOT=Path(__file__).resolve().parents[1]
APP='mavi-basim-seo-prod'
ARCHIVE='mavi-basim-drive-archive'
TITLE='audit: daily GSC runtime evidence 20261104'

def need(value, code):
 if not value:raise ValueError(code)

def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,stderr=subprocess.DEVNULL).decode().strip()

def probe_request(key,ticks=0):
 need(type(ticks) is int and 0<=ticks<=4,'GSC_AUDIT_TICK_LIMIT')
 return urllib.request.Request('http://127.0.0.1:8802/?ticks='+str(ticks),headers={
  'Authorization':'Bearer '+key,'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json'})

def safe_code(value):
 return value if isinstance(value,str) and re.fullmatch(r'GSC_[A-Z0-9_]{1,100}',value) else 'GSC_AUDIT_UNAVAILABLE'

def sanitize(proof):
 """Reject unexpected fields rather than emitting remote payloads to a public job log."""
 need(isinstance(proof,dict) and set(proof)<= {'ok','observed_at','manual_ticks','before','attempts','after','readback','d1_requests'},'GSC_AUDIT_PROOF_INVALID')
 need(proof.get('ok') is True and type(proof.get('d1_requests')) is int and proof['d1_requests']==0,'GSC_AUDIT_PROOF_INVALID')
 need(type(proof.get('manual_ticks')) is int and 0<=proof['manual_ticks']<=4,'GSC_AUDIT_PROOF_INVALID')
 def validate(value,allowed):
  need(isinstance(value,dict) and set(value)<=allowed,'GSC_AUDIT_PRIVATE_FIELD_REJECTED')
 def dates(value):
  for k,v in value.items():
   if k in ('at','captured_at','observed_at'):
    need(isinstance(v,str) and len(v)<=40,'GSC_AUDIT_TIMESTAMP_INVALID')
    try:datetime.fromisoformat(v.replace('Z','+00:00'))
    except (ValueError,TypeError):raise ValueError('GSC_AUDIT_TIMESTAMP_INVALID') from None
   elif k=='day':need(isinstance(v,str) and re.fullmatch(r'20\d\d-\d\d-\d\d',v),'GSC_AUDIT_DAY_INVALID')
   elif k=='scope':need(v in ('page','query'),'GSC_AUDIT_SCOPE_INVALID')
   elif k=='status':need(v in ('complete','partial','idle','held'),'GSC_AUDIT_STATUS_INVALID')
   elif k=='code':need(safe_code(v)==v,'GSC_AUDIT_CODE_INVALID')
   elif k in ('rows','pages','cursor','covered_scopes','expected_scopes','d1_requests'):need(type(v) is int and 0<=v<=1000000,'GSC_AUDIT_COUNT_INVALID')
 dates(proof)
 for phase in ('before','after'):
  status=proof.get(phase)
  validate(status,{'connected','reauthorization_required','coverage','covered_scopes','expected_scopes','last_attempt','pending','d1_requests'})
  need(type(status.get('connected')) is bool and type(status.get('reauthorization_required')) is bool and status.get('d1_requests')==0,'GSC_AUDIT_PROOF_INVALID')
  coverage=status.get('coverage');need(isinstance(coverage,list) and len(coverage)<=14 and status.get('covered_scopes')==len(coverage) and status.get('expected_scopes')==14,'GSC_AUDIT_COVERAGE_INVALID')
  dates(status)
  identities=set()
  for row in coverage:
   validate(row,{'day','scope','rows','captured_at','query_partial'});dates(row)
   need(set(row)=={'day','scope','rows','captured_at','query_partial'} and type(row['query_partial']) is bool,'GSC_AUDIT_COVERAGE_INVALID')
   identity=(row['day'],row['scope']);need(identity not in identities,'GSC_AUDIT_DUPLICATE_COVERAGE');identities.add(identity)
  for field,allowed in [('last_attempt',{'at','status','day','scope','code'}),('pending',{'day','scope','cursor'})]:
   if status.get(field) is not None:validate(status[field],allowed);dates(status[field])
 attempts=proof.get('attempts');need(isinstance(attempts,list) and len(attempts)==proof['manual_ticks'],'GSC_AUDIT_PROOF_INVALID')
 for attempt in attempts:
  validate(attempt,{'status','day','scope','rows','cursor','code','d1_requests'});dates(attempt)
  need(attempt.get('d1_requests')==0,'GSC_AUDIT_PROOF_INVALID')
 validate(proof.get('readback'),{'available','verified','day','scope','rows','pages','d1_requests'});dates(proof['readback'])
 need(type(proof['readback'].get('available')) is bool and proof['readback'].get('d1_requests')==0,'GSC_AUDIT_READBACK_INVALID')
 if proof['readback']['available']:need(proof['readback'].get('verified') is True,'GSC_AUDIT_READBACK_INVALID')
 return proof

def snapshot(client,name):
 base='/workers/scripts/'+name
 return {'version':active_version(api(client,'GET',base+'/deployments')),
         'crons':cron_rows(api(client,'GET',base+'/schedules'))}

def probe(ticks=0):
 """Usable from a separately guarded release after its own resource/CI checks."""
 need(type(ticks) is int and 0<=ticks<=4,'GSC_AUDIT_TICK_LIMIT')
 folder=ROOT/'.local/gsc-runtime-audit';folder.mkdir(parents=True,exist_ok=True)
 key=secrets.token_hex(32)
 config={'name':APP,'main':str(ROOT/'scripts/gsc_runtime_probe.ts'),
         'compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,
         'vars':{'PROBE_KEY':key},'services':[{'binding':'ARCHIVE','service':ARCHIVE}]}
 config_path=folder/'wrangler.jsonc';config_path.write_text(json.dumps(config));config_path.chmod(0o600)
 preview=None
 try:
  with (folder/'runtime.log').open('w') as logs:
   preview=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--remote','--config',str(config_path),'--ip','127.0.0.1','--port','8802','--log-level','error'],cwd=ROOT,stdout=logs,stderr=logs)
   deadline=time.monotonic()+100
   while time.monotonic()<deadline:
    need(preview.poll() is None,'GSC_AUDIT_PREVIEW_CRASHED')
    try:
     with urllib.request.urlopen(probe_request(key,ticks),timeout=45) as response:
      raw=response.read(65537);need(len(raw)<=65536,'GSC_AUDIT_RESPONSE_LIMIT')
      return sanitize(json.loads(raw))
    except urllib.error.HTTPError as error:
     body=error.read(1024)
     try:failure=json.loads(body).get('code')
     except (ValueError,AttributeError):failure=None
     # Never retry an invoked collector, which could duplicate diagnostic work.
     if failure is not None:raise ValueError(safe_code(failure)) from None
     if error.code in (400,401,403):raise ValueError('GSC_AUDIT_AUTH_OR_REQUEST_REJECTED') from None
    except (urllib.error.URLError,TimeoutError):
     if ticks:raise ValueError('GSC_AUDIT_COLLECT_TRANSPORT_UNCONFIRMED') from None
    time.sleep(1)
   raise ValueError('GSC_AUDIT_PREVIEW_TIMEOUT')
 finally:
  if preview is not None:
   preview.terminate()
   try:preview.wait(timeout=6)
   except subprocess.TimeoutExpired:preview.kill()
  # Random preview authentication is ephemeral and never enters artifacts/logs.
  config_path.unlink(missing_ok=True)

def run(ticks=0):
 sha=os.environ.get('GITHUB_SHA','')
 need(os.environ.get('GITHUB_REF')=='refs/heads/main' and os.environ.get('GITHUB_REPOSITORY')==REPOSITORY,'GSC_AUDIT_MAIN_REQUIRED')
 need(re.fullmatch('[a-f0-9]{40}',sha or '') and git('rev-parse','HEAD')==sha,'GSC_AUDIT_HEAD_MISMATCH')
 need(git('log','-1','--format=%s')==TITLE,'GSC_AUDIT_TITLE_REQUIRED')
 need(os.environ.get('VERIFIED_CI_SHA')==sha,'GSC_AUDIT_CI_SHA_MISMATCH')
 token=os.environ.get('GITHUB_TOKEN')
 need(get_json('https://api.github.com/repos/'+REPOSITORY+'/branches/main',token).get('commit',{}).get('sha')==sha,'GSC_AUDIT_MAIN_SUPERSEDED')
 runs=get_json('https://api.github.com/repos/'+REPOSITORY+'/actions/workflows/ci.yml/runs?head_sha='+sha+'&per_page=30',token).get('workflow_runs',[])
 need(any(r.get('head_sha')==sha and r.get('head_branch')=='main' and r.get('event')=='push' and r.get('conclusion')=='success' for r in runs),'GSC_AUDIT_GREEN_MAIN_CI_REQUIRED')
 client=Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
 free_plan(api(client,'GET','/subscriptions'))
 workers=api(client,'GET','/workers/scripts')
 need(isinstance(workers,list) and {APP,ARCHIVE}.issubset({w.get('id') for w in workers}),'GSC_AUDIT_EXISTING_RESOURCES_REQUIRED')
 need(api(client,'GET','/workers/scripts/'+ARCHIVE+'/subdomain').get('enabled') is False,'GSC_AUDIT_ARCHIVE_MUST_BE_PRIVATE')
 before={name:snapshot(client,name) for name in (APP,ARCHIVE)}
 need(before[APP]['crons']==['*/15 * * * *'],'GSC_AUDIT_CRON_DRIFT')
 evidence=probe(ticks)
 after={name:snapshot(client,name) for name in (APP,ARCHIVE)}
 need(before==after,'GSC_AUDIT_PRODUCTION_DRIFT')
 report={'audit_source':sha,'observed_at':datetime.now(timezone.utc).isoformat(),
         'production':before,'production_unchanged':True,'free_plan_verified':True,
         'evidence':evidence,'d1_requests':0,'site_changed':False,'deployed':False}
 output=ROOT/'.local/gsc-runtime-audit/evidence.json';output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report,ensure_ascii=False),flush=True)
 return report

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--ticks',type=int,default=0);args=parser.parse_args()
 try:run(args.ticks)
 except Exception as error:
  print(safe_code(str(error)),flush=True)
  raise SystemExit(1)
