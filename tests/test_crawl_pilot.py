import copy
import json
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import crawl_pilot
class CrawlPilotTests(unittest.TestCase):
 def setUp(self):self.config=json.loads((ROOT/'deploy/wrangler.production.jsonc').read_text())
 def test_local_pilot_reuses_same_database_without_public_triggers_google_or_secrets(self):
  r=crawl_pilot.pilot_config(self.config);self.assertEqual(r['d1_databases'][0]['database_id'],self.config['d1_databases'][0]['database_id']);self.assertTrue(r['d1_databases'][0]['remote']);self.assertFalse(r['workers_dev']);self.assertNotIn('triggers',r);self.assertNotIn('AUTOMATION_ENABLED',r['vars']);self.assertNotIn('GOOGLE_CLIENT_SECRET',json.dumps(r))
 def test_site_routes_or_wrong_database_are_rejected(self):
  self.config['routes']=['mavibasim.com/*']
  with self.assertRaisesRegex(ValueError,'CONFIG_REJECTED'):crawl_pilot.pilot_config(self.config)
 def test_acceptance_requires_both_real_url_verification_stamps(self):
  state={'targets':[{'id':p,'canonical_url':'https://mavibasim.com/'+p,'url_verified_at':'2026-10-24T17:00:00Z'} for p in ('brosur','el-ilani')],'snapshot_evidence':[{'product':p,'status':200,'canonical':'https://mavibasim.com/'+p,'title':'TEST title','body_hash':'a'*64,'rendering':'static-html'} for p in ('brosur','el-ilani')]};self.assertTrue(crawl_pilot.accepted(state));bad=copy.deepcopy(state);bad['targets'][0]['url_verified_at']=None;self.assertFalse(crawl_pilot.accepted(bad));bad=copy.deepcopy(state);bad['snapshot_evidence'][0]['body_hash']='';self.assertFalse(crawl_pilot.accepted(bad));state['targets'][1]['canonical_url']='https://mavibasim.com/brosur';self.assertFalse(crawl_pilot.accepted(state))

 def test_all_product_acceptance_does_not_pass_with_only_two_or_empty_targets(self):
  self.assertFalse(crawl_pilot.accepted({'targets':[]},True))
  state={'targets':[{'id':str(i),'canonical_url':'https://mavibasim.com/'+str(i),'url_verified_at':'2026-10-24T22:00:00Z'} for i in range(29)],'snapshot_evidence':[{'product':str(i),'status':200,'canonical':'https://mavibasim.com/'+str(i),'title':'fixture','body_hash':'a'*64,'rendering':'static-html'} for i in range(29)]}
  self.assertTrue(crawl_pilot.accepted(state,True));state['snapshot_evidence'].pop();self.assertFalse(crawl_pilot.accepted(state,True))
