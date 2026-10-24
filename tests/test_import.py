import importlib.util
import json
import sqlite3
import tempfile
import unittest
import re
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
        for migration in sorted((ROOT / 'migrations').glob('*.sql')):
            cls.db.executescript(migration.read_text())
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

    def test_original_source_hashes_and_missing_data_report(self):
        baseline = json.loads((ROOT / 'docs/source-audit.json').read_text(encoding='utf-8'))
        self.assertEqual({f['path']: f['sha256'] for f in self.report['files']},
                         {f['path']: f['sha256'] for f in baseline['files']})
        self.assertEqual(self.report['unique_product_keywords'], 6765)
        self.assertEqual(self.report['missing_average_searches'], 4169)
        self.assertEqual(self.report['missing_monthly_cells'], 212148)
        self.assertEqual(len(self.report['repeated_keywords']), 1300)

    def test_worker_manifest_matches_all_original_file_hashes_and_counts(self):
        manifest = json.loads((ROOT / 'src/source-manifest.json').read_text())
        self.assertEqual(len(manifest), 521)
        self.assertEqual({f['path']: (f['sha256'], f['row_count'], f['product_id']) for f in manifest},
                         {f['path']: (f['sha256'], f['rows'], f['product']) for f in self.report['files']})

    def test_malformed_rows_are_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'group/product/Keyword Stats 2026-10-01 at 01_02_03.csv'
            path.parent.mkdir(parents=True)
            path.write_text('Export\nPeriod\nKeyword\tCurrency\tAvg. monthly searches\n\tTRY\t0\nfoo\tTRY\n', encoding='utf-16')
            report, _ = importer.inspect_sources(Path(temp))
            self.assertEqual(len(report['errors']), 2)
            self.assertEqual(report['rows'], 0)

    def test_each_of_29_products_and_all_521_dates_match_original_directories(self):
        folders = {p.parent.relative_to(ROOT).as_posix() for p in ROOT.glob('*/*/*.csv')}
        products = dict(self.db.execute('SELECT id,source_folder FROM products'))
        self.assertEqual(set(products.values()), folders)
        self.assertEqual(len(products), 29)
        for product, path, exported, row_count in self.db.execute('SELECT product_id,path,exported_at,row_count FROM keyword_sources'):
            original = ROOT / path
            self.assertEqual(original.parent.name, product)
            self.assertEqual(original.parent.relative_to(ROOT).as_posix(), products[product])
            match = re.search(r'(\d{4}-\d{2}-\d{2}) at (\d{2})_(\d{2})_(\d{2})', original.name)
            self.assertEqual(exported, f'{match[1]}T{match[2]}:{match[3]}:{match[4]}')
            self.assertGreater(row_count, 0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM keyword_metric_observations o JOIN keyword_sources s ON s.id=o.source_id JOIN keyword_catalog k ON k.id=o.keyword_id WHERE k.product_id<>s.product_id').fetchone()[0], 0)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_every_observation_keeps_its_own_volume_without_adding_duplicate_exports(self):
        rows = self.db.execute('SELECT o.avg_monthly_searches,o.raw_cells_json,s.header_json FROM keyword_metric_observations o JOIN keyword_sources s ON s.id=o.source_id').fetchall()
        self.assertEqual(len(rows), 9075)
        for volume, cells, header in rows:
            original = dict(zip(json.loads(header), json.loads(cells)))
            self.assertEqual(volume, importer.number(original['Avg. monthly searches']))
        duplicates = self.db.execute('SELECT keyword_id,count(*) FROM keyword_metric_observations GROUP BY keyword_id HAVING count(*)>1').fetchall()
        self.assertEqual(len(duplicates), 1300)


if __name__ == '__main__':
    unittest.main()
