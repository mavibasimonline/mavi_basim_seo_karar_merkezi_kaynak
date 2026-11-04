"""Run the actual bridge SQL against SQLite and verify bounded indexed work."""
import json
from pathlib import Path
import re
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'src/independent-context-bridge.ts').read_text()


def query(name):
    match = re.search(r'export const ' + name + r'=`(.*?)`;', SOURCE, re.S)
    sql = match.group(1)
    if '${crawlJson' in sql:
        crawl = re.search(r'const crawlJson=\(alias:string\)=>`(.*?)`;', SOURCE, re.S).group(1)
        for alias in ('a', 'b'):
            sql = sql.replace("${crawlJson('" + alias + "')}", crawl.replace('${alias}', alias))
    return sql


class ContextQueryTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        # Use the deployed schema and its actual primary/index definitions.
        self.db.executescript((ROOT / 'migrations/0001_core.sql').read_text())
        self.db.execute("INSERT INTO product_groups VALUES('print','Print')")
        self.db.execute("INSERT INTO products VALUES('brosur','print','Broşür','source','https://mavibasim.com/verified','2026-09-01T00:00:00Z')")
        self.snapshot = json.dumps({'title': 'Title', 'headings': [{'level': 1, 'text': 'H1'}], 'body_hash': 'b' * 64, 'status': 200})
        self.db.execute("INSERT INTO crawls(id,url,started_at) VALUES('crawl','https://mavibasim.com/verified','2026-10-01T00:00:00Z')")
        self.db.execute("INSERT INTO seo_snapshots VALUES('s1','crawl','https://mavibasim.com/verified','2026-10-01T00:00:00Z',?,?)", ('a' * 64, self.snapshot))

    def tearDown(self):
        self.db.close()

    def test_latest_snapshots_use_existing_url_index_and_exact_registered_urls(self):
        sql = query('CONTEXT_SNAPSHOTS_SQL')
        params = (json.dumps(['https://mavibasim.com/verified']),)
        plan = ' '.join(row[3] for row in self.db.execute('EXPLAIN QUERY PLAN ' + sql, params))
        self.assertIn('snapshots_url', plan)
        self.assertEqual(len(self.db.execute(sql, params).fetchall()), 1)
        # Product slug is deliberately different from its stored verified URL.
        self.assertEqual(self.db.execute(sql, (json.dumps(['https://mavibasim.com/brosur']),)).fetchall(), [])

    def test_event_cost_stays_bounded_when_history_grows_twentyfold(self):
        sql = query('CONTEXT_CHANGES_SQL')
        def add(start, end):
            self.db.executemany("INSERT INTO seo_change_events VALUES(?,?,'s1','s1',?,?,NULL,NULL,?)", [
                ('event-' + str(i), 'https://mavibasim.com/verified', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', '{"title":{"old":"A","new":"B"}}')
                for i in range(start, end)
            ])
        def measured():
            calls = [0]
            def progress():
                calls[0] += 1
                return 0
            self.db.set_progress_handler(progress, 10)
            result = self.db.execute(sql).fetchall()
            self.db.set_progress_handler(None, 0)
            self.assertEqual(len(result), 101)
            return calls[0]
        add(0, 1000)
        small = measured()
        add(1000, 20000)
        large = measured()
        self.assertLessEqual(large, small * 1.2 + 10)
        self.assertEqual(self.db.execute(sql).fetchone()[0], 'event-19999')


if __name__ == '__main__':
    unittest.main()
