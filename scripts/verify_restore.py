"""Restore a SQL backup into an isolated temporary SQLite DB and verify integrity."""
import argparse
import json
import sqlite3
import tempfile
from pathlib import Path


def verify_restore(path):
    with tempfile.TemporaryDirectory() as temp:
        db = sqlite3.connect(str(Path(temp) / 'restore.sqlite'))
        try:
            db.executescript(path.read_text(encoding='utf-8'))
            check = db.execute('PRAGMA integrity_check').fetchone()[0]
            foreign_keys = db.execute('PRAGMA foreign_key_check').fetchall()
            if check != 'ok' or foreign_keys:
                raise ValueError('Veritabanı bütünlük veya ilişki kontrolü başarısız')
            counts = {table: db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]
                      for table in ('products', 'keyword_sources', 'keyword_metric_observations', 'seo_snapshots', 'analysis_runs')}
            return {'integrity': check, 'foreign_key_errors': len(foreign_keys), 'counts': counts}
        finally:
            db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sql', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(verify_restore(args.sql)))
