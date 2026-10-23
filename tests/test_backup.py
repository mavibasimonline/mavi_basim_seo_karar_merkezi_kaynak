import base64
import importlib.util
import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from test_import import importer

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('verify_restore', ROOT / 'scripts/verify_restore.py')
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class BackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.path = Path(cls.directory.name)
        db = sqlite3.connect(':memory:')
        for migration in sorted((ROOT / 'migrations').glob('*.sql')):
            db.executescript(migration.read_text())
        _, sql = importer.inspect_sources()
        db.executescript(sql)
        (cls.path / 'backup.sql').write_text('\n'.join(db.iterdump()), encoding='utf-8')
        db.close()
        cls.process_env = {**os.environ, 'BACKUP_ENCRYPTION_KEY': base64.b64encode(os.urandom(32)).decode()}

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def command(self, mode, source, target, env=None):
        return subprocess.run(['node', str(ROOT / 'scripts/backup.mjs'), mode, str(source), str(target)], env=env or self.process_env, capture_output=True, text=True)

    def test_encrypted_backup_round_trip_and_full_restore(self):
        encrypted = self.path / 'archive.mavi'
        decrypted = self.path / 'restored.sql'
        self.assertEqual(self.command('encrypt', self.path / 'backup.sql', encrypted).returncode, 0)
        self.assertNotIn(b'CREATE TABLE', encrypted.read_bytes())
        self.assertEqual(self.command('decrypt', encrypted, decrypted).returncode, 0)
        self.assertEqual((self.path / 'backup.sql').read_bytes(), decrypted.read_bytes())
        result = restore.verify_restore(decrypted)
        self.assertEqual(result['integrity'], 'ok')
        self.assertEqual(result['counts']['keyword_metric_observations'], 9075)
        self.assertEqual(result['counts']['keyword_sources'], 521)
        self.assertEqual(result['counts']['products'], 29)

    def test_tampered_or_wrong_key_backup_is_rejected(self):
        encrypted = self.path / 'corrupt-source.mavi'
        self.assertEqual(self.command('encrypt', self.path / 'backup.sql', encrypted).returncode, 0)
        raw = bytearray(encrypted.read_bytes())
        raw[-10] ^= 1
        corrupt = self.path / 'corrupt.mavi'
        corrupt.write_bytes(raw)
        self.assertNotEqual(self.command('decrypt', corrupt, self.path / 'should-not-exist.sql').returncode, 0)
        self.assertFalse((self.path / 'should-not-exist.sql').exists())
        wrong = {**self.process_env, 'BACKUP_ENCRYPTION_KEY': base64.b64encode(os.urandom(32)).decode()}
        self.assertNotEqual(self.command('decrypt', encrypted, self.path / 'wrong.sql', wrong).returncode, 0)


if __name__ == '__main__':
    unittest.main()
