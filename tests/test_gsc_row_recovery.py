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
 def __init__(self):self.calls=[];self.db=sqlite3.connect(':memory:');self.db.row_factory=sqlite3.Row
 def request(self,method,path,body):
  self.calls.append(body);sql=body['sql']
  if sql==recovery.REQUEUE:rows=[{'id':recovery.JOB_IDS[0],'status':'pending','cursor':0,'attempts':1}]
  elif sql==recovery.READS['quota']:rows=[{'mode':'open','valid_until':(TIME+timedelta(hours=1)).isoformat()}]
  elif sql==recovery.READS['ledger']:rows=[{'reads':12000,'writes':2000}]
  else:rows=[]
  return {'ok':True,'result':[{'results':rows,'meta':{'rows_read':2,'rows_written':1 if sql==recovery.REQUEUE else 0}}]}
def live():return {'deployment':{'commit':SHA,'gsc_validation_revision':'field-reasons-v1','read_guard_revision':'d1-account-reads-v1'}}
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
  for probe in (lambda:{},lambda:{'deployment':{'commit':SHA}}):
   c=Client()
   with patch.object(recovery,'observation',return_value={'ok':True,'mode':'open'}):
    with self.assertRaisesRegex(ValueError,'NOT_LIVE'):recovery.run(c,'requeue',SHA,TIME,probe)
   self.assertEqual(len(c.calls),5)
 def test_verified_recovery_is_bounded_to_two_old_jobs(self):
  c=Client()
  with patch.object(recovery,'observation',return_value={'ok':True,'mode':'open'}):r=recovery.run(c,'requeue',SHA,TIME,live)
  self.assertEqual(len(c.calls),6);self.assertEqual(r['rows_written'],1);self.assertFalse(r['google_sync_triggered']);self.assertNotIn('encrypted_tokens',str(c.calls))
 def test_real_sql_is_idempotent_and_preserves_cursor_generation_and_attempts(self):
  db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
  db.executescript('CREATE TABLE sync_jobs(id TEXT,provider TEXT,day TEXT,scope TEXT,status TEXT,cursor INTEGER,generation TEXT,attempts INTEGER,error_code TEXT,lease_token TEXT,next_attempt_at TEXT,updated_at TEXT);CREATE TABLE d1_quota_state(day TEXT,mode TEXT,valid_until TEXT,account_reads INTEGER,account_writes INTEGER);')
  db.execute('INSERT INTO d1_quota_state VALUES(?,?,?,?,?)',('2026-10-26','open',(TIME+timedelta(hours=1)).isoformat(),100,100))
  for scope in ('page','query'):
   db.execute('INSERT INTO sync_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',('gsc:2026-08-18:'+scope,'gsc','2026-08-18',scope,'blocked',200,'keep-generation',1,'INVALID_GSC_ROW',None,'old','old'))
  params=[TIME.isoformat(),TIME.isoformat(),*recovery.JOB_IDS,'2026-10-26',TIME.isoformat()]
  self.assertEqual(len(db.execute(recovery.REQUEUE,params).fetchall()),2)
  self.assertEqual(db.execute(recovery.REQUEUE,params).fetchall(),[])
  db.execute("UPDATE sync_jobs SET status='blocked',error_code='INVALID_GSC_ROW_COUNTRY'")
  self.assertEqual(db.execute(recovery.REQUEUE,params).fetchall(),[])
  self.assertTrue(all(tuple(r)==(200,'keep-generation',1) for r in db.execute('SELECT cursor,generation,attempts FROM sync_jobs')))
