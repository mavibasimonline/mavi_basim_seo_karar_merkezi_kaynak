import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_checks', ROOT / 'scripts/release_checks.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / 'deploy/wrangler.production.jsonc').read_text())

    def test_production_template_is_separate_and_inert(self):
        self.assertEqual(release.config_errors(self.config), [])
        self.assertIn('D1_ACCOUNT_AUTHORIZATION_REQUIRED', release.config_errors(self.config, ready=True))
        self.assertIn('OAUTH_ACCOUNT_CALLBACK_REQUIRED', release.config_errors(self.config, ready=True))

    def test_actual_resource_ids_are_required_but_not_payment_permission(self):
        self.config['d1_databases'][0]['database_id'] = '12345678-1234-1234-1234-123456789abc'
        self.config['vars']['GOOGLE_REDIRECT_URI'] = 'https://mavi-basim-seo-prod.example.workers.dev/api/oauth/google/callback'
        self.assertEqual(release.config_errors(self.config, ready=True), [])

    def test_site_route_extra_resources_plain_secrets_and_early_cron_are_rejected(self):
        for field, value, expected in [
            ('routes', [{'pattern': 'mavibasim.com/*'}], 'SITE_ROUTE_FORBIDDEN'),
            ('r2_buckets', [{'bucket_name': 'unused'}], 'UNREVIEWED_RESOURCE_OR_PAID_LIMIT'),
            ('triggers', {'crons': ['*/15 * * * *']}, 'AUTOMATION_NOT_HELD_FOR_ACCEPTANCE'),
        ]:
            config = copy.deepcopy(self.config)
            config[field] = value
            self.assertIn(expected, release.config_errors(config, bootstrap=True))
        self.config['vars']['GOOGLE_CLIENT_SECRET'] = 'do-not-store-values'
        self.assertIn('SECRET_IN_CONFIG', release.config_errors(self.config))

    def test_secret_guard_detects_known_formats_without_emitting_values(self):
        for prefix, tail, rule in [('ghp_', 'a' * 36, 'github-token'), ('GOCSPX-', 'b' * 28, 'google-client-secret'),
                                   ('AIza', 'c' * 35, 'google-api-key'), ('1//', 'd' * 40, 'google-refresh-token')]:
            self.assertIn(rule, release.secret_rules(prefix + tail))
        self.assertEqual(release.secret_rules('GOOGLE_CLIENT_SECRET=\nADMIN_TOKEN=\n'), [])
        self.assertEqual(release.secret_rules('ADMIN_TOKEN=\nGOOGLE_CLIENT_SECRET=\nTOKEN_ENCRYPTION_KEY=\n'), [])

    def test_automation_requires_explicit_opt_in_and_real_resource_ids(self):
        self.config['triggers']['crons'] = ['*/15 * * * *']
        self.assertIn('AUTOMATION_OPT_IN_REQUIRED', release.config_errors(self.config))
        self.config['vars']['AUTOMATION_ENABLED'] = 'true'
        self.assertIn('D1_ACCOUNT_AUTHORIZATION_REQUIRED', release.config_errors(self.config))
        self.assertIn('OAUTH_ACCOUNT_CALLBACK_REQUIRED', release.config_errors(self.config))
        self.assertIn('AUTOMATION_NOT_HELD_FOR_ACCEPTANCE', release.config_errors(self.config, bootstrap=True))

    def test_ga4_and_gsc_configuration_cannot_silently_target_wrong_properties(self):
        self.config['vars']['GSC_PROPERTY'] = 'sc-domain:mavibasim.com'
        self.config['vars']['GA4_PROPERTY_ID'] = '123456789'
        self.assertEqual(release.config_errors(self.config), [])
        self.config['vars']['GSC_PROPERTY'] = 'https://another.example/'
        self.config['vars']['GA4_PROPERTY_ID'] = 'G-TRACKING-ID'
        self.assertIn('UNEXPECTED_GSC_PROPERTY', release.config_errors(self.config))
        self.assertIn('INVALID_GA4_PROPERTY_ID', release.config_errors(self.config))


if __name__ == '__main__':
    unittest.main()
