"""Bounded private GSC recovery/collection acceptance for a guarded release.

The caller verifies CI, the Free plan and existing Worker bindings first. This
module only creates an authenticated account-only preview; it never deploys a
Worker, reads D1, returns source rows, or clears quota/OAuth holds.
"""
import json
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from gsc_runtime_audit import APP, ARCHIVE, ROOT, need, safe_code, sanitize

RETRY_CODES={'GSC_HTTP_400','GSC_AGGREGATION_INVALID','GSC_ROW_REJECTED','GSC_DUPLICATE_ROW','GSC_SYNC_UNAVAILABLE'}
MODES={'status','diagnostic','recover','collect','readback'}

def request(key,mode,ticks=0):
 need(mode in MODES,'GSC_PIPELINE_MODE_INVALID')
 if mode=='collect':need(type(ticks) is int and 1<=ticks<=4,'GSC_PIPELINE_TICK_LIMIT')
 elif mode=='readback':need(type(ticks) is int and 0<=ticks<=13,'GSC_PIPELINE_TICK_LIMIT')
 else:need(ticks==0,'GSC_PIPELINE_TICK_LIMIT')
 return urllib.request.Request('http://127.0.0.1:8803/?mode='+mode,
  method='GET' if mode=='status' else 'POST',
  data=None if mode=='status' else json.dumps({'ticks':ticks} if mode=='collect' else {'index':ticks} if mode=='readback' else {}).encode(),
  headers={'Authorization':'Bearer '+key,'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json','Content-Type':'application/json'})

def sanitize_response(value,mode):
 need(isinstance(value,dict) and value.get('ok') is True and value.get('mode')==mode,'GSC_PIPELINE_RESPONSE_INVALID')
 common={'ok','mode','observed_at','status','d1_requests'}
 extra={'status':set(),'diagnostic':{'diagnostic'},'recover':{'recovery_candidates','released_scopes','recoveries'},
        'collect':{'manual_ticks','attempts'},'readback':{'readbacks','content_verified_scopes','nonempty_content_scopes'}}[mode]
 need(set(value)==common|extra and type(value.get('d1_requests')) is int and value['d1_requests']==0,'GSC_PIPELINE_PRIVATE_FIELD_REJECTED')
 # Reuse the strict metadata-only audit validator for every returned status.
 envelope={'ok':True,'observed_at':value.get('observed_at'),'manual_ticks':value.get('manual_ticks',0),
  'before':value.get('status'),'after':value.get('status'),'attempts':value.get('attempts',[]),
  'readback':{'available':False,'d1_requests':0},'d1_requests':0}
 sanitize(envelope)
 if mode=='diagnostic':
  diagnostic=value.get('diagnostic')
  allowed={'at','revision','status','ok','day','scope','rows','cursor','code','last_failure','d1_requests'}
  need(isinstance(diagnostic,dict) and set(diagnostic)<=allowed and {'at','revision','status','ok','d1_requests'}.issubset(diagnostic),'GSC_PIPELINE_DIAGNOSTIC_INVALID')
  need(diagnostic['revision']=='daily-proof-v2' and type(diagnostic['ok']) is bool and type(diagnostic['d1_requests']) is int and diagnostic['d1_requests']==0,'GSC_PIPELINE_DIAGNOSTIC_INVALID')
  check=json.loads(json.dumps(envelope));event={k:v for k,v in diagnostic.items() if k not in ('revision','ok','last_failure','d1_requests')}
  check['after']['last_attempt']=event
  if diagnostic.get('last_failure') is not None:check['after']['last_failure']=diagnostic['last_failure']
  sanitize(check)
 if mode=='recover':
  rows=value.get('recoveries');need(isinstance(rows,list) and len(rows)<=16,'GSC_PIPELINE_RECOVERY_LIMIT')
  need(type(value.get('recovery_candidates')) is int and value['recovery_candidates']==len(rows),'GSC_PIPELINE_RECOVERY_INVALID')
  need(type(value.get('released_scopes')) is int and value['released_scopes']==sum(r.get('released') is True for r in rows),'GSC_PIPELINE_RECOVERY_INVALID')
  identities=set()
  for row in rows:
   need(isinstance(row,dict) and set(row)<= {'day','scope','code','until','released','reason'} and {'day','scope','code','until','released'}.issubset(row),'GSC_PIPELINE_RECOVERY_INVALID')
   need(row['code'] in RETRY_CODES and type(row['released']) is bool and (row['released'] and 'reason' not in row or not row['released'] and row.get('reason')=='already_retried'),'GSC_PIPELINE_RECOVERY_INVALID')
   # Audit validates day/scope/code/timestamp formats without exposing payloads.
   check=json.loads(json.dumps(envelope));check['after']['held']=[{k:row[k] for k in ('day','scope','code','until')}|{'active':True}];sanitize(check)
   identity=(row['day'],row['scope']);need(identity not in identities,'GSC_PIPELINE_RECOVERY_INVALID');identities.add(identity)
 if mode=='readback':
  rows=value.get('readbacks');need(isinstance(rows,list) and len(rows)<=14,'GSC_PIPELINE_READBACK_INVALID')
  identities=set()
  for row in rows:
   need(isinstance(row,dict) and set(row)=={'available','verified','day','scope','rows','pages','d1_requests'},'GSC_PIPELINE_READBACK_INVALID')
   need(row['available'] is True and row['verified'] is True,'GSC_PIPELINE_READBACK_INVALID')
   check=json.loads(json.dumps(envelope));check['readback']=row;sanitize(check)
   identity=(row['day'],row['scope']);need(identity not in identities,'GSC_PIPELINE_READBACK_INVALID');identities.add(identity)
  need(type(value.get('content_verified_scopes')) is int and value['content_verified_scopes']==len(rows),'GSC_PIPELINE_READBACK_INVALID')
  need(type(value.get('nonempty_content_scopes')) is int and value['nonempty_content_scopes']==sum(r['rows']>0 for r in rows),'GSC_PIPELINE_READBACK_INVALID')
  need(identities.issubset({(r['day'],r['scope']) for r in value['status']['coverage']}),'GSC_PIPELINE_READBACK_SCOPE_MISMATCH')
 return value

def acceptance(exchange,max_ticks=32):
 """Run against a supplied authenticated exchange; all emitted data is validated."""
 need(type(max_ticks) is int and 0<=max_ticks<=32,'GSC_PIPELINE_TOTAL_TICK_LIMIT')
 before=sanitize_response(exchange('status',0),'status')
 # This line precedes every recovery/tick and captures actual pre-change holds.
 print(json.dumps({'gsc_pipeline_before_recovery':before},ensure_ascii=False),flush=True)
 status=before['status'];diagnostic=None;recovery=None;attempts=[];readback=None;reason='GSC_PIPELINE_INCOMPLETE'
 if status['connected'] and not status['reauthorization_required']:
  if status['covered_scopes']<14:
   diagnostic=sanitize_response(exchange('diagnostic',0),'diagnostic');status=diagnostic['status']
   print(json.dumps({'gsc_pipeline_diagnostic':diagnostic},ensure_ascii=False),flush=True)
   if not diagnostic['diagnostic']['ok']:
    report={'passed':False,'reason':'GSC_PIPELINE_DIAGNOSTIC_FAILED','before_recovery':before,'diagnostic':diagnostic,
     'recovery':None,'after':status,'attempts':[],'manual_ticks':0,'readback':None,'d1_requests':0,'missing_days_are_zero':False}
    print(json.dumps({'gsc_pipeline_acceptance':report},ensure_ascii=False),flush=True)
    return report
   recovery=[]
   for _ in range(16):
    step=sanitize_response(exchange('recover',0),'recover');status=step['status'];recovery.append(step)
    if step['recovery_candidates']==0 or step['released_scopes']==0:break
   else:raise ValueError('GSC_PIPELINE_RECOVERY_LIMIT')
  while status['covered_scopes']<14 and len(attempts)<max_ticks:
   collected=sanitize_response(exchange('collect',min(1,max_ticks-len(attempts))),'collect')
   need(1<=collected['manual_ticks']<=min(1,max_ticks-len(attempts)),'GSC_PIPELINE_NO_PROGRESS')
   attempts.extend(collected['attempts']);status=collected['status']
   print(json.dumps({'gsc_pipeline_collection':{'manual_ticks_total':len(attempts),'attempts':collected['attempts'],'status':status,'d1_requests':0}},ensure_ascii=False),flush=True)
   if any(r['status'] in ('held','idle') for r in collected['attempts']):break
  if status['covered_scopes']==14:
   proofs=[]
   for index in range(14):
    step=sanitize_response(exchange('readback',index),'readback');status=step['status']
    need(len(step['readbacks'])==1,'GSC_PIPELINE_READBACK_INVALID');proofs.extend(step['readbacks'])
   readback={**step,'readbacks':proofs,'content_verified_scopes':len(proofs),'nonempty_content_scopes':sum(r['rows']>0 for r in proofs)}
   sanitize_response(readback,'readback')
   scopes={r['scope'] for r in proofs if r['rows']>0}
   if len(proofs)==14 and scopes=={'page','query'}:reason='GSC_PIPELINE_VERIFIED'
 else:reason='GSC_PIPELINE_AUTHORIZATION_UNAVAILABLE'
 report={'passed':reason=='GSC_PIPELINE_VERIFIED','reason':reason,'before_recovery':before,
  'diagnostic':diagnostic,'recovery':recovery,'after':status,'attempts':attempts,'manual_ticks':len(attempts),
  'readback':readback,'d1_requests':0,'missing_days_are_zero':False}
 print(json.dumps({'gsc_pipeline_acceptance':report},ensure_ascii=False),flush=True)
 return report

def collector_ready(value):
 if not isinstance(value,dict) or not isinstance(value.get('status'),dict):return False
 status=value['status']
 return isinstance(status.get('held'),list) and type(status.get('tick_count')) is int and type(status.get('backfill_index')) is int and isinstance(status.get('storage_budget'),dict)

def runPipeline(max_ticks=32):
 """Called only by the already guarded controlled release, after archive upload."""
 need(type(max_ticks) is int and 0<=max_ticks<=32,'GSC_PIPELINE_TOTAL_TICK_LIMIT')
 folder=ROOT/'.local/gsc-pipeline-acceptance';folder.mkdir(parents=True,exist_ok=True)
 key=secrets.token_hex(32)
 config={'name':APP,'main':str(ROOT/'scripts/gsc_pipeline_probe.ts'),'compatibility_date':'2026-10-01',
  'workers_dev':False,'preview_urls':False,'vars':{'PROBE_KEY':key},'services':[{'binding':'ARCHIVE','service':ARCHIVE}]}
 config_path=folder/'wrangler.jsonc';config_path.write_text(json.dumps(config));config_path.chmod(0o600)
 preview=None
 try:
  with (folder/'runtime.log').open('w') as logs:
   preview=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--remote','--config',str(config_path),'--ip','127.0.0.1','--port','8803','--log-level','error'],cwd=ROOT,stdout=logs,stderr=logs)
   def exchange(mode,ticks):
    deadline=time.monotonic()+100;old_collector=False
    while time.monotonic()<deadline:
     need(preview.poll() is None,'GSC_PIPELINE_PREVIEW_CRASHED')
     try:
      with urllib.request.urlopen(request(key,mode,ticks),timeout=60) as response:
       body=response.read(65537);need(len(body)<=65536,'GSC_PIPELINE_RESPONSE_LIMIT');value=json.loads(body)
       if mode=='status' and not collector_ready(value):
        old_collector=True;time.sleep(1);continue
       return value
     except urllib.error.HTTPError as error:
      body=error.read(65537)
      try:code=json.loads(body).get('code')
      except (ValueError,AttributeError):code=None
      if len(body)<=65536 and code is not None:raise ValueError(safe_code(code)) from None
      print(json.dumps({'gsc_pipeline_transport_failure':{'mode':mode,'http_status':error.code,'body_limit_exceeded':len(body)>65536}}),flush=True)
      if error.code in (400,401,403):raise ValueError('GSC_PIPELINE_AUTH_OR_REQUEST_REJECTED') from None
      if mode!='status':raise ValueError('GSC_PIPELINE_MUTATION_UNCONFIRMED') from None
     except (urllib.error.URLError,TimeoutError):
      if mode!='status':raise ValueError('GSC_PIPELINE_MUTATION_UNCONFIRMED') from None
     time.sleep(1)
    raise ValueError('GSC_PIPELINE_OLD_COLLECTOR_VERSION' if old_collector else 'GSC_PIPELINE_PREVIEW_TIMEOUT')
   report=acceptance(exchange,max_ticks)
   (folder/'evidence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
   return report
 finally:
  if preview is not None:
   preview.terminate()
   try:preview.wait(timeout=6)
   except subprocess.TimeoutExpired:preview.kill()
  config_path.unlink(missing_ok=True)
