import io,json,sys,unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import d1_quota_control as incident
import d1_quota_checkpoint as checkpoint
import cloudflare_diagnostics as diagnostics
TIME=datetime(2026,10,26,3,7,tzinfo=timezone.utc)
class Fake:
 account='a'*32
 def __init__(self):self.calls=[];self.crons=['* * * * *']
 def request(self,method,path,body=None):
  self.calls.append((method,path,body))
  if path.endswith('/query'):return {'ok':True,'result':[]}
  if method=='PUT':self.crons=[r['cron'] for r in body]
  return {'ok':True,'result':{'schedules':[{'cron':c} for c in self.crons]}}
class QuotaTests(unittest.TestCase):
 def response(self,reads=10000,writes=1000,latest=None):return {'ok':True,'accounts':[{'d1AnalyticsAdaptiveGroups':[{'sum':{'rowsRead':reads,'rowsWritten':writes},'dimensions':{'datetimeHour':(latest or TIME.replace(minute=0)).isoformat()}}]}]}
 def test_containment_is_verified_and_never_calls_d1(self):
  client=Fake();result=incident.contain(client);self.assertEqual(result['after'],['*/15 * * * *']);self.assertEqual(result['database_queries'],0);self.assertTrue(all('/schedules' in c[1] for c in client.calls))
 def test_containment_is_idempotent_and_rejects_unexpected_schedules(self):
  client=Fake();client.crons=['*/15 * * * *'];incident.contain(client);self.assertTrue(all(c[0]=='GET' for c in client.calls));client.crons=['0 * * * *']
  with self.assertRaisesRegex(ValueError,'UNEXPECTED'):incident.contain(client)
 def test_query_shapes_never_include_sql_literals_or_comments(self):
  s=incident.shape("SELECT 'TEST sensitive',\"TEST private\" FROM products -- TEST hidden\n WHERE id='other'");self.assertNotIn('sensitive',s);self.assertNotIn('private',s);self.assertNotIn('hidden',s);self.assertIn('products',s)
 def test_quota_before_reset_never_calls_d1_or_analytics(self):
  with patch.object(checkpoint,'observation',side_effect=AssertionError('NO_ANALYTICS')):self.assertEqual(checkpoint.checkpoint(Fake(),TIME-timedelta(days=1))['database_queries'],0)
 def test_account_filter_never_limits_to_one_database(self):
  with patch.object(checkpoint,'graphql',return_value=self.response()) as request:result=checkpoint.observation(Fake(),TIME)
  self.assertTrue(result['ok']);self.assertNotIn('databaseId',json.dumps(request.call_args.args[2]));self.assertEqual(result['account_reads'],10000)
 def test_good_observation_creates_only_one_small_checkpoint_without_resetting_ledger(self):
  client=Fake()
  with patch.object(checkpoint,'graphql',return_value=self.response()):result=checkpoint.checkpoint(client,TIME)
  self.assertTrue(result['updated']);self.assertFalse(result['local_reservations_reset']);self.assertEqual(len(client.calls),1);sql=client.calls[0][2]['sql'];self.assertNotIn('DELETE',sql);self.assertNotIn('d1_quota_ledger',sql);self.assertIn('max(d1_quota_state.account_reads',sql)
 def test_empty_groups_fail_closed_instead_of_assuming_unused_quota(self):
  with patch.object(checkpoint,'graphql',return_value={'ok':True,'accounts':[{'d1AnalyticsAdaptiveGroups':[]}]}):self.assertFalse(checkpoint.observation(Fake(),TIME)['ok'])
 def test_unavailable_analytics_never_extends_an_old_lease(self):
  client=Fake()
  with patch.object(checkpoint,'graphql',return_value={'ok':False}):result=checkpoint.checkpoint(client,TIME)
  self.assertFalse(result['updated']);self.assertEqual(client.calls,[])
 def test_account_exhaustion_never_issues_a_database_query(self):
  for reads,writes in [(3500000,0),(5000001,0),(0,85000)]:
   client=Fake()
   with patch.object(checkpoint,'graphql',return_value=self.response(reads,writes)):r=checkpoint.checkpoint(client,TIME)
   self.assertFalse(r['updated']);self.assertEqual(client.calls,[])
 def test_delayed_analytics_slows_work_and_very_old_analytics_blocks_it(self):
  with patch.object(checkpoint,'graphql',return_value=self.response(latest=TIME-timedelta(minutes=90))):self.assertEqual(checkpoint.observation(Fake(),TIME)['mode'],'slow')
  with patch.object(checkpoint,'graphql',return_value=self.response(latest=TIME-timedelta(hours=3))):self.assertFalse(checkpoint.observation(Fake(),TIME)['ok'])
 def test_future_or_yesterday_samples_are_not_current_day_evidence(self):
  for latest in (TIME+timedelta(hours=1),TIME-timedelta(days=1)):
   with patch.object(checkpoint,'graphql',return_value=self.response(latest=latest)):self.assertFalse(checkpoint.observation(Fake(),TIME)['ok'])
 def test_invalid_counters_fail_closed(self):
  for value in (-1,float('inf'),float('nan'),'0',0.5,True):
   with patch.object(checkpoint,'graphql',return_value=self.response(reads=value)):self.assertFalse(checkpoint.observation(Fake(),TIME)['ok'])
 def test_day_end_lease_cannot_cross_utc_reset(self):
  time=TIME.replace(hour=23,minute=50)
  with patch.object(checkpoint,'graphql',return_value=self.response(latest=time.replace(minute=0))):r=checkpoint.observation(Fake(),time)
  self.assertEqual(r['valid_until'],'2026-10-27T00:00:00+00:00')
 def test_failed_checkpoint_does_not_claim_a_verified_connection(self):
  client=Fake();client.request=lambda *args:{'ok':False}
  with patch.object(checkpoint,'graphql',return_value=self.response()):self.assertFalse(checkpoint.checkpoint(client,TIME)['updated'])
 def test_full_diagnostics_skip_every_application_query_when_quota_is_blocked(self):
  class Client(Fake):
   def daily_usage(self):return {'ok':True,'hours':1,'rows_read':5000001}
   def query(self,*args):raise AssertionError('NO_APPLICATION_SCAN')
  config={'name':'mavi-basim-seo-prod','d1_databases':[{'binding':'DB','database_name':'mavi-basim-seo','database_id':incident.DATABASE}]}
  r=diagnostics.collect(Client(),config);self.assertTrue(all(v['code']=='D1_READ_QUOTA_HOLD' for v in r['queries'].values()))

 def test_build_control_denials_are_identified_without_exposing_commands_or_tokens(self):
  class Denied(Fake):
   def request(self,*args):return {'ok':False,'code':'CF_HTTP_403'}
  self.assertEqual(incident.build_status(Denied())['step'],'workers-list')

 def test_hourly_monitor_waits_before_reset_without_any_request(self):
  client=Fake()
  with patch.object(checkpoint,'observation',side_effect=AssertionError('NO_ANALYTICS')):
   r=checkpoint.monitored_checkpoint(client,TIME-timedelta(days=1),True,lambda:(_ for _ in ()).throw(AssertionError('NO_PROBE')))
  self.assertEqual(r['database_queries'],0);self.assertEqual(client.calls,[])
 def test_hourly_monitor_never_uses_missing_migration_tables_before_guard_is_live(self):
  client=Fake()
  with patch.object(checkpoint,'checkpoint',side_effect=AssertionError('NO_D1_CHECKPOINT')):r=checkpoint.monitored_checkpoint(client,TIME,True,lambda:None)
  self.assertEqual(r['reason'],'LIVE_READ_GUARD_NOT_DEPLOYED');self.assertEqual(client.calls,[])
 def test_verified_live_guard_allows_a_bounded_hourly_checkpoint(self):
  client=Fake()
  with patch.object(checkpoint,'graphql',return_value=self.response()):r=checkpoint.monitored_checkpoint(client,TIME,True,lambda:{'read_guard_revision':'d1-account-reads-v1'})
  self.assertTrue(r['updated']);self.assertEqual(len(client.calls),1)
