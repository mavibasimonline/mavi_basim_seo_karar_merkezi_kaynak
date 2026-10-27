"""Bounded SELECT-only queue audit. Private receipt; never claims/updates jobs."""
import base64,json,os,re,subprocess,tempfile
from datetime import datetime,timedelta,timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from d1_quota_checkpoint import observation
from d1_quota_control import DATABASE
from release_readiness import live_guard_deployment

MATRIX="""WITH RECURSIVE days(day) AS (SELECT '2026-07-01' UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<'2026-09-30'),scopes(scope) AS (VALUES('page'),('query'))
 SELECT substr(d.day,1,7) month,s.scope,count(*) expected,
 sum(j.id IS NOT NULL) jobs,sum(j.status='pending') pending,sum(j.status='retry') retry,
 sum(j.status='running') running,sum(j.status='blocked') blocked,sum(j.status='done') done,
 sum(CASE WHEN (j.status IN ('pending','retry') AND j.next_attempt_at<=?) OR (j.status='running' AND j.lease_until<?) THEN 1 ELSE 0 END) eligible,
 sum(CASE WHEN c.complete=1 THEN 1 ELSE 0 END) complete,min(j.day) first_job,max(j.day) last_job
 FROM days d CROSS JOIN scopes s LEFT JOIN sync_jobs j ON j.provider='gsc' AND j.day=d.day AND j.scope=s.scope
 LEFT JOIN dataset_coverage c ON c.provider='gsc' AND c.day=d.day AND c.scope=s.scope
 GROUP BY month,s.scope ORDER BY month,s.scope"""
NEXT="""SELECT id,day,scope,status,cursor,attempts,error_code FROM sync_jobs
 WHERE provider='gsc' AND day BETWEEN '2026-07-01' AND '2026-09-30'
 AND ((status IN ('pending','retry') AND next_attempt_at<=?) OR (status='running' AND lease_until<?))
 ORDER BY day DESC,provider,scope LIMIT 1"""

def ensure(ok,code):
 if not ok:raise ValueError(code)

def instant(value):
 try:
  v=datetime.fromisoformat(value.replace('Z','+00:00'))
  return v if v.tzinfo else None
 except (ValueError,AttributeError):return None

def collect(client,expected,now=None,probe=live_guard_deployment):
 now=now or datetime.now(timezone.utc);day=now.date().isoformat();stamp=now.isoformat().replace('+00:00','Z')
 ensure(re.fullmatch('[a-f0-9]{40}',expected.get('commit','')) and re.fullmatch('[a-f0-9-]{36}',expected.get('version_id','')),'PINNED_LIVE_VERSION_REQUIRED')
 live=probe();ensure(live and all(live.get(k)==v for k,v in expected.items()),'LIVE_VERSION_CHANGED')
 usage=observation(client,now);ensure(usage.get('ok') and usage.get('mode')=='open','FRESH_SAFE_ACCOUNT_REQUIRED')
 out={'observed_at':now.isoformat(),'status':'read_only','account_usage':usage,'rows_read':0,'rows_written':0,'statements':0,'google_sync_triggered':False,'site_crawl_triggered':False,'report_generated':False}
 def query(sql,params):
  ensure(sql.startswith(('SELECT','WITH RECURSIVE')),'SELECT_ONLY_REQUIRED')
  r=client.request('POST',f'/accounts/{client.account}/d1/database/{DATABASE}/query',{'sql':sql,'params':params})
  ensure(r.get('ok') and isinstance(r.get('result'),list),'METADATA_QUERY_FAILED')
  for s in r['result']:
   m=s.get('meta',{});ensure(type(m.get('rows_read')) is int and m['rows_read']>=0 and m.get('rows_written')==0,'SELECT_COST_REQUIRED');out['rows_read']+=m['rows_read']
  out['statements']+=1;ensure(out['rows_read']<=5000,'METADATA_READ_CAP')
  return [v for s in r['result'] for v in s.get('results',[])]
 quota=query('SELECT day,observed_at,data_through,valid_until,mode FROM d1_quota_state WHERE day=?',[day])
 q=quota[0] if len(quota)==1 else {}
 ensure(q.get('day')==day and q.get('mode')=='open' and instant(q.get('valid_until')) and instant(q['valid_until'])>now+timedelta(minutes=2)
  and instant(q.get('observed_at')) and timedelta(0)<=now-instant(q['observed_at'])<=timedelta(minutes=75)
  and instant(q.get('data_through')) and timedelta(0)<=now-instant(q['data_through'])<=timedelta(hours=2),'CURRENT_STORED_LEASE_REQUIRED')
 ledger=query('SELECT reads,writes FROM d1_quota_ledger WHERE day=?',[day])
 ensure(len(ledger)==1 and type(ledger[0]['reads']) is int and type(ledger[0]['writes']) is int and 0<=ledger[0]['reads']<1900000 and 0<=ledger[0]['writes']<64000 and usage['account_reads']+ledger[0]['reads']+5000<3400000 and usage['account_writes']+ledger[0]['writes']<84000,'LOCAL_HEADROOM_REQUIRED')
 matrix=query(MATRIX,[stamp,stamp]);ensure(len(matrix)==6 and {(v['month'],v['scope']) for v in matrix}=={(m,s) for m in ('2026-07','2026-08','2026-09') for s in ('page','query')},'MATRIX_REQUIRED')
 out.update(quota=quota[0],ledger=ledger[0],matrix=matrix,next_history_job=query(NEXT,[stamp,stamp]),live=live)
 return out

def seal(receipt,public_key,folder):
 key=base64.b64decode(public_key,validate=True)
 ensure(len(key)<5000 and key.startswith(b'-----BEGIN PUBLIC KEY-----'),'PUBLIC_RECEIPT_KEY_REQUIRED')
 folder.mkdir(parents=True,exist_ok=True)
 public=folder/'receipt-public.pem';public.write_bytes(key)
 output=folder/'queue-receipt.encrypted.json'
 with tempfile.NamedTemporaryFile(mode='w',dir=folder,suffix='.private',delete=False) as tmp:
  private=Path(tmp.name);json.dump(receipt,tmp)
 try:
  subprocess.run(['node','scripts/operator-receipt.mjs','seal',str(private),str(public),str(output)],check=True,capture_output=True)
 finally:private.unlink(missing_ok=True);public.unlink(missing_ok=True)
 return output

if __name__=='__main__':
 receipt={}
 try:
  # Validate the PUBLIC receipt key before any external request.
  key=os.environ.get('RECEIPT_PUBLIC_KEY','');decoded=base64.b64decode(key,validate=True)
  ensure(decoded.startswith(b'-----BEGIN PUBLIC KEY-----') and len(decoded)<5000,'PUBLIC_RECEIPT_KEY_REQUIRED')
  receipt=collect(Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'),os.environ.get('CLOUDFLARE_ACCOUNT_ID')),{'commit':os.environ.get('EXPECTED_WORKER_COMMIT',''),'version_id':os.environ.get('EXPECTED_WORKER_VERSION','')})
  seal(receipt,key,Path('.local/queue-metadata'))
  print(json.dumps({'verified_read_only':True,'private_receipt_encrypted':True}))
 except Exception as e:
  code=str(e) if isinstance(e,ValueError) and re.fullmatch('[A-Z_]+',str(e)) else 'QUEUE_INSPECTION_UNAVAILABLE'
  raise SystemExit(code+'; no retry, sync, report or data write started')
