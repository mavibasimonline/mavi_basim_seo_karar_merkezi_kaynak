import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('import_keywords', ROOT / 'scripts/import_keywords.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.report, cls.commands = importer.inspect_sources()
        cls.db = sqlite3.connect(':memory:')
        cls.db.executescript((ROOT / 'migrations/0001_core.sql').read_text())
        cls.db.executescript(cls.commands)

    def test_all_original_sources_and_rows(self):
        self.assertEqual((self.report['file_count'], self.report['product_count'], self.report['group_count'], self.report['rows']), (521, 29, 4, 9075))
        self.assertEqual(self.report['errors'], [])
        self.assertEqual(self.db.execute('SELECT count(*) FROM keyword_sources').fetchone()[0], 521)
        self.assertEqual(self.db.execute('SELECT count(*) FROM keyword_metric_observations').fetchone()[0], 9075)

    def test_repeatable_import_preserves_provenance(self):
        self.db.executescript(self.commands)
        self.assertEqual(self.db.execute('SELECT count(*) FROM keyword_metric_observations').fetchone()[0], 9075)
        for source, in self.db.execute('SELECT id FROM keyword_sources'):
            row = self.db.execute('SELECT row_number, raw_cells_json FROM keyword_metric_observations WHERE source_id=? ORDER BY row_number LIMIT 1', (source,)).fetchone()
            self.assertEqual(row[0], 4)
            self.assertIsInstance(json.loads(row[1]), list)

    def test_null_zero_and_variants_are_distinct(self):
        self.assertIsNone(importer.number(''))
        self.assertEqual(importer.number('0'), 0)
        self.assertEqual(importer.number('1.000'), 1000)
        self.assertEqual(importer.family('broşür baskı'), importer.family('broşür baski'))
        ids = [importer.digest('brosur\0' + word) for word in ('broşür baskı', 'broşür baski')]
        self.assertNotEqual(*ids)
        self.assertGreater(self.report['repeated_observations_across_exports'], 0)

    def test_unknown_scope_stays_unknown_and_urls_not_invented(self):
        self.assertEqual(self.db.execute('SELECT count(*) FROM keyword_sources WHERE location IS NOT NULL OR language IS NOT NULL OR network IS NOT NULL').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM products WHERE canonical_url IS NOT NULL').fetchone()[0], 2)

    def test_malformed_rows_are_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'group/product/Keyword Stats 2026-10-01 at 01_02_03.csv'
            path.parent.mkdir(parents=True)
            path.write_text('Export\nPeriod\nKeyword\tCurrency\tAvg. monthly searches\n\tTRY\t0\nfoo\tTRY\n', encoding='utf-16')
            report, _ = importer.inspect_sources(Path(temp))
            self.assertEqual(len(report['errors']), 2)
            self.assertEqual(report['rows'], 0)


if __name__ == '__main__':
    unittest.main()
