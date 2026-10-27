import sys,unittest
from pathlib import Path
from datetime import datetime,timezone,timedelta
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import pr30_rollover_gate as gate
class Fake:
 account='fixture'
 def __init__(self,row):self.row=row;self.calls=[]
 def request(self,*args):self.calls.append(args);return {'ok':True,'result':[{'results':[] if self.row is None else [self.row]}]}
class GateTests(unittest.TestCase):
 def setUp(self):
  self.now=datetime(2026,10,28,0,10,tzinfo=timezone.utc)
  self.row=dict(day='2026-10-28',observed_at=self.now.isoformat(),data_through=self.now.isoformat(),valid_until=(self.now+timedelta(minutes=75)).isoformat(),mode='open',account_reads=1000,account_writes=1000,reads=500,writes=200)
 def test_before_rollover_performs_no_request(self):
  c=Fake(self.row)
  with self.assertRaisesRegex(ValueError,'WAIT_FOR_NATURAL'):gate.verify(c,self.now-timedelta(hours=1))
  self.assertEqual(c.calls,[])
 def test_fresh_natural_day_only_selects_and_never_resets(self):
  c=Fake(self.row);self.assertTrue(gate.verify(c,self.now)['passed']);self.assertTrue(c.calls[0][2]['sql'].startswith('SELECT '));self.assertEqual(c.calls[0][2]['params'],['2026-10-28'])
 def test_missing_new_ledger_is_not_assumed_to_be_zero(self):
  with self.assertRaisesRegex(ValueError,'NEW_DAY'):gate.verify(Fake(None),self.now)
 def test_old_day_expired_lease_and_insufficient_headroom_fail_closed(self):
  for k,v in [('day','2026-10-27'),('valid_until',self.now.isoformat()),('mode','blocked'),('reads',1000001),('writes',60001),('account_reads',3000000),('data_through',(self.now-timedelta(hours=3)).isoformat()),('reads',True)]:
   with self.subTest(k=k,v=v),self.assertRaises(ValueError):gate.verify(Fake({**self.row,k:v}),self.now)

class RollbackTests(unittest.TestCase):
 def test_rollback_checks_schedule_without_any_schedule_write(self):
  class Client:
   account='fixture'
   def request(self,method,path):
    assert method=='GET'
    return {'ok':True,'result':{'schedules':[{'cron':'*/15 * * * *'}]}}
  self.assertTrue(gate.verify_rollback_cron(Client(),{'previous_crons':['*/15 * * * *']})['cron_preserved'])
  with self.assertRaisesRegex(ValueError,'CRON_DRIFT'):gate.verify_rollback_cron(Client(),{'previous_crons':[]})
