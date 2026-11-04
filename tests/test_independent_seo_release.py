import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import independent_seo_release as release

class IndependentReleaseTests(unittest.TestCase):
    def proof(self):
        return dict(ok=True, d1_requests=0, question_d1_requests=0, products=30,
                    source_hash='a'*64, month='2026-09', stale=False,
                    gsc_private_service=True, gsc_d1_requests=0)

    def test_only_fresh_real_report_and_question_proof_authorizes_release(self):
        self.assertEqual(release.acceptance_proof(self.proof()), self.proof())
        cases = [('ok', False), ('d1_requests', 1), ('d1_requests', False),
                 ('question_d1_requests', 1), ('products', 0), ('products', True),
                 ('source_hash', ''), ('source_hash', 123), ('month', '2026-13'),
                 ('stale', True), ('stale', None),('gsc_private_service',False),('gsc_d1_requests',1)]
        for key, value in cases:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                release.acceptance_proof({**self.proof(), key: value})
        for value in (None, {}, [], False):
            with self.assertRaises(ValueError):
                release.acceptance_proof(value)

    def test_probe_diagnostics_never_echo_raw_provider_payloads(self):
        self.assertEqual(release.safe_probe_code(b'{"code":"SOURCE_METRIC_INVALID"}'), 'SOURCE_METRIC_INVALID')
        for body in (b'not json secret', b'{"code":"access_token=secret"}',
                     b'{"code":123}', b'[]', b'{"code":"<script>"}'):
            self.assertEqual(release.safe_probe_code(body), 'INDEPENDENT_REMOTE_PROBE_HTTP_ERROR')

    def test_remote_request_keeps_authentication_and_declares_the_release_client(self):
        request = release.probe_request('fixture-private-key')
        self.assertEqual(request.full_url, 'http://127.0.0.1:8801/')
        self.assertEqual(request.get_header('Authorization'), 'Bearer fixture-private-key')
        self.assertEqual(request.get_header('User-agent'), 'MaviBasimReleaseCheck/1.0')
        self.assertEqual(request.get_header('Accept'), 'application/json')

    def test_wrong_branch_and_wrong_head_stop_before_any_cloudflare_operation(self):
        with patch.dict(release.os.environ, {'GITHUB_REF':'refs/heads/other'}), patch.object(release,'Cloudflare') as client:
            with self.assertRaisesRegex(ValueError, 'INDEPENDENT_MAIN_REQUIRED'):
                release.run()
            client.assert_not_called()

    def test_local_real_source_gate_precedes_first_deploy_and_remote_proof_precedes_app(self):
        source = (ROOT/'scripts/independent_seo_release.py').read_text()
        self.assertLess(source.index(' real_data_acceptance()'), source.index("deploy('deploy/wrangler.drive-archive.jsonc'"))
        self.assertLess(source.index('    acceptance_proof(proof)'), source.index('deploy(main_config,sha)'))
        self.assertLess(source.index("need(gsc_proof['passed']"),source.index('deploy(main_config,sha)'))
        self.assertIn("ae06d79976ebda6d74e8cf54f5e748834ed0cb77",source)
        self.assertIn("changed==EXPECTED", source)
        self.assertIn("after_main['bindings']==existing[APP]['bindings']", source)
        self.assertIn("rollback(config,existing[worker]['version'])", source)

    def test_reviewed_refresh_release_keeps_exact_source_and_one_time_gates(self):
        self.assertEqual(release.TITLE, 'release: verified daily GSC pipeline 20261104')
        self.assertEqual(release.EXPECTED,{'tests/gsc-pipeline-probe.test.ts', 'scripts/gsc_pipeline_acceptance.py', 'tests/test_gsc_pipeline_acceptance.py', 'scripts/independent_seo_release.py', 'scripts/gsc_pipeline_probe.ts', 'tests/test_independent_seo_release.py'})
        source=(ROOT/'scripts/independent_seo_release.py').read_text()
        workflow=(ROOT/'.github/workflows/independent-seo-release.yml').read_text()
        self.assertIn('INDEPENDENT_UNREVIEWED_BASE',source)
        self.assertIn('INDEPENDENT_REFRESH_SOURCE_MISSING',source)
        self.assertIn('INDEPENDENT_GSC_SOURCE_MISSING',source)
        self.assertIn('GSC_REPAIR_SOURCE_MISSING',source)
        self.assertIn('GSC_OAUTH_RECOVERY_SOURCE_MISSING',source)
        self.assertIn('SHEETS_ORPHAN_QUARANTINE_SOURCE_MISSING',source)
        self.assertIn('GOOGLE_HTTP_400',source)
        self.assertIn(release.TITLE,workflow)
        self.assertTrue((ROOT/'tests/independent-native-fetch.test.ts').is_file())
        self.assertIn("after_main['bindings']==existing[APP]['bindings']",source)
        self.assertIn("rollback(config,existing[worker]['version'])",source)

    def test_archive_immediate_code_update_is_explicit_and_app_configuration_stays_unchanged(self):
        from types import SimpleNamespace
        with patch.object(release.subprocess,'run',return_value=SimpleNamespace(returncode=0)) as run:
            release.deploy('deploy/wrangler.drive-archive.jsonc','a'*40)
            self.assertIn('--durable-objects-code-update-mode',run.call_args.args[0])
            self.assertEqual(run.call_args.args[0][-1],'immediate')
            release.deploy('deploy/wrangler.monthly-app.jsonc','a'*40)
            self.assertNotIn('--durable-objects-code-update-mode',run.call_args.args[0])

    def test_only_the_exact_active_source_annotation_is_accepted(self):
        version='11111111-1111-1111-1111-111111111111'
        with patch.object(release,'api',return_value={'annotations':{'workers/tag':'a'*40}}) as api, patch('builtins.print'):
            release.verify_active_source(object(),release.ARCHIVE,version,'a'*40)
            self.assertEqual(api.call_args.args[1],'GET')
        with patch.object(release,'api',return_value={'annotations':{'workers/tag':'b'*40}}):
            with self.assertRaisesRegex(ValueError,'INDEPENDENT_ACTIVE_SOURCE_MISMATCH'):
                release.verify_active_source(object(),release.ARCHIVE,version,'a'*40)

    def test_live_html_acceptance_matches_the_exact_tested_asset(self):
        expected=(ROOT/'public/independent-seo.html').read_bytes()
        release.ui_acceptance(200,expected,expected)
        for status,body in ((503,expected),(200,b'old D1 Google Sheets page'),(200,expected[:-1]),(200,b'')):
            with self.assertRaisesRegex(ValueError,'INDEPENDENT_UI_NOT_AVAILABLE'):
                release.ui_acceptance(status,body,expected)

    def test_existing_optional_monthly_service_is_preserved_without_new_resources(self):
        drive = dict(name='DRIVE_ARCHIVE_SERVICE', type='service', service=release.ARCHIVE)
        monthly = dict(name='MONTHLY_ANALYSES', type='service', service='mavi-basim-monthly-store')
        self.assertEqual(release.app_config([drive]), 'deploy/wrangler.drive-independent.jsonc')
        self.assertEqual(release.app_config([drive, monthly]), 'deploy/wrangler.monthly-app.jsonc')
        for bindings in ([], [drive, {**monthly, 'service':'other'}], [drive, {**monthly, 'name':'OTHER'}]):
            with self.assertRaisesRegex(ValueError, 'INDEPENDENT_SERVICE_BINDINGS_UNREVIEWED'):
                release.app_config(bindings)

if __name__ == '__main__':
    unittest.main()
