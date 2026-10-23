import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('accept_production', ROOT / 'scripts/accept_production.py')
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)


class ProductionAcceptanceTests(unittest.TestCase):
    def test_disconnected_application_passes_only_with_real_sources_and_no_fake_metrics(self):
        report = {'sources': {'csv_files': 521, 'csv_rows': 9075}, 'products': [{'decision': 'Veri bekle', 'current': None}] * 29}
        self.assertTrue(all(c['passed'] for c in acceptance.check_payload('disconnected', {'google_connected': False}, report)))
        report['products'][0] = {'decision': 'Koru', 'current': {'clicks': 0}}
        self.assertFalse(all(c['passed'] for c in acceptance.check_payload('disconnected', {'google_connected': False}, report)))

    def test_oauth_record_alone_does_not_pass_real_sync(self):
        self.assertFalse(all(c['passed'] for c in acceptance.check_payload('sync', {'google_connected': True}, day='2026-10-20')))
        status = {'google_connected': True, 'health': [{'provider': 'gsc', 'status': 'ok', 'checked_at': datetime.now(timezone.utc).isoformat()}],
                  'coverage': [{'provider': 'gsc', 'scope': scope, 'latest': '2026-10-20'} for scope in ('page', 'query')]}
        self.assertTrue(all(c['passed'] for c in acceptance.check_payload('sync', status, day='2026-10-20')))

    def test_open_port_or_crawl_flag_is_not_crawl_acceptance(self):
        self.assertFalse(all(c['passed'] for c in acceptance.check_payload('crawl', {'crawl_enabled': True}, inventory=[])))

    def test_report_with_missing_or_invented_query_values_is_blocked(self):
        report = {'sources': {'google_connected': False}, 'missing': ['Google yok'], 'products': []}
        self.assertFalse(all(c['passed'] for c in acceptance.check_payload('report', {}, report)))
        report = {'sources': {'google_connected': True}, 'missing': [], 'id': 'fixture', 'engine_version': 'fixture',
                  'products': [{'id': product, 'current': {'clicks': 1}, 'previous': {'clicks': 2}, 'evidence': ['fixture'], 'missing': [],
                                'decision': 'Koru', 'queries': [{'missing_current': True, 'clicks': 0}]} for product in ('brosur', 'el-ilani')]}
        self.assertFalse(all(c['passed'] for c in acceptance.check_payload('report', {}, report)))


if __name__ == '__main__':
    unittest.main()
