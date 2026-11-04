"""Bounded direct-GSC initial history and optional real-budget metadata warmup."""
import calendar,re
import json,secrets,subprocess,time,urllib.request,urllib.error
from gsc_runtime_audit import APP,ARCHIVE,ROOT,need,safe_code

def sanitize(value,mode):
 need(isinstance(value,dict) and value.get('ok') is True and value.get('mode')==mode,'GSC_HISTORY_RESPONSE_INVALID')
 allowed={'month':{'ok','mode','month','available','days_verified','expected_days','query_days_verified','evidence_refs','content_rows','chunk_reads','budget_limited','query_partial','source','d1_requests'},
 'context':{'ok','mode','available','source_hash','captured_at','products','snapshots','changes','d1_requests'}}.get(mode,{'ok','mode','months','completed_scopes','total_scopes','plan_complete','storage_reserved_bytes','storage_limit_bytes','tick','d1_requests','manual_csv_required'})
 need(set(value)<=allowed,'GSC_HISTORY_PRIVATE_FIELD_REJECTED')
 if mode=='context':need(type(value.get('d1_requests')) is int and value.get('d1_requests')==0 and type(value.get('available')) is bool,'GSC_HISTORY_CONTEXT_INVALID')
 else:need(type(value.get('d1_requests')) is int and value['d1_requests']==0,'GSC_HISTORY_D1_REJECTED')
 if mode=='month':
  m=value.get('month');need(isinstance(m,str) and re.fullmatch(r'20\d\d-(0[1-9]|1[0-2])',m),'GSC_HISTORY_MONTH_INVALID')
  expected=calendar.monthrange(int(m[:4]),int(m[5:]))[1]
  need(type(value.get('available')) is bool and value.get('expected_days')==expected and type(value.get('query_partial')) is bool and value['query_partial'] is True and value.get('source')=='GSC Search Analytics API','GSC_HISTORY_MONTH_INVALID')
  for key,limit in [('days_verified',expected),('query_days_verified',expected),('evidence_refs',2*expected),('content_rows',20000),('chunk_reads',256)]:
   need(type(value.get(key)) is int and 0<=value[key]<=limit,'GSC_HISTORY_MONTH_INVALID')
  need(type(value.get('budget_limited')) is bool and value['evidence_refs']==value['days_verified']+value['query_days_verified'],'GSC_HISTORY_MONTH_INVALID')
 if mode in ('tick','status'):
  need(type(value.get('completed_scopes')) is int and type(value.get('total_scopes')) is int and 0<=value['completed_scopes']<=value['total_scopes']<=124,'GSC_HISTORY_STATUS_INVALID')
  need(type(value.get('plan_complete')) is bool and isinstance(value.get('months'),list) and len(value['months'])<=2,'GSC_HISTORY_STATUS_INVALID')
  if value.get('tick') is not None:
   need(isinstance(value['tick'],dict) and set(value['tick'])<={'status','d1_requests','rows','cursor','completed_scopes','total_scopes','day','scope','code'} and value['tick'].get('d1_requests')==0,'GSC_HISTORY_PRIVATE_FIELD_REJECTED')
 return value

def acceptance(exchange,max_ticks=200,context_only=False):
 need(type(max_ticks) is int and 0<=max_ticks<=200,'GSC_HISTORY_TICK_LIMIT')
 if context_only:return sanitize(exchange('context',None),'context')
 status=sanitize(exchange('status',None),'status');attempts=0;deadline=time.monotonic()+240
 print(json.dumps({'gsc_history_before':status}),flush=True)
 while not status['plan_complete'] and attempts<max_ticks and time.monotonic()<deadline:
  status=sanitize(exchange('tick',None),'tick');attempts+=1
  if attempts%10==0 or status['plan_complete'] or status.get('tick',{}).get('status')=='held':print(json.dumps({'gsc_history_progress':status,'manual_ticks':attempts}),flush=True)
  if status.get('tick',{}).get('status')=='held':break
 reports=[sanitize(exchange('month',m),'month') for m in status['months']]
 verified=len(reports)==2 and all(r.get('available') is True and r.get('days_verified')==r.get('expected_days')==r.get('query_days_verified') and r.get('evidence_refs')==r.get('expected_days',0)*2 and not r.get('budget_limited') for r in reports)
 result={'verified':verified,'status':status,'months':reports,'manual_ticks':attempts,'d1_requests':0,'manual_csv_required':False,'missing_days_are_zero':False}
 print(json.dumps({'gsc_history_acceptance':result}),flush=True);return result

def runHistory(max_ticks=200,context_only=False):
 folder=ROOT/'.local/gsc-history-acceptance';folder.mkdir(parents=True,exist_ok=True);key=secrets.token_hex(32)
 config={'name':APP,'main':str(ROOT/'scripts/gsc_history_probe.ts'),'compatibility_date':'2026-10-01','workers_dev':False,'preview_urls':False,'vars':{'PROBE_KEY':key},'services':[{'binding':'ARCHIVE','service':ARCHIVE}]}
 path=folder/'wrangler.jsonc';path.write_text(json.dumps(config));path.chmod(0o600);preview=None
 try:
  with (folder/'runtime.log').open('w') as logs:
   preview=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--remote','--config',str(path),'--ip','127.0.0.1','--port','8804','--log-level','error'],cwd=ROOT,stdout=logs,stderr=logs)
   def exchange(mode,month):
    deadline=time.monotonic()+90
    while time.monotonic()<deadline:
     need(preview.poll() is None,'GSC_HISTORY_PREVIEW_CRASHED')
     url='http://127.0.0.1:8804/?mode='+mode+('&month='+month if month else '')
     req=urllib.request.Request(url,method='POST',data=b'{}',headers={'Authorization':'Bearer '+key,'User-Agent':'MaviBasimReleaseCheck/1.0','Accept':'application/json','Content-Type':'application/json'})
     try:
      with urllib.request.urlopen(req,timeout=60) as response:
       data=response.read(65537);need(len(data)<=65536,'GSC_HISTORY_RESPONSE_LIMIT');return json.loads(data)
     except urllib.error.HTTPError as error:
      body=error.read(65537)
      try:code=json.loads(body).get('code')
      except (ValueError,AttributeError):code=None
      if code:raise ValueError(safe_code(code)) from None
      # Never repeat an unconfirmed collection or metadata write.
      if mode in ('tick','context'):raise ValueError('GSC_HISTORY_MUTATION_UNCONFIRMED') from None
      if error.code in (400,401,403):raise ValueError('GSC_HISTORY_AUTH_REJECTED') from None
     except (urllib.error.URLError,TimeoutError):
      if mode in ('tick','context') and preview.poll() is None:
       # Startup may have no HTTP listener yet; only status is allowed to wait.
       raise ValueError('GSC_HISTORY_MUTATION_UNCONFIRMED') from None
     time.sleep(1)
    raise ValueError('GSC_HISTORY_PREVIEW_TIMEOUT')
   # Warm the preview with a read-only request before any mutation.
   sanitize(exchange('status',None),'status')
   report=acceptance(exchange,max_ticks,context_only);(folder/('context.json' if context_only else 'evidence.json')).write_text(json.dumps(report,indent=2)+'\n');return report
 finally:
  if preview is not None:
   preview.terminate()
   try:preview.wait(timeout=6)
   except subprocess.TimeoutExpired:preview.kill()
  path.unlink(missing_ok=True)
