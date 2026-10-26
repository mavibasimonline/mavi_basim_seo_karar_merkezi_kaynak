import sys,unittest,sqlite3
from pathlib import Path
from unittest.mock import patch
from datetime import datetime,timezone,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import gsc_row_recovery as recovery
TIME=datetime(2026,10,26,7,tzinfo=timezone.utc)
SHA='b'*40
class Client:
 account='a'*32
 def __init__(self):
  self.calls=[]
  self.quota=[{'mode':'open','valid_until':(TIME+timedelta(hours=1)).isoformat()}]
  self.ledger=[{'reads':12000,'writes':2000}]
 def request(self,method,path,body):
  self.calls.append(body);sql=body['sql']
  if sql==recovery.REQUEUE:rows=[{'id':recovery.JOB_IDS[0],'status':'pending','cursor':0,'attempts':1}]
  elif sql==recovery.READS['quota']:rows=self.quota
  elif sql==recovery.READS['ledger']:rows=self.ledger
  else:rows=[]
  return {'ok':True,'result':[{'results':rows,'meta':{'rows_read':2,'rows_written':1 if sql==recovery.REQUEUE else 0}}]}
def live():return {'deployment':{'commit':SHA,'gsc_validation_revision':'owned-url-variants-v2','read_guard_revision':'d1-account-reads-v1'}}
def database():
 db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
 db.executescript('CREATE TABLE sync_jobs(id TEXT PRIMARY KEY,provider TEXT,day TEXT,scope TEXT,status TEXT,cursor INTEGER,generation TEXT,attempts INTEGER,error_code TEXT,lease_token TEXT,next_attempt_at TEXT,updated_at TEXT);CREATE TABLE d1_quota_state(day TEXT,mode TEXT,valid_until TEXT,account_reads INTEGER,account_writes INTEGER);')
 db.execute('INSERT INTO d1_quota_state VALUES(?,?,?,?,?)',('2026-10-26','open',(TIME+timedelta(hours=1)).isoformat(),100,100))
 return db
def add_job(db,**changes):
 row={'id':recovery.JOB_IDS[0],'provider':'gsc','day':'2026-08-18','scope':'page','status':'blocked','cursor':200,'generation':'keep-generation','attempts':2,'error_code':'INVALID_GSC_ROW_PAGE_WWW','lease_token':None,'next_attempt_at':'old','updated_at':'old'}
 row.update(changes)
 db.execute('INSERT INTO sync_jobs VALUES('+','.join('?' for _ in row)+')',list(row.values()))
def reset(db):
 return db.execute(recovery.REQUEUE,[TIME.isoformat(),TIME.isoformat(),*recovery.JOB_IDS,'2026-10-26',TIME.isoformat()]).fetchall()
class RecoveryTests(unittest.TestCase):
 def test_unknown_or_exhausted_quota_prevents_all_d1_access(self):
  for obs in ({'ok':False},{'ok':True,'mode':'blocked'},{'ok':True,'mode':'slow'}):
   c=Client()
   with patch.object(recovery,'observation',return_value=obs):
    with self.assertRaisesRegex(ValueError,'SAFE_ACCOUNT'):recovery.run(c,'requeue',SHA,TIME,live)
   self.assertEqual(c.calls,[])
 def test_read_only_inspection_never_updates_or_triggers_sync(self):
  c=Client()
  with patch.object(recovery,'observation',return_value={'ok':True,'mode':'open'}):r=recovery.run(c,'inspect',SHA,TIME)
  self.assertEqual(len(c.calls),5);self.assertTrue(all(v['sql'].startswith(('SELECT','WITH')) for v in c.calls));self.assertFalse(r['google_sync_triggered'])
 def test_old_or_wrong_live_worker_cannot_requeue_any_job(self):
  probes=[{}, {'deployment':{'commit':SHA}}]
  for field,value in [('commit','c'*40),('gsc_validation_revision','field-reasons-v1'),('read_guard_revision','old')]:
   v=live();v['deployment'][field]=value;probes.append(v)
  for value in probes:
   c=Client()
   with patch.object(recovery,'observation',return_value={'ok':True,'mode':'open'}):
    with self.assertRaisesRegex(ValueError,'NOT_LIVE'):recovery.run(c,'requeue',SHA,TIME,lambda:value)
   self.assertEqual(len(c.calls),5)
 def test_verified_recovery_is_bounded_to_two_old_jobs(self):
  c=Client()
  with patch.object(recovery,'observation',return_value={'ok':True,'mode':'open'}):r=recovery.run(c,'requeue',SHA,TIME,live)
  self.assertEqual(len(c.calls),6);self.assertEqual(r['rows_written'],1);self.assertFalse(r['google_sync_triggered']);self.assertNotIn('encrypted_tokens',str(c.calls))
 def test_real_sql_is_idempotent_and_preserves_cursor_generation_and_attempts(self):
  db=database()
  for scope in ('page','query'):
   add_job(db,id='gsc:2026-08-18:'+scope,scope=scope,error_code='INVALID_GSC_ROW_PAGE_WWW' if scope=='page' else 'INVALID_GSC_ROW_PAGE_HTTP_APEX')
  self.assertEqual(len(reset(db)),2)
  self.assertEqual(reset(db),[])
  self.assertTrue(all(tuple(r)==(200,'keep-generation',2) for r in db.execute('SELECT cursor,generation,attempts FROM sync_jobs')))
 def test_real_sql_never_reopens_generic_metric_scope_or_new_failure_codes(self):
  for code in ('INVALID_GSC_ROW','INVALID_GSC_ROW_COUNTRY','INVALID_GSC_ROW_COUNTS','INVALID_GSC_ROW_CTR_RATIO','INVALID_GSC_ROW_PAGE_PROPERTY_SCOPE','INVALID_GSC_ROW_PAGE_ORIGIN','DUPLICATE_GSC_ROW','GOOGLE_HTTP_429','NETWORK_UNAVAILABLE','GSC_OWNED_URL_RECOVERY_RETRY',None):
   with self.subTest(code=code):
    db=database();add_job(db,error_code=code)
    before=[tuple(r) for r in db.execute('SELECT * FROM sync_jobs')]
    self.assertEqual(reset(db),[])
    self.assertEqual([tuple(r) for r in db.execute('SELECT * FROM sync_jobs')],before)
 def test_real_sql_cannot_reset_another_job_or_inconsistent_incident_identity(self):
  for change in ({'id':'gsc:2026-08-19:page'},{'provider':'ga4'},{'day':'2026-08-19'},{'scope':'organic'},{'scope':'query'},{'lease_token':'TEST active lease'},{'status':'running'},{'status':'done'},{'status':'retry'},{'status':'pending'}):
   with self.subTest(change=change):
    db=database();add_job(db,**change)
    before=[tuple(r) for r in db.execute('SELECT * FROM sync_jobs')]
    self.assertEqual(reset(db),[])
    self.assertEqual([tuple(r) for r in db.execute('SELECT * FROM sync_jobs')],before)
 def test_real_sql_fails_closed_when_account_quota_lease_is_not_safe(self):
  for field,value in [('mode','slow'),('mode','blocked'),('valid_until',TIME.isoformat()),('valid_until',(TIME-timedelta(seconds=1)).isoformat()),('day','2026-10-25'),('account_reads',3500000),('account_writes',85000)]:
   with self.subTest(field=field,value=value):
    db=database();add_job(db)
    db.execute('UPDATE d1_quota_state SET '+field+'=?',[value])
    self.assertEqual(reset(db),[])
    self.assertEqual(db.execute('SELECT status FROM sync_jobs').fetchone()[0],'blocked')
 def test_real_sql_missing_quota_lease_prevents_recovery(self):
  db=database();add_job(db);db.execute('DELETE FROM d1_quota_state')
  self.assertEqual(reset(db),[])
 def test_a_second_v2_failure_stays_blocked_without_another_retry(self):
  db=database();add_job(db)
  self.assertEqual(len(reset(db)),1)
  for code in ('INVALID_GSC_ROW_PAGE_PROPERTY_SCOPE','INVALID_GSC_ROW_PAGE_ORIGIN','INVALID_GSC_ROW_CTR_RATIO','GOOGLE_HTTP_429'):
   db.execute("UPDATE sync_jobs SET status='blocked',attempts=3,error_code=?",[code])
   self.assertEqual(reset(db),[])
   self.assertEqual(tuple(db.execute('SELECT status,attempts,error_code FROM sync_jobs').fetchone()),('blocked',3,code))
 def test_current_quota_lease_is_required_before_any_update(self):
  for state in ([],[{'mode':'blocked','valid_until':(TIME+timedelta(hours=1)).isoformat()}],[{'mode':'open','valid_until':TIME.isoformat()}],[{'mode':'open','valid_until':(TIME-timedelta(seconds=1)).isoformat()}]):
   c=Client();c.quota=state
   with patch.object(recovery,'observation',return_value={'ok':True,'mode':'open'}):
    with self.assertRaisesRegex(ValueError,'CURRENT_QUOTA_LEASE'):recovery.run(c,'requeue',SHA,TIME,live)
   self.assertFalse(any(q['sql']==recovery.REQUEUE for q in c.calls))
 def test_local_ledger_headroom_is_required_before_any_update(self):
  for ledger in ([],[{'reads':1900001,'writes':0}],[{'reads':0,'writes':64001}]):
   c=Client();c.ledger=ledger
   with patch.object(recovery,'observation',return_value={'ok':True,'mode':'open'}):
    with self.assertRaisesRegex(ValueError,'LOCAL_QUOTA_HEADROOM'):recovery.run(c,'requeue',SHA,TIME,live)
   self.assertFalse(any(q['sql']==recovery.REQUEUE for q in c.calls))
 def test_invalid_release_sha_never_allows_update(self):
  for sha in (None,'','main','b'*39,'B'*40):
   c=Client()
   with patch.object(recovery,'observation',return_value={'ok':True,'mode':'open'}):
    with self.assertRaisesRegex(ValueError,'EXACT_RELEASE_COMMIT'):recovery.run(c,'requeue',sha,TIME,live)
   self.assertFalse(any(q['sql']==recovery.REQUEUE for q in c.calls))
