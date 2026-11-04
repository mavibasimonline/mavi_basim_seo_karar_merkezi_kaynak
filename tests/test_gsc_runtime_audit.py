import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import gsc_runtime_audit as audit

class RuntimeAuditTests(unittest.TestCase):
 def fixture(self):
  status={'connected':True,'reauthorization_required':False,'coverage':[],
          'covered_scopes':0,'expected_scopes':14,'last_attempt':{'at':'2026-11-03T23:45:00Z','status':'held','code':'GSC_HTTP_400'},'pending':None,'d1_requests':0}
  return {'ok':True,'observed_at':'2026-11-03T23:50:00Z','manual_ticks':0,
          'before':copy.deepcopy(status),'after':copy.deepcopy(status),'attempts':[],
          'readback':{'available':False,'d1_requests':0},'d1_requests':0}

 def test_zero_coverage_is_valid_evidence_of_missing_data(self):
  proof=self.fixture()
  self.assertEqual(audit.sanitize(proof),proof)
  self.assertEqual(proof['after']['last_attempt']['code'],'GSC_HTTP_400')

 def test_rejects_unexpected_secrets_or_private_source_fields(self):
  for location in ('root','coverage','last','pending','attempt','readback'):
   with self.subTest(location=location):
    proof=self.fixture()
    if location=='root':proof['access_token']='fixture-secret'
    if location=='coverage':
     proof['after']['coverage']=[dict(day='2026-10-31',scope='query',rows=2,captured_at='2026-11-03T23:30:00Z',query_partial=True,query='private query')]
     proof['after']['covered_scopes']=1
    if location=='last':proof['after']['last_attempt']['body']='private response'
    if location=='pending':proof['after']['pending']={'day':'2026-10-31','scope':'page','cursor':0,'refresh_token':'fixture-secret'}
    if location=='attempt':proof['attempts']=[{'status':'held','code':'GSC_HTTP_400','raw':'private','d1_requests':0}];proof['manual_ticks']=1
    if location=='readback':proof['readback']['rows_data']=['private']
    with self.assertRaises(ValueError):audit.sanitize(proof)

 def test_rejects_invalid_counts_codes_and_duplicate_days(self):
  for field,value in [('code','GSC_HTTP_400 token=secret'),('status','untrusted'),('at','token-value')]:
   proof=self.fixture();proof['after']['last_attempt'][field]=value
   with self.assertRaises(ValueError):audit.sanitize(proof)
  for value in (1,False,None):
   proof=self.fixture();proof['d1_requests']=value
   with self.assertRaises(ValueError):audit.sanitize(proof)
  proof=self.fixture();row=dict(day='2026-10-31',scope='page',rows=5,captured_at='2026-11-03T23:30:00Z',query_partial=False)
  proof['after']['coverage']=[row,row];proof['after']['covered_scopes']=2
  with self.assertRaisesRegex(ValueError,'DUPLICATE'):audit.sanitize(proof)

 def test_authentication_and_tick_limit_are_mandatory(self):
  request=audit.probe_request('fixture-key')
  self.assertEqual(request.full_url,'http://127.0.0.1:8802/?ticks=0')
  self.assertEqual(request.get_header('Authorization'),'Bearer fixture-key')
  self.assertEqual(request.get_header('User-agent'),'MaviBasimReleaseCheck/1.0')
  for value in (-1,5,True,0.5,'1'):
   with self.assertRaises(ValueError):audit.probe_request('fixture',value)

 def test_wrong_branch_stops_before_network_or_preview(self):
  with patch.dict(audit.os.environ,{'GITHUB_REF':'refs/heads/other'}),patch.object(audit,'Cloudflare') as client,patch.object(audit,'probe') as preview:
   with self.assertRaisesRegex(ValueError,'MAIN_REQUIRED'):audit.run()
   client.assert_not_called();preview.assert_not_called()

 def test_only_categorized_failure_codes_can_be_logged(self):
  self.assertEqual(audit.safe_code('GSC_HTTP_400'),'GSC_HTTP_400')
  for value in ('secret token','GOOGLE_SECRET','GSC_HTTP_400 private',None,{},'GSC_'+'A'*101):
   self.assertEqual(audit.safe_code(value),'GSC_AUDIT_UNAVAILABLE')

 def test_workflow_requires_successful_exact_main_ci_and_no_production_deploy(self):
  source=(ROOT/'.github/workflows/gsc-runtime-audit.yml').read_text()
  self.assertIn("github.event.workflow_run.conclusion == 'success'",source)
  self.assertIn("github.event.workflow_run.event == 'push'",source)
  self.assertIn(audit.TITLE,source)
  self.assertNotIn('pull_request:',source)
  self.assertNotIn('wrangler deploy',source)
  self.assertIn('python3 scripts/gsc_runtime_audit.py\n',source)

if __name__=='__main__':unittest.main()
