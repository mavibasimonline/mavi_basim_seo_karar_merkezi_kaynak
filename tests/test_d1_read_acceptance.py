import sys,unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import d1_read_acceptance as audit
TIME=datetime(2026,10,26,3,7,tzinfo=timezone.utc)
class Client:
 account='a'*32
 def __init__(self):self.calls=0;self.manual=False;self.missing_meta=False;self.no_index=False
 def request(self,method,path,body):
  self.calls+=1;sql=body['sql']
  if 'FROM d1_quota_state' in sql:rows=[{'mode':'open','valid_until':(TIME+timedelta(hours=1)).isoformat()}]
  elif 'FROM d1_quota_ledger' in sql:rows=[{'reads':10000,'writes':1000}]
  elif 'FROM sync_runs' in sql:rows=[{'status':'done','trigger_source':'manual' if self.manual else 'cron','finished_at':TIME.isoformat(),'rows_received':200}]
  elif sql.startswith('EXPLAIN'):rows=[{'detail':'SCAN d' if self.no_index else 'SEARCH c USING COVERING INDEX coverage_active; SEARCH d USING INDEX key; SEARCH analysis_runs USING INDEX report_cache_lookup'}]
  else:rows=[]
  return {'ok':True,'result':[{'results':rows,'meta':{} if self.missing_meta else {'rows_read':2}}]}
class AcceptanceTests(unittest.TestCase):
 def test_before_reset_no_application_query_is_executed(self):
  c=Client();self.assertFalse(audit.collect(c,TIME-timedelta(days=1))['passed']);self.assertEqual(c.calls,0)
 def test_missing_account_usage_does_not_claim_acceptance(self):
  c=Client()
  with patch.object(audit,'observation',return_value={'ok':False}):self.assertFalse(audit.collect(c,TIME)['passed'])
  self.assertEqual(c.calls,0)
 def test_success_requires_real_costs_fresh_quota_indexes_and_automatic_nonempty_run(self):
  with patch.object(audit,'observation',return_value={'ok':True,'mode':'open'}):r=audit.collect(Client(),TIME)
  self.assertTrue(r['passed']);self.assertEqual(r['rows_read_by_acceptance'],14);self.assertFalse(r['google_sync_triggered']);self.assertFalse(r['site_crawl_triggered'])
 def test_manual_pilot_cannot_be_claimed_as_automatic_cron_progress(self):
  c=Client();c.manual=True
  with patch.object(audit,'observation',return_value={'ok':True,'mode':'open'}):self.assertFalse(audit.collect(c,TIME)['passed'])
 def test_missing_row_cost_metadata_fails_closed(self):
  c=Client();c.missing_meta=True
  with patch.object(audit,'observation',return_value={'ok':True,'mode':'open'}):self.assertFalse(audit.collect(c,TIME)['passed'])
 def test_fact_table_scan_does_not_pass_index_acceptance(self):
  c=Client();c.no_index=True
  with patch.object(audit,'observation',return_value={'ok':True,'mode':'open'}):self.assertFalse(audit.collect(c,TIME)['passed'])
