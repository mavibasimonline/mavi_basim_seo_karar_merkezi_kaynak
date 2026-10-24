import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import production_guard as guard
VERSION='12345678-1234-1234-1234-123456789abc'
class Fake:
 account='a'*32
 def __init__(self,config):self.config=config;self.changed=False;self.db_mismatch=False;self.calls=[]
 def query(self,*args):return {'ok':True,'rows':[{'products':29,'csv_files':521,'csv_rows':9075}]}
 def daily_usage(self):return {'ok':True,'hours':1,'rows_written':1000,'rows_read':1000}
 def request(self,method,path,body=None):
  self.calls.append((method,path,body))
  if method=='PUT':return {'ok':True,'result':[]}
  if path.endswith('/deployments'):return {'ok':True,'result':{'deployments':[{'created_on':'2026-10-24','versions':[{'version_id':VERSION if not self.changed else 'other','percentage':100}]}]}}
  if path.endswith('/schedules'):return {'ok':True,'result':{'schedules':[{'cron':'*/15 * * * *'}]}}
  bindings=[{'name':name,'type':'plain_text','text':value} for name,value in self.config['vars'].items()]
  bindings += [{'name':name,'type':'secret_text'} for name in ('ADMIN_TOKEN','TOKEN_ENCRYPTION_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET')]
  bindings += [{'name':'DB','type':'d1','id':'other' if self.db_mismatch else self.config['d1_databases'][0]['database_id']}]
  return {'ok':True,'result':{'bindings':bindings}}
class ProductionGuardTests(unittest.TestCase):
 def setUp(self):self.config=json.loads((ROOT/'deploy/wrangler.production.jsonc').read_text());self.client=Fake(self.config)
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
    return io.BytesIO(json.dumps({'deployment':{'commit':commit,'runtime_revision':'gsc-catchup-v1'}}).encode())
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
   def open(self,req,timeout):return io.BytesIO(json.dumps({'deployment':{'version_id':VERSION,'commit':commit,'runtime_revision':'gsc-catchup-v1'}}).encode())
  verified=guard.postflight(self.client,self.config,saved,commit,Opener());self.assertTrue(verified['existing_bindings_preserved'])
