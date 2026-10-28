import importlib.util
import io
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import production_guard as guard
VERSION='12345678-1234-1234-1234-123456789abc'
class Fake:
 account='a'*32
 def __init__(self,config):self.config=config;self.changed=False;self.db_mismatch=False;self.calls=[]
 def query(self,database,sql):return {'ok':True,'rows':[{'products':29,'csv_files':521,'csv_rows':9075}]} if sql==guard.QUERIES['source_counts'] else {'ok':True,'rows':[]}
 def daily_usage(self):return {'ok':True,'hours':1,'rows_written':1000,'rows_read':1000}
 def request(self,method,path,body=None):
  self.calls.append((method,path,body))
  if method=='PUT':return {'ok':True,'result':[]}
  if path.endswith('/deployments'):return {'ok':True,'result':{'deployments':[{'created_on':'2026-10-24','versions':[{'version_id':VERSION if not self.changed else 'other','percentage':100}]}]}}
  if '/versions/' in path:return {'ok':True,'result':{'annotations':{'workers/tag':'c'*40}}}
  if path.endswith('/schedules'):return {'ok':True,'result':{'schedules':[{'cron':'*/15 * * * *'}]}}
  bindings=[{'name':name,'type':'plain_text','text':value} for name,value in self.config['vars'].items()]
  bindings += [{'name':name,'type':'secret_text'} for name in ('ADMIN_TOKEN','TOKEN_ENCRYPTION_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET')]
  bindings += [{'name':'DB','type':'d1','id':'other' if self.db_mismatch else self.config['d1_databases'][0]['database_id']}]
  return {'ok':True,'result':{'bindings':bindings}}
class ProductionGuardTests(unittest.TestCase):
 def setUp(self):
  class Clock(datetime):
   @classmethod
   def now(cls,tz=None):return datetime(2026,10,26,3,tzinfo=timezone.utc)
  self.clock=patch.object(guard,'datetime',Clock);self.clock.start();self.addCleanup(self.clock.stop)
  self.config=json.loads((ROOT/'deploy/wrangler.production.jsonc').read_text());self.client=Fake(self.config)
 def test_preflight_is_read_only_and_records_a_usable_rollback(self):
  r=guard.preflight(self.client,self.config,VERSION);self.assertEqual(r['previous_version'],VERSION);self.assertEqual(r['previous_crons'],['*/15 * * * *']);self.assertFalse(r['schema_changes']);self.assertTrue(all(c[0]=='GET' for c in self.client.calls));self.assertNotIn('secret_value',json.dumps(r))
 def test_concurrent_operator_version_change_blocks_deployment(self):
  self.client.changed=True
  with self.assertRaisesRegex(ValueError,'VERSION_CHANGED'):guard.preflight(self.client,self.config,VERSION)
 def test_existing_d1_binding_cannot_be_replaced(self):
  self.client.db_mismatch=True
  with self.assertRaisesRegex(ValueError,'D1_BINDING_DRIFT'):guard.preflight(self.client,self.config,VERSION)
 def test_rollback_only_restores_the_recorded_cron(self):
  guard.restore_cron(self.client,{'worker':'mavi-basim-seo-prod','previous_crons':['*/15 * * * *']});self.assertEqual(self.client.calls[-1][2],[{'cron':'*/15 * * * *'}]);self.assertTrue(self.client.calls[-1][1].endswith('/schedules'))
 def test_smoke_requires_the_exact_commit_in_a_real_http_payload(self):
  commit='c'*40
  class Opener:
   def open(inner,req,timeout):
    self.assertEqual(req.get_header('User-agent'),'MaviBasimReleaseCheck/1.0')
    self.assertEqual(req.get_header('Accept'),'application/json')
    return io.BytesIO(json.dumps({'deployment':{'commit':commit,'runtime_revision':'gsc-catchup-v1','read_guard_revision':'d1-account-reads-v1'}}).encode())
  self.assertEqual(guard.smoke(commit,Opener())['commit'],commit)
  with self.assertRaisesRegex(ValueError,'COMMIT_MISMATCH'):guard.smoke('d'*40,Opener())
 def test_free_quota_can_block_release_without_mutating_any_resource(self):
  self.client.daily_usage=lambda:{'ok':True,'hours':1,'rows_written':95000,'rows_read':1000}
  with self.assertRaisesRegex(ValueError,'BUDGET_UNAVAILABLE'):guard.preflight(self.client,self.config,VERSION)
  self.assertTrue(all(c[0]=='GET' for c in self.client.calls))
 def test_missing_account_analytics_is_not_treated_as_unused_quota(self):
  self.client.daily_usage=lambda:{'ok':False}
  with self.assertRaisesRegex(ValueError,'QUOTA_READ_REQUIRED'):guard.preflight(self.client,self.config,VERSION)
 def test_postflight_checks_live_version_and_existing_auth_bindings(self):
  saved=guard.preflight(self.client,self.config,VERSION);commit='c'*40
  class Opener:
   def open(self,req,timeout):return io.BytesIO(json.dumps({'deployment':{'version_id':VERSION,'commit':commit,'runtime_revision':'gsc-catchup-v1','read_guard_revision':'d1-account-reads-v1'}}).encode())
  verified=guard.postflight(self.client,self.config,saved,commit,Opener());self.assertTrue(verified['existing_bindings_preserved'])

 def test_spent_sync_writes_are_not_reserved_twice_and_limits_do_not_change(self):
  from datetime import datetime,timezone
  day=guard.datetime.now(timezone.utc).date().isoformat();self.config['vars']['SYNC_INITIAL_BUDGET_DAY']='2000-01-01'
  original=json.dumps(self.config);query=self.client.query
  self.client.query=lambda db,sql: {'ok':True,'rows':[{'day':day,'code':'58000.0'}]} if sql==guard.QUERIES['sync_budget_history'] else query(db,sql)
  self.client.daily_usage=lambda:{'ok':True,'hours':1,'rows_written':54317,'rows_read':1000}
  usage=guard.preflight(self.client,self.config,VERSION)['daily_d1_usage']
  self.assertEqual(usage['sync_remaining_allowance'],2000);self.assertEqual(usage['projected_writes'],60000);self.assertEqual(json.dumps(self.config),original)
  self.assertTrue(all(c[0]=='GET' for c in self.client.calls))
 def test_missing_current_day_counter_keeps_the_full_allowance_reserved(self):
  self.config['vars']['SYNC_INITIAL_BUDGET_DAY']='2000-01-01';self.client.daily_usage=lambda:{'ok':True,'hours':1,'rows_written':54317,'rows_read':1000}
  with self.assertRaisesRegex(ValueError,'BUDGET_UNAVAILABLE'):guard.preflight(self.client,self.config,VERSION)
 def test_invalid_budget_counter_fails_closed(self):
  from datetime import datetime,timezone
  day=guard.datetime.now(timezone.utc).date().isoformat();query=self.client.query
  for code in ('invalid','NaN','Infinity','-1'):
   self.client.query=lambda db,sql: {'ok':True,'rows':[{'day':day,'code':code}]} if sql==guard.QUERIES['sync_budget_history'] else query(db,sql)
   with self.assertRaisesRegex(ValueError,'SYNC_BUDGET_READ_REQUIRED'):guard.preflight(self.client,self.config,VERSION)
 def test_unreadable_budget_counter_does_not_allow_a_release(self):
  query=self.client.query;self.client.query=lambda db,sql: {'ok':False} if sql==guard.QUERIES['sync_budget_history'] else query(db,sql)
  with self.assertRaisesRegex(ValueError,'SYNC_BUDGET_READ_REQUIRED'):guard.preflight(self.client,self.config,VERSION)

 def test_exhausted_analytics_never_scans_source_or_jobs(self):
  self.client.daily_usage=lambda:{'ok':True,'hours':1,'rows_written':0,'rows_read':5000001}
  self.client.query=lambda *args: self.fail('NO_D1_QUERY_BEFORE_QUOTA_CHECK')
  with self.assertRaisesRegex(ValueError,'BUDGET_UNAVAILABLE'):guard.preflight(self.client,self.config,VERSION)
 def test_release_cannot_begin_before_incident_utc_reset(self):
  class Clock(datetime):
   @classmethod
   def now(cls,tz=None):return datetime(2026,10,25,23,59,tzinfo=timezone.utc)
  with patch.object(guard,'datetime',Clock):
   with self.assertRaisesRegex(ValueError,'QUOTA_RESET_REQUIRED'):guard.preflight(self.client,self.config,VERSION)

 def test_invalid_analytics_numbers_never_allow_source_scan(self):
  for value in (float('nan'),float('inf'),-1,True,'100'):
   self.client.daily_usage=lambda:{'ok':True,'hours':1,'rows_read':value,'rows_written':0}
   self.client.query=lambda *args:self.fail('NO_D1_QUERY_WITH_INVALID_ANALYTICS')
   with self.assertRaisesRegex(ValueError,'QUOTA_READ_REQUIRED'):guard.preflight(self.client,self.config,VERSION)

 def test_failed_release_holds_cron_without_deleting_jobs_or_auth(self):
  calls=[]
  def request(method,path,body=None):
   calls.append((method,path,body));return {'ok':True,'result':{'schedules':[]}}
  self.client.request=request;guard.pause_cron(self.client);self.assertEqual(calls[0][2],[]);self.assertTrue(all(c[1].endswith('/schedules') for c in calls))
 def test_old_runtime_cannot_pass_smoke_with_a_new_commit_label_alone(self):
  class Opener:
   def open(self,req,timeout):return io.BytesIO(json.dumps({'deployment':{'commit':'c'*40,'runtime_revision':'gsc-catchup-v1'}}).encode())
  with self.assertRaisesRegex(ValueError,'COMMIT_MISMATCH'):guard.smoke('c'*40,Opener())

class ExistingSchemaTests(unittest.TestCase):
 def setUp(self):
  self.config=json.loads((ROOT/'deploy/wrangler.production.jsonc').read_text())
  self.names=sorted(p.name for p in (ROOT/'migrations').glob('*.sql'))
  self.calls=[]
  class Client:
   def query(inner,database,sql):
    self.calls.append((database,sql))
    return self.reply
   def request(inner,*args):raise AssertionError('NO_RESOURCE_WRITE_OR_DIRECT_API_CALL')
  self.client=Client();self.reply={'ok':True,'rows':[{'name':name} for name in self.names],'rows_read':len(self.names)}
 def test_existing_schema_matches_actual_local_files_with_one_fixed_read_only_select(self):
  before=json.dumps(self.config)
  result=guard.verify_schema(self.client,self.config)
  self.assertEqual(result,{'verified':True,'migrations':self.names,'database_queries':1,'rows_returned':len(self.names),'rows_read':len(self.names),'schema_changes':False,'migration_application_started':False})
  self.assertEqual(self.calls,[(self.config['d1_databases'][0]['database_id'],guard.QUERIES['migrations'])])
  self.assertTrue(self.calls[0][1].startswith('SELECT name FROM d1_migrations'))
  self.assertEqual(json.dumps(self.config),before)
 def test_a_pending_migration_blocks_release_without_applying_it(self):
  self.reply['rows']=self.reply['rows'][:-1]
  with self.assertRaisesRegex(ValueError,'SCHEMA_MISMATCH'):guard.verify_schema(self.client,self.config)
  self.assertEqual(len(self.calls),1)
 def test_unexpected_or_reordered_applied_migration_blocks_release(self):
  for names in (self.names+['0007_unapproved.sql'],list(reversed(self.names))):
   with self.subTest(names=names):
    self.reply['rows']=[{'name':name} for name in names]
    with self.assertRaisesRegex(ValueError,'SCHEMA_MISMATCH'):guard.verify_schema(self.client,self.config)
 def test_duplicate_applied_migration_is_not_accepted_as_a_matching_count(self):
  self.reply['rows'][-1]=dict(self.reply['rows'][0])
  with self.assertRaisesRegex(ValueError,'SCHEMA_MISMATCH'):guard.verify_schema(self.client,self.config)
 def test_unavailable_or_malformed_schema_response_fails_closed(self):
  for response in (None,{}, {'ok':False}, {'ok':True}, {'ok':True,'rows':None}, {'ok':True,'rows':{}}):
   with self.subTest(response=response):
    self.reply=response
    with self.assertRaisesRegex(ValueError,'SCHEMA_READ_FAILED'):guard.verify_schema(self.client,self.config)
 def test_malformed_applied_row_cannot_be_a_verified_schema(self):
  for row in (None, [], {}, {'name':None}, {'name':1}, {'name':[]}, {'name':True}):
   with self.subTest(row=row):
    self.reply={'ok':True,'rows':[row]}
    with self.assertRaisesRegex(ValueError,'SCHEMA_RECORD_INVALID'):guard.verify_schema(self.client,self.config)
 def test_empty_or_malformed_local_manifest_prevents_any_database_query(self):
  with tempfile.TemporaryDirectory() as folder:
   with self.assertRaisesRegex(ValueError,'LOCAL_SCHEMA_MANIFEST_INVALID'):guard.verify_schema(self.client,self.config,folder)
   Path(folder,'unversioned.sql').write_text('SELECT 1;')
   with self.assertRaisesRegex(ValueError,'LOCAL_SCHEMA_MANIFEST_INVALID'):guard.verify_schema(self.client,self.config,folder)
  self.assertEqual(self.calls,[])
 def test_unreviewed_production_target_prevents_schema_lookup(self):
  self.config['name']='another-worker'
  with self.assertRaisesRegex(ValueError,'PRODUCTION_CONFIG_REJECTED'):guard.verify_schema(self.client,self.config)
  self.assertEqual(self.calls,[])
 def test_production_workflow_verifies_existing_schema_and_cannot_apply_migrations(self):
  workflow=(ROOT/'.github/workflows/production.yml').read_text()
  self.assertIn('python3 scripts/production_guard.py verify-schema',workflow)
  self.assertNotIn('migrations apply',workflow)
  self.assertIn('python3 scripts/d1_quota_checkpoint.py',workflow)
  self.assertIn('python3 scripts/production_guard.py preflight',workflow)
  self.assertIn('python3 scripts/production_guard.py smoke',workflow)
