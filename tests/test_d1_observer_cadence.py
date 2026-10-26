import json,sys,unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import d1_quota_checkpoint as quota

TIME=datetime(2026,10,26,21,7,tzinfo=timezone.utc)
class Client:
 account='a'*32
 def __init__(self):self.calls=[]
 def request(self,method,path,body):
  self.calls.append((method,path,body))
  return {'ok':True,'result':[]}
def analytics(reads=10000,writes=1000):
 return {'ok':True,'accounts':[{'d1AnalyticsAdaptiveGroups':[{'sum':{'rowsRead':reads,'rowsWritten':writes},'dimensions':{'datetimeHour':TIME.replace(minute=0).isoformat()}}]}]}
def probe():return {'read_guard_revision':'d1-account-reads-v1'}

class ObserverCadenceTests(unittest.TestCase):
 def test_primary_and_manual_checks_retain_acceptance_but_fallback_only_renews(self):
  for event,schedule,due in [('workflow_dispatch','',True),('schedule','7 * * * *',True),('schedule','22,37,52 * * * *',False)]:
   with self.subTest(event=event,schedule=schedule):
    client=Client()
    with patch.object(quota,'graphql',return_value=analytics()):r=quota.observer_checkpoint(client,event,schedule,TIME,probe)
    self.assertTrue(r['updated']);self.assertIs(r['acceptance_due'],due)
    self.assertEqual(len(client.calls),1);method,path,body=client.calls[0]
    self.assertEqual(method,'POST');self.assertIn('/d1/database/',path)
    self.assertTrue(body['sql'].startswith('INSERT INTO d1_quota_state'))
    self.assertNotIn('sync_jobs',body['sql']);self.assertNotIn('d1_quota_ledger',body['sql'])
    self.assertFalse(r['local_reservations_reset'])
    self.assertEqual(r['observation']['valid_until'],(TIME+timedelta(minutes=75)).isoformat())
 def test_unreviewed_events_or_rules_cannot_probe_or_query_any_resource(self):
  for event,schedule in [('push',''),('pull_request',''),('schedule','* * * * *'),('schedule',''),('workflow_dispatch','7 * * * *'),(None,None)]:
   client=Client()
   with patch.object(quota,'graphql',side_effect=AssertionError('NO_ANALYTICS')):
    with self.assertRaisesRegex(ValueError,'UNREVIEWED_QUOTA_OBSERVER_EVENT'):
     quota.observer_checkpoint(client,event,schedule,TIME,lambda:(_ for _ in ()).throw(AssertionError('NO_WORKER_PROBE')))
   self.assertEqual(client.calls,[])
 def test_fallback_keeps_hard_limits_and_missing_analytics_fail_closed(self):
  for response in ({'ok':False},analytics(reads=3500000),analytics(writes=85000)):
   client=Client()
   with patch.object(quota,'graphql',return_value=response):r=quota.observer_checkpoint(client,'schedule','22,37,52 * * * *',TIME,probe)
   self.assertFalse(r['updated']);self.assertFalse(r['acceptance_due']);self.assertEqual(client.calls,[])
 def test_fallback_cannot_renew_when_real_worker_guard_is_unverified(self):
  client=Client()
  with patch.object(quota,'graphql',side_effect=AssertionError('NO_ANALYTICS')):r=quota.observer_checkpoint(client,'schedule','22,37,52 * * * *',TIME,lambda:None)
  self.assertEqual(r['reason'],'LIVE_READ_GUARD_NOT_DEPLOYED');self.assertFalse(r['acceptance_due']);self.assertEqual(client.calls,[])
 def test_workflow_keeps_15_minute_worker_cron_and_hourly_heavy_acceptance(self):
  workflow=(ROOT/'.github/workflows/d1-read-quota.yml').read_text()
  self.assertIn("cron: '7 * * * *'",workflow);self.assertIn("cron: '22,37,52 * * * *'",workflow)
  self.assertIn("steps.usage.outputs.acceptance_due == 'true'",workflow)
  config=json.loads((ROOT/'deploy/wrangler.production.jsonc').read_text())
  self.assertEqual(config['triggers']['crons'],['*/15 * * * *'])
  self.assertEqual(config['vars']['D1_READ_GUARD_ENABLED'],'true');self.assertEqual(config['vars']['SYNC_MAX_PAGES_PER_TICK'],'1')

if __name__=='__main__':unittest.main()
