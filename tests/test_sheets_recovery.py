import copy
import io
import json
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from sheets_recovery_plan import plan, backup_histories, metrics, read_xlsx, sheet_date
import sheets_recovery

STAMP = '2026-10-29T19:17:00Z'

def fixture():
    metric = {'Tıklama': '1', 'Gösterim': '10', 'TO (%)': '10', 'Ortalama Konum': '3'}
    return {
        'OZET': [{**metric, 'Dönem Kodu': 'TEST previous', 'Dönem Etiketi': 'TEST September', 'Başlangıç Tarihi': '2026-09-01', 'Bitiş Tarihi': '2026-09-30', 'Durum': 'tam_ay', 'Son Güncelleme': STAMP}],
        'GSC_GUNLUK': [{**metric, 'Tarih': '2026-07-01'}],
        'URUNLER': [{**metric, 'Dönem Kodu': 'TEST previous', 'Ürün ID': 'brosur', 'Ürün Adı': 'TEST Broşür'}],
        'SORGULAR': [{**metric, 'Dönem Kodu': 'TEST previous', 'Ürün ID': 'brosur', 'Sorgu': 'TEST query', 'manuel_sinif': 'TEST preserve', 'manuel_karar_notu': 'TEST user decision', 'extra_future_field': {'work': ['TEST retain']}}],
        'AYLIK_CALISMALAR': [],
    }

class SheetsRecoveryTests(unittest.TestCase):
    def test_totals_never_complete_a_daily_page_or_query_job(self):
        result = plan(fixture(), 'a' * 64, STAMP)
        self.assertEqual(result['daily_jobs_completed'], 0)
        self.assertEqual(result['d1_records_written'], 0)
        self.assertTrue(all(not r['daily_page_query_coverage'] and not r['source_filters_verified'] for r in result['records']))
        self.assertEqual(result['records'][0]['family'], 'site_daily_total')

    def test_repeat_snapshots_and_source_update_dates_do_not_duplicate_records(self):
        first = plan(fixture(), 'a' * 64, STAMP)
        changed = fixture()
        changed['OZET'][0]['Son Güncelleme'] = '2026-10-29T20:17:00Z'
        again = plan(changed, 'b' * 64, '2026-10-29T21:17:00Z', [r['source_key'] for r in first['records']])
        self.assertEqual(again['missing_evidence_records'], 0)
        self.assertEqual(again['already_archived'], 4)

    def test_ambiguous_query_rows_are_preserved_without_summing_or_selecting_a_winner(self):
        data = fixture()
        other = {**data['SORGULAR'][0], 'Tıklama': '2', 'TO (%)': '20', 'manuel_karar_notu': 'TEST different note'}
        data['SORGULAR'].append(other)
        result = plan(data, 'a' * 64, STAMP)
        self.assertEqual(result['ambiguous_identities'], 1)
        self.assertEqual(len(result['quarantined_records']), 2)
        self.assertTrue(all(r['family'] != 'query_period' for r in result['records']))
        self.assertEqual({r['payload']['manuel_karar_notu'] for r in result['quarantined_records']}, {'TEST user decision', 'TEST different note'})

    def test_exact_duplicate_rows_are_idempotent_and_user_fields_are_lossless(self):
        data = fixture()
        data['SORGULAR'].append(copy.deepcopy(data['SORGULAR'][0]))
        result = plan(data, 'a' * 64, STAMP)
        self.assertEqual(result['candidate_records'], 4)
        query = next(r for r in result['records'] if r['family'] == 'query_period')
        for key, value in data['SORGULAR'][0].items():
            self.assertEqual(query['payload'][key], value)

    def test_json_user_histories_keep_unknown_fields_and_work_links(self):
        original = {'manualDecisions': {'TEST id': {'note': 'TEST preserve', 'nested': [None, False]}}, 'workRecords': [{'id': 'TEST work', 'decision': 'TEST id', 'unknown': {'a': 1}}]}
        saved = backup_histories(original)
        self.assertEqual({key: value['payload'] for key, value in saved.items()}, original)
        self.assertEqual(backup_histories(copy.deepcopy(original)), saved)

    def test_invalid_metrics_and_unknown_periods_fail_closed(self):
        for key, value in [('Tıklama', '11'), ('Gösterim', '-1'), ('Ortalama Konum', 'nan'), ('TO (%)', '80'), ('Tıklama', True)]:
            data = fixture()
            data['SORGULAR'][0][key] = value
            with self.assertRaises(ValueError):
                plan(data, 'a' * 64, STAMP)
        data = fixture()
        data['SORGULAR'][0]['Dönem Kodu'] = 'TEST unknown'
        with self.assertRaisesRegex(ValueError, 'PERIOD_REQUIRED'):
            plan(data, 'a' * 64, STAMP)

    def test_invalid_source_dates_and_provenance_fail_closed(self):
        for value in [True, '-1', 'nan', '2026-99-99', '2026-07-32']:
            with self.assertRaises((ValueError, TypeError, OverflowError)):
                sheet_date(value)
        self.assertEqual(sheet_date('46204'), '2026-07-01')
        with self.assertRaisesRegex(ValueError, 'HASH_REQUIRED'):
            plan(fixture(), 'not a source hash', STAMP)
        with self.assertRaisesRegex(ValueError, 'TIMESTAMP_REQUIRED'):
            plan(fixture(), 'a' * 64, '2026-10-29T19:17:00')

    def test_xml_entities_and_expanded_payload_limits_are_rejected(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('xl/sharedStrings.xml', '<!DOCTYPE xml [<!ENTITY x "TEST">]><sst/>')
        with self.assertRaisesRegex(ValueError, 'XML_ENTITY_FORBIDDEN'):
            read_xlsx(data.getvalue())
        with patch('sheets_recovery_plan.MAX_SOURCE', 1):
            with self.assertRaisesRegex(ValueError, 'SOURCE_SIZE_LIMIT'):
                read_xlsx(b'TEST oversize')

    def test_missing_native_backup_prevents_starting_any_import_runtime(self):
        class Client:
            account = 'a' * 32
            def request(self, *args):
                return {'ok': False}
        with patch.object(sheets_recovery, 'source_ci', return_value=None), patch.object(sheets_recovery, 'source_parity'), patch.object(sheets_recovery, 'Cloudflare', return_value=Client()), patch.object(sheets_recovery, 'observation', return_value={'ok': True, 'mode': 'open'}), patch.object(sheets_recovery, 'locks', return_value={}), patch.object(sheets_recovery.subprocess, 'Popen') as process:
            with self.assertRaisesRegex(ValueError, 'BACKUP_BOOKMARK_REQUIRED'):
                sheets_recovery.run()
            process.assert_not_called()

    def test_closed_quota_prevents_every_d1_and_source_request(self):
        with patch.object(sheets_recovery, 'source_ci', return_value=None), patch.object(sheets_recovery, 'source_parity'), patch.object(sheets_recovery, 'Cloudflare') as client, patch.object(sheets_recovery, 'observation', return_value={'ok': False}), patch.object(sheets_recovery, 'locks') as locks:
            self.assertEqual(sheets_recovery.run()['status'], 'held')
            locks.assert_not_called()
            client.return_value.request.assert_not_called()

    def test_exact_ci_and_prior_failure_gate_prevent_blind_retries(self):
        sha = 'a' * 40
        def github(path):
            if path == '/branches/main':
                return {'commit': {'sha': sha}}
            if '/ci.yml/' in path:
                return {'workflow_runs': [{'head_sha': sha, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success'}]}
            return {'workflow_runs': []}
        with patch.dict('os.environ', {'GITHUB_REF': 'refs/heads/main', 'GITHUB_SHA': sha, 'GITHUB_REPOSITORY': sheets_recovery.REPOSITORY}):
            self.assertIsNone(sheets_recovery.source_ci(github))
            self.assertEqual(sheets_recovery.source_ci(lambda path: {'workflow_runs': [{'conclusion': 'failure'}]} if '/sheets-recovery.yml/' in path else github(path)), 'PREVIOUS_FAILURE_REQUIRES_REVIEWED_SOURCE')
            self.assertEqual(sheets_recovery.source_ci(lambda path: {'workflow_runs': []} if '/ci.yml/' in path else github(path)), 'EXACT_SOURCE_CI_REQUIRED')
        with patch.object(sheets_recovery, 'source_ci', return_value='EXACT_SOURCE_CI_REQUIRED'), patch.object(sheets_recovery, 'Cloudflare') as client:
            self.assertEqual(sheets_recovery.run()['inserted'], 0)
            client.assert_not_called()

    def test_only_closed_finalized_months_and_separate_site_totals_are_automatically_archived(self):
        records = [
            {'family': 'site_daily_total', 'start': '2026-07-01', 'end': '2026-07-01'},
            {'family': 'query_period', 'start': '2026-07-30', 'end': '2026-10-27'},
            {'family': 'query_period', 'start': '2026-10-01', 'end': '2026-10-27'},
            {'family': 'query_period', 'start': '2026-09-01', 'end': '2026-09-30'},
        ]
        self.assertEqual(sheets_recovery.eligible_records(records, STAMP), [records[0], records[3]])
        self.assertEqual(sheets_recovery.eligible_records([records[3]], '2026-10-03T23:59:00Z'), [])

if __name__ == '__main__':
    unittest.main()
