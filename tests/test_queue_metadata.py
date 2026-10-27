import json,sqlite3,sys,unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import queue_metadata as audit

TIME=datetime(2026,10,27,15,7,tzinfo=timezone.utc)
EXPECTED={'commit':'a'*40,'version_id':'11111111-1111-4111-8111-111111111111'}
class Fake:
 account='b'*32
 def __init__(self):self.calls=[];self.expired=False;self.over=False
 def request(self,method,path,body):
  self.calls.append(body);sql=body['sql']
  if 'FROM d1_quota_state' in sql:rows=[{'day':'2026-10-27','mode':'open','observed_at':TIME.isoformat(),'data_through':TIME.replace(minute=0).isoformat(),'valid_until':(TIME+timedelta(minutes=-1 if self.expired else 60)).isoformat()}]
  elif 'FROM d1_quota_ledger' in sql:rows=[{'reads':2000000 if self.over else 100,'writes':100}]
  elif sql==audit.MATRIX:rows=[{'month':m,'scope':s,'jobs':days,'expected':days,'complete':0,'eligible':days,'blocked':0} for m,days in [('2026-07',31),('2026-08',31),('2026-09',30)] for s in ('page','query')]
  else:rows=[]
  return {'ok':True,'result':[{'meta':{'rows_read':1,'rows_written':0},'results':rows}]}

class QueueTests(unittest.TestCase):
 def run_audit(self,client,usage=None,probe=None):
  with patch.object(audit,'observation',return_value=usage or {'ok':True,'mode':'open','account_reads':1000,'account_writes':100}):
   return audit.collect(client,EXPECTED,TIME,probe or (lambda:EXPECTED))
 def test_all_reads_are_bounded_prepared_selects(self):
  c=Fake();v=self.run_audit(c);self.assertEqual(v['rows_written'],0);self.assertEqual(v['statements'],4);self.assertTrue(all(x['sql'].startswith(('SELECT','WITH RECURSIVE')) for x in c.calls));self.assertEqual(sum(r['jobs'] for r in v['matrix'] if r['month']=='2026-07'),62)
 def test_expired_lease_stops_before_any_queue_read(self):
  c=Fake();c.expired=True
  with self.assertRaisesRegex(ValueError,'CURRENT_STORED_LEASE_REQUIRED'):self.run_audit(c)
  self.assertEqual(len(c.calls),1)
 def test_account_unknown_or_blocked_never_reads_d1(self):
  for usage in ({'ok':False},{'ok':True,'mode':'blocked'}):
   c=Fake()
   with self.assertRaisesRegex(ValueError,'FRESH_SAFE_ACCOUNT_REQUIRED'):self.run_audit(c,usage)
   self.assertEqual(c.calls,[])
 def test_local_budget_and_live_identity_cannot_be_bypassed(self):
  c=Fake();c.over=True
  with self.assertRaisesRegex(ValueError,'LOCAL_HEADROOM_REQUIRED'):self.run_audit(c)
  self.assertEqual(len(c.calls),2)
  c=Fake()
  with self.assertRaisesRegex(ValueError,'LIVE_VERSION_CHANGED'):self.run_audit(c,probe=lambda:{'commit':'b'*40})
  self.assertEqual(c.calls,[])
 def test_real_sql_proves_july_queue_and_newest_first_then_july(self):
  db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
  for p in sorted((Path(__file__).resolve().parents[1]/'migrations').glob('*.sql')):db.executescript(p.read_text())
  for month,days in [('2026-07',31),('2026-08',31),('2026-09',30)]:
   for day in range(1,days+1):
    for scope in ('page','query'):
     date=f'{month}-{day:02}';db.execute('INSERT INTO sync_jobs(id,provider,day,scope,generation,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(f'gsc:{date}:{scope}','gsc',date,scope,'TEST-generation','2026-10-24T00:00:00Z','2026-10-24T00:00:00Z','2026-10-24T00:00:00Z'))
  stamp='2026-10-27T15:07:00Z'
  rows=[dict(r) for r in db.execute(audit.MATRIX,(stamp,stamp))];july=[r for r in rows if r['month']=='2026-07'];self.assertEqual(sum(r['jobs'] for r in july),62);self.assertEqual(sum(r['eligible'] for r in july),62)
  self.assertEqual(db.execute(audit.NEXT,(stamp,stamp)).fetchone()['day'],'2026-09-30')
  db.execute("UPDATE sync_jobs SET status='done' WHERE day>='2026-08-01'")
  self.assertEqual(db.execute(audit.NEXT,(stamp,stamp)).fetchone()['day'],'2026-07-31')
 def test_public_key_parser_rejects_private_keys_before_encryption(self):
  import base64,tempfile
  with tempfile.TemporaryDirectory() as folder:
   invalid_header=b'-----BEGIN '+b'PRIVATE KEY-----'
   with self.assertRaisesRegex(ValueError,'PUBLIC_RECEIPT_KEY_REQUIRED'):audit.seal({},base64.b64encode(invalid_header).decode(),Path(folder))

if __name__=='__main__':unittest.main()
