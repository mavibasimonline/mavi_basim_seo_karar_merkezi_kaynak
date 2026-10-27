"""Explicit one-time September operation; no deploy, Google sync or guard bypass.

Uses the existing application's routes on a loopback operator with the existing
remote D1 binding, just as the crawler acceptance runner does. Does NOT claim an
authenticated production-browser session. Private receipts are encrypted.
"""
import base64,hashlib,json,os,re,secrets,subprocess,time,urllib.request,urllib.error
from datetime import datetime,timedelta,timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from release_readiness import live_guard_deployment
import gsc_continuity_audit as audit

ROOT=Path(__file__).resolve().parents[1]
QUERY='month=2026-09&device=ALL&rangeMonths=1'
CRITICAL=('analysis.ts','validation.ts','performance.ts','read-cache.ts','d1-read-budget.ts','urls.ts','types.ts','sync.ts','security.ts','periods.ts')

def ensure(condition,code):
 if not condition:raise ValueError(code)

def require_snapshot(value,now):
 ensure(value.get('status')=='observed' and value.get('production_lease_valid') is True,'CURRENT_SAFE_LEASE_REQUIRED')
 ensure(value.get('rows_written')==0 and value.get('september_acceptance',{}).get('raw_metrics_verified') is True,'RAW_VERIFICATION_REQUIRED')
 quota=value['quota'][0];local=value['ledger'][0];usage=value['account_usage']
 ensure(audit.instant(quota.get('valid_until'))>now+timedelta(minutes=10),'LEASE_OPERATION_HEADROOM_REQUIRED')
 ensure(usage['account_reads']+local['reads']+1_800_000<3_400_000 and usage['account_writes']+local['writes']+8_000<84_000,'OPERATION_HEADROOM_REQUIRED')
 ensure(value.get('crons')==['*/15 * * * *'] and value.get('runtime_flags',{}).get('D1_READ_GUARD_ENABLED')=='true','LIVE_GUARD_AND_CRON_REQUIRED')

def metric_match(actual,expected):
 if actual is None or expected is None:return actual is None and expected is None
 return all(actual.get(k)==expected.get(k) for k in ('clicks','impressions')) and all(
  (actual.get(k) is None and expected.get(k) is None) or
  (type(actual.get(k)) in (int,float) and type(expected.get(k)) in (int,float) and abs(actual[k]-expected[k])<1e-7)
  for k in ('ctr','position'))

def verify_payload(value,before):
 ensure(value.get('report_attempts')==1 and value.get('kpi_attempts')==1,'EXACTLY_ONE_ATTEMPT_REQUIRED')
 report=value['report'];kpi=value['kpi']
 ensure(len(report.get('products',[]))==29 and len({p.get('id') for p in report['products']})==29,'PRODUCT_CATALOG_MISMATCH')
 ensure(kpi.get('archive',{}).get('csv_files')==521 and kpi['archive'].get('csv_rows')==9075,'SOURCE_ARCHIVE_MISMATCH')
 ensure(report.get('month')=='2026-09' and report.get('filters',{}).get('device') is None,'REPORT_SCOPE_MISMATCH')
 ensure(kpi.get('device') is None and kpi.get('range_months')==1,'KPI_SCOPE_MISMATCH')
 for data in (report,kpi):
  ensure(data.get('period',{}).get('start')=='2026-09-01' and data['period']['end']=='2026-09-30','WRONG_PERIOD')
 ensure(metric_match(kpi.get('current'),before['september_metrics']['page']['totals']),'KPI_RAW_METRIC_MISMATCH')
 ensure(kpi.get('coverage',{}).get('verified_days')==30 and kpi['coverage'].get('invalid_days')==[],'KPI_SOURCE_COVERAGE_MISMATCH')
 august=before['coverage']['months']['2026-08']['completed']==62
 if not august:
  ensure(report.get('missing') and all(p.get('decision')=='Veri bekle' for p in report['products']),'INCOMPLETE_AUGUST_REPORT_GATE')
  ensure(kpi.get('comparison_available') is False,'INCOMPLETE_AUGUST_COMPARISON_GATE')
 return {'raw_kpi_metrics_match':True,'incomplete_august_gate_verified':not august,
  'report_id':report['id'],'report_created_at':report['created_at'],'kpi_measured_at':kpi['measured_at'],
  'kpi':kpi['current'],'report_missing':report['missing'],'waiting_products':sum(p['decision']=='Veri bekle' for p in report['products']),
  'api_execution':'existing_application_routes_loopback_remote_production_D1','authenticated_live_browser_verified':False}

def source_parity(commit):
 def original(path):return subprocess.check_output(['git','show',commit+':'+path],cwd=ROOT)
 for name in CRITICAL:
  path='src/'+name;ensure(original(path)==(ROOT/path).read_bytes(),'DEPLOYED_ENGINE_PARITY_REQUIRED')
 def core(data):return data.split(b'const reportFlights=',1)[1].split(b'\nfunction reportSelection',1)[0]
 ensure(core(original('src/index.ts'))==core((ROOT/'src/index.ts').read_bytes()),'DEPLOYED_REPORT_PARITY_REQUIRED')

def run(client,folder,receipt):
 now=datetime.now(timezone.utc)
 ensure(now.date().isoformat()=='2026-10-27' and os.environ.get('GITHUB_RUN_ATTEMPT','1')=='1','ONE_TIME_CONTEXT_REQUIRED')
 expected={'version_id':os.environ.get('EXPECTED_WORKER_VERSION'),'commit':os.environ.get('EXPECTED_WORKER_COMMIT')}
 ensure(re.fullmatch('[a-f0-9-]{36}',expected['version_id'] or '') and re.fullmatch('[a-f0-9]{40}',expected['commit'] or ''),'PINNED_LIVE_VERSION_REQUIRED')
 live=live_guard_deployment();ensure(live and all(live.get(k)==v for k,v in expected.items()),'LIVE_VERSION_CHANGED')
 receipt['live_before']=live;source_parity(expected['commit'])
 before=audit.collect(client);receipt['before']=before;require_snapshot(before,datetime.now(timezone.utc))
 # Build a local-only runtime. Production Worker, OAuth and Cron are untouched.
 config=json.loads((ROOT/'deploy/wrangler.production.jsonc').read_text())
 key=secrets.token_hex(32)
 local={'name':'mavi-september-loopback-operator','main':'../../scripts/september-refresh-operator.ts',
  'compatibility_date':config['compatibility_date'],'workers_dev':False,'preview_urls':False,
  'vars':{'SITE_ORIGIN':'https://mavibasim.com','D1_READ_GUARD_ENABLED':'true','AUTOMATION_ENABLED':'false'},
  'd1_databases':[{k:config['d1_databases'][0][k] for k in ('binding','database_name','database_id')}|{'remote':True}]}
 (folder/'wrangler.jsonc').write_text(json.dumps(local))
 secret=folder/'.dev.vars';secret.write_text('ADMIN_TOKEN='+key+'\n');secret.chmod(0o600)
 process=None;log=None
 try:
  log=(folder/'runtime.log').open('w')
  process=subprocess.Popen(['node','scripts/run.mjs','wrangler','dev','--config',str(folder/'wrangler.jsonc'),'--ip','127.0.0.1','--port','8793','--log-level','error'],cwd=ROOT,stdout=log,stderr=log)
  def request(path,method='GET'):
   req=urllib.request.Request('http://127.0.0.1:8793'+path,method=method,headers={'Authorization':'Bearer '+key})
   try:
    with urllib.request.urlopen(req,timeout=150) as response:raw=response.read(10_000_001)
   except urllib.error.HTTPError as error:
    try:receipt['operator_rejection']=json.loads(error.read(10000))
    except (ValueError,OSError):pass
    raise ValueError('APPLICATION_OPERATION_REJECTED') from None
   ensure(len(raw)<=10_000_000,'OPERATOR_RESPONSE_CAP');return json.loads(raw)
  ready=False
  for _ in range(45):
   ensure(process.poll() is None,'LOCAL_OPERATOR_EXITED')
   try:request('/health');ready=True;break
   except (OSError,ValueError):time.sleep(1)
  ensure(ready,'LOCAL_OPERATOR_NOT_READY')
  require_snapshot(before,datetime.now(timezone.utc))
  receipt['operator_request_attempts']=1
  value=request('/refresh','POST') # Deliberately no retry.
  receipt['checks']=verify_payload(value,before)
  # Read exact stored results, without re-invoking either writing route.
  cache_key=hashlib.sha256(('/api/performance?'+QUERY+':'+datetime.now(timezone.utc).date().isoformat()).encode()).hexdigest()
  for name,sql,params,expected_json in (
   ('report',"SELECT result_json FROM analysis_runs WHERE id=?",[value['report']['id']],value['report']),
   ('kpi',"SELECT result_json FROM api_read_cache WHERE cache_key=?",[cache_key],value['kpi'])):
   r=client.request('POST',f'/accounts/{client.account}/d1/database/{audit.DATABASE}/query',{'sql':sql,'params':params})
   ensure(r.get('ok') and isinstance(r.get('result'),list),'SAVED_RESULT_READ_FAILED')
   statements=r['result'];rows=[v for s in statements for v in s.get('results',[])]
   ensure(all(audit.integer(s.get('meta',{}).get('rows_read')) and s['meta'].get('rows_written')==0 for s in statements),'SAVED_RESULT_READONLY_COST_REQUIRED')
   ensure(sum(s['meta']['rows_read'] for s in statements)<=10,'SAVED_RESULT_LOOKUP_CAP')
   ensure(len(rows)==1 and json.loads(rows[0]['result_json'])==expected_json,'SAVED_'+name.upper()+'_MISMATCH')
   receipt['checks']['stored_'+name+'_matches_response']=True
 finally:
  if process is not None:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()
  if log is not None:log.close()
  secret.unlink(missing_ok=True)
 after=audit.collect(client);receipt['after']=after
 ensure(after.get('status')=='observed' and after.get('production_lease_valid') is True,'POSTFLIGHT_VERIFICATION_REQUIRED')
 ensure(before['september_metrics']==after['september_metrics'],'SOURCE_CHANGED_DURING_OPERATION')
 receipt['checks']['raw_metrics_unchanged_before_after']=True
 live=live_guard_deployment();ensure(live and all(live.get(k)==v for k,v in expected.items()),'LIVE_VERSION_CHANGED')
 receipt['live_after']=live;receipt['status']='verified'

def main():
 folder=ROOT/'.local/september-refresh';folder.mkdir(parents=True,exist_ok=True)
 public_key=folder/'receipt-public.pem';raw=folder/'receipt.json'
 # Reject invalid receipt keys before touching production. No private key in CI.
 try:
  decoded=base64.b64decode(os.environ.get('RECEIPT_PUBLIC_KEY',''),validate=True)
  ensure(decoded.startswith(b'-----BEGIN PUBLIC KEY-----'),'RECEIPT_KEY_REQUIRED');public_key.write_bytes(decoded)
  subprocess.run(['node','--input-type=module','-e',"import {createPublicKey} from 'node:crypto';import {readFileSync} from 'node:fs';const k=createPublicKey(readFileSync(process.argv[1]));if(k.asymmetricKeyType!=='rsa'||k.asymmetricKeyDetails.modulusLength<2048)process.exit(1)",str(public_key)],check=True,capture_output=True)
 except Exception:raise SystemExit('RECEIPT_PUBLIC_KEY_INVALID') from None
 receipt={'status':'stopped','report_month':'2026-09','operator_request_attempts':0,'worker_deploy_started':False,'migration_started':False,'google_sync_triggered':False,'public_plaintext_receipt':False}
 try:run(Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID')),folder,receipt)
 except Exception as error:receipt['failure']=str(error) if isinstance(error,ValueError) and re.fullmatch('[A-Z_]+',str(error)) else type(error).__name__
 finally:
  raw.write_text(json.dumps(receipt,ensure_ascii=False,indent=2));raw.chmod(0o600)
  try:subprocess.run(['node','scripts/operator-receipt.mjs','seal',str(raw),str(public_key),str(folder/'receipt.encrypted.json')],cwd=ROOT,check=True,capture_output=True)
  finally:raw.unlink(missing_ok=True)
 if receipt['status']!='verified':raise SystemExit('SEPTEMBER_REFRESH_STOPPED_SEE_ENCRYPTED_RECEIPT')
 print('September-only operation verified; private receipt encrypted; no Worker deployment or Google transfer.')

if __name__=='__main__':main()
