import json,sys,unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
class ConfigTests(unittest.TestCase):
 def test_separate_worker_is_dormant_and_has_no_public_route_or_oauth_binding(self):
  c=json.loads((ROOT/'deploy/wrangler.quota-observer.jsonc').read_text());app=json.loads((ROOT/'deploy/wrangler.production.jsonc').read_text())
  self.assertNotEqual(c['name'],app['name']);self.assertFalse(c['workers_dev']);self.assertFalse(c['preview_urls']);self.assertNotIn('route',c);self.assertNotIn('routes',c);self.assertNotIn('assets',c);self.assertEqual(c['vars']['QUOTA_OBSERVER_ENABLED'],'false');self.assertEqual(c['vars']['CLOUDFLARE_ACCOUNT_ID'],'');self.assertEqual(c['d1_databases'][0]['database_id'],app['d1_databases'][0]['database_id']);self.assertEqual(c['triggers']['crons'],['2,32 * * * *']);self.assertEqual(app['triggers']['crons'],['*/15 * * * *'])
 def test_existing_checkpoint_schedule_and_fail_closed_script_are_retained(self):
  s=(ROOT/'.github/workflows/d1-read-quota.yml').read_text();self.assertIn("cron: '7 * * * *'",s);self.assertIn("cron: '22,37,52 * * * *'",s);self.assertIn('--require-live-guard --observer',s);self.assertIn("github.event_name == 'workflow_dispatch' && inputs.operation == 'queue-metadata'",s);self.assertIn("inputs.operation != 'queue-metadata'",s)
 def test_ci_builds_observer_without_deploying_or_sharing_its_new_secret(self):
  s=(ROOT/'.github/workflows/ci.yml').read_text();self.assertIn('deploy --dry-run --config deploy/wrangler.quota-observer.jsonc',s);self.assertNotIn('CF_QUOTA_ANALYTICS_TOKEN',s)
if __name__=='__main__':unittest.main()
