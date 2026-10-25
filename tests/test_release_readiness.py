import io,json,sys,unittest,urllib.error
from datetime import datetime,timezone,timedelta
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import release_readiness as ready
from d1_quota_checkpoint import NOT_BEFORE
SHA='c'*40
VERSION='12345678-1234-1234-1234-123456789abc'
TIME=NOT_BEFORE+timedelta(minutes=17)
class Client:
 account='a'*32
 def __init__(self):self.calls=[];self.versions=[{'version_id':VERSION,'percentage':100}]
 def request(self,method,path):
  self.calls.append((method,path));return {'ok':True,'result':{'deployments':[{'created_on':TIME.isoformat(),'versions':self.versions}]}}
 def query(self,*args):raise AssertionError('NO_D1_QUERY_IN_READINESS')
class ReleaseReadinessTests(unittest.TestCase):
 def setUp(self):self.client=Client();self.head=SHA;self.run={'head_sha':SHA,'head_branch':'main','event':'push','status':'completed','conclusion':'success'};self.health=lambda:None
 def github(self,path):return {'commit':{'sha':self.head}} if path=='/branches/main' else {'workflow_runs':[self.run]}
 def plan(self,event='schedule',previous=None,time=TIME,health=None):return ready.readiness(self.client,SHA,event,previous,time,self.github,health or self.health)
 def test_reset_time_blocks_before_any_network_or_application_sql(self):
  with self.assertRaisesRegex(ValueError,'QUOTA_RESET_REQUIRED'):self.plan(time=NOT_BEFORE-timedelta(seconds=1))
  self.assertEqual(self.client.calls,[])
 def test_scheduled_run_resolves_a_real_100_percent_version_after_exact_ci(self):
  r=self.plan();self.assertTrue(r['needed']);self.assertEqual(r['previous_version'],VERSION);self.assertEqual(r['database_queries'],0);self.assertTrue(all(m=='GET' and p.endswith('/deployments') for m,p in self.client.calls))
 def test_manual_run_keeps_required_version_pin_and_rejects_concurrent_change(self):
  self.assertTrue(self.plan('workflow_dispatch',VERSION)['needed'])
  with self.assertRaisesRegex(ValueError,'PRODUCTION_VERSION_CHANGED'):self.plan('workflow_dispatch','f'*8+'-1234-1234-1234-123456789abc')
 def test_manual_run_never_silently_discovers_an_unapproved_version(self):
  with self.assertRaisesRegex(ValueError,'PREVIOUS_VERSION_REQUIRED'):self.plan('workflow_dispatch')
 def test_an_old_or_failed_or_pending_or_other_branch_ci_never_authorizes_release(self):
  for field,value in [('head_sha','d'*40),('head_branch','feature'),('event','pull_request'),('conclusion','failure'),('status','in_progress')]:
   with self.subTest(field=field):
    original=dict(self.run);self.run[field]=value
    with self.assertRaisesRegex(ValueError,'EXACT_MAIN_CI_REQUIRED'):self.plan()
    self.run=original
  self.assertEqual(self.client.calls,[])
 def test_superseded_commit_is_rejected_before_cloudflare_or_d1(self):
  self.head='d'*40
  with self.assertRaisesRegex(ValueError,'SUPERSEDED'):self.plan()
  self.assertEqual(self.client.calls,[])
 def test_split_traffic_does_not_guess_rollback_target(self):
  self.client.versions=[{'version_id':VERSION,'percentage':50},{'version_id':'e'*36,'percentage':50}]
  with self.assertRaisesRegex(ValueError,'SINGLE_PRODUCTION_VERSION_REQUIRED'):self.plan()
 def test_already_verified_release_does_not_repeat_migrations_or_publish(self):
  live=lambda:{'version_id':VERSION,'commit':SHA,'read_guard_revision':ready.READ_GUARD_REVISION}
  r=self.plan(health=live);self.assertFalse(r['needed']);self.assertEqual(r['reason'],'ALREADY_PUBLISHED');self.assertTrue(r['production_acceptance_pending'])
 def test_matching_old_code_without_read_guard_revision_is_not_accepted_as_released(self):
  live=lambda:{'version_id':VERSION,'commit':SHA}
  self.assertTrue(self.plan(health=live)['needed'])
 def test_later_years_do_not_restart_the_one_time_incident_release(self):
  r=self.plan(time=TIME.replace(year=2027));self.assertFalse(r['needed']);self.assertEqual(self.client.calls,[])
 def test_published_version_drift_is_not_claimed_as_the_requested_release(self):
  live=lambda:{'version_id':'f'*8+'-1234-1234-1234-123456789abc','commit':SHA,'read_guard_revision':ready.READ_GUARD_REVISION}
  self.assertTrue(self.plan(health=live)['needed'])
 def test_live_guard_probe_requires_real_revision_commit_and_version(self):
  class Opener:
   def __init__(self,payload):self.payload=payload
   def open(self,request,timeout):return io.BytesIO(json.dumps(self.payload).encode())
  valid={'ok':True,'deployment':{'read_guard_revision':ready.READ_GUARD_REVISION,'commit':SHA,'version_id':VERSION}}
  self.assertEqual(ready.live_guard_deployment(Opener(valid))['commit'],SHA)
  for field in ('read_guard_revision','commit','version_id'):
   invalid=json.loads(json.dumps(valid));invalid['deployment'].pop(field);self.assertIsNone(ready.live_guard_deployment(Opener(invalid)))
 def test_transport_errors_never_print_response_bodies_or_credentials(self):
  class Opener:
   def open(self,*args,**kwargs):raise urllib.error.HTTPError('https://api.github.com/',403,'TEST secret body',{},io.BytesIO(b'TEST private token'))
  with self.assertRaisesRegex(ValueError,'RELEASE_OBSERVATION_UNAVAILABLE') as error:ready.get_json('https://api.github.com/',opener=Opener())
  self.assertNotIn('private',str(error.exception));self.assertNotIn('secret',str(error.exception))
