import importlib.util
import io
import json
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cloudflare_diagnostics',ROOT/'scripts/cloudflare_diagnostics.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
ACCOUNT='a'*32
class FakeClient:
 account=ACCOUNT
 def daily_usage(self):return {'ok':False,'code':'CF_ANALYTICS_UNAVAILABLE'}
 def query(self,database,sql):return {'ok':True,'rows':[]}
 def request(self,method,path):
  if path.endswith('/settings'):return {'ok':True,'result':{'bindings':[{'name':'AUTOMATION_ENABLED','type':'plain_text','text':'true'},{'name':'GOOGLE_CLIENT_SECRET','type':'plain_text','text':'NEVER-LOG-THIS-FIXTURE'}]}}
  if path.endswith('/schedules'):return {'ok':True,'result':{'schedules':[{'cron':'*/15 * * * *'}]}}
  return {'ok':True,'result':{'deployments':[{'id':'version','annotations':{'message':'deploy '+'b'*40+' NEVER-LOG-THIS-FIXTURE'},'versions':[{'version_id':'id','percentage':100,'unsafe_extra':'NEVER-LOG-THIS-FIXTURE'}]}]}}
class DiagnosticTests(unittest.TestCase):
 def config(self):return {'name':'mavi-basim-seo-prod','d1_databases':[{'binding':'DB','database_name':'mavi-basim-seo','database_id':'12345678-1234-1234-1234-123456789abc'}]}
 def test_settings_cron_and_commit_are_sanitized(self):
  r=module.collect(FakeClient(),self.config());self.assertEqual(r['schedules']['crons'],['*/15 * * * *']);self.assertEqual(r['runtime']['flags'],{'AUTOMATION_ENABLED':'true'});self.assertNotIn('NEVER-LOG-THIS-FIXTURE',json.dumps(r));self.assertEqual(r['deployments']['versions'][0]['commit_labels'],['b'*40])
 def test_no_credentials_or_live_routes_are_accepted(self):
  with self.assertRaisesRegex(ValueError,'BINDINGS_MISSING'):module.Cloudflare('',ACCOUNT)
  config=self.config();config['routes']=['mavibasim.com/*']
  with self.assertRaisesRegex(ValueError,'SITE_ROUTE'):module.collect(FakeClient(),config)
 def test_only_literal_read_queries_are_allowed(self):
  client=module.Cloudflare('FIXTURE',ACCOUNT)
  for sql in ['DELETE FROM sync_jobs',"SELECT encrypted_tokens FROM oauth_credentials",'WITH x AS (SELECT 1) DELETE FROM sync_jobs']:
   with self.assertRaisesRegex(ValueError,'READ_ONLY_QUERY_REQUIRED'):client.query('12345678-1234-1234-1234-123456789abc',sql)
  for sql in module.QUERIES.values():self.assertTrue(sql.startswith(('SELECT ','WITH ')));self.assertNotIn('encrypted_tokens',sql)
 def test_missing_worker_permission_preserves_d1_results(self):
  class Limited(FakeClient):
   def request(self,*args):return {'ok':False,'code':'CF_HTTP_403'}
  r=module.collect(Limited(),self.config());self.assertTrue(r['queries']['jobs']['ok']);self.assertEqual(r['runtime']['code'],'CF_HTTP_403')
 def test_account_quota_is_aggregate_only_and_does_not_expose_errors(self):
  class Response(io.BytesIO):
   def __enter__(self):return self
   def __exit__(self,*args):self.close()
  class Opener:
   def open(self,request,timeout):
    self.request=request
    return Response(json.dumps({'data':{'viewer':{'accounts':[{'d1AnalyticsAdaptiveGroups':[{'sum':{'rowsRead':100,'rowsWritten':200}},{'sum':{'rowsRead':50,'rowsWritten':30}}]}]}}}).encode())
  opener=Opener();result=module.Cloudflare('FIXTURE',ACCOUNT,opener).daily_usage()
  self.assertEqual((result['rows_read'],result['rows_written']),(150,230));self.assertTrue(result['account_wide']);self.assertNotIn('databaseId',opener.request.data.decode());self.assertNotIn('FIXTURE',json.dumps(result))

 def test_rollover_requires_actual_future_time_budget_and_completed_nonempty_run(self):
  from datetime import datetime,timezone
  r={'queries':{'sync_budget_history':{'ok':True,'rows':[{'day':'2026-10-25','checked_at':'2026-10-25T00:01:00Z'}]},'recent_runs':{'ok':True,'rows':[{'status':'done','finished_at':'2026-10-25T00:02:00Z','rows_received':1}]}}}
  self.assertEqual(module.acceptance(r,datetime(2026,10,24,22,tzinfo=timezone.utc))['rollover'],'not_yet_due')
  self.assertEqual(module.acceptance(r,datetime(2026,10,25,1,tzinfo=timezone.utc))['rollover'],'verified')
  r['queries']['recent_runs']['rows'][0]['rows_received']=0
  self.assertEqual(module.acceptance(r,datetime(2026,10,25,1,tzinfo=timezone.utc))['rollover'],'waiting_for_real_progress')
 def test_incomplete_or_failed_diagnostics_never_pass_month_or_products(self):
  r=module.acceptance({'queries':{} });self.assertFalse(r['priority_coverage']['passed']);self.assertFalse(r['product_crawl']['passed']);self.assertEqual(r['monthly_report'],'blocked_missing_coverage')
