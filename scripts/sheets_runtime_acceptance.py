"""Boot the exact importer entrypoint locally; no CF credentials or remote data."""
import json
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    (ROOT / '.local').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sheets-runtime-', dir=ROOT / '.local') as name:
        folder = Path(name)
        key = secrets.token_hex(32)
        secret = folder / '.dev.vars'
        secret.write_text('RECOVERY_KEY=' + key + '\n')
        secret.chmod(0o600)
        config = {'name': 'mavi-sheets-runtime-test', 'main': '../../src/sheets-recovery-pilot.ts',
                  'compatibility_date': '2026-10-01', 'workers_dev': False, 'preview_urls': False,
                  'vars': {'SITE_ORIGIN': 'https://example.invalid', 'D1_READ_GUARD_ENABLED': 'true'},
                  'd1_databases': [{'binding': 'DB', 'database_name': 'sheets-local-test',
                                    'database_id': '00000000-0000-0000-0000-000000000001'}]}
        path = folder / 'wrangler.jsonc'
        path.write_text(json.dumps(config))
        process = None
        with (folder / 'runtime.log').open('w') as log:
            try:
                process = subprocess.Popen(['node', 'scripts/run.mjs', 'wrangler', 'dev', '--local', '--config', str(path), '--ip', '127.0.0.1', '--port', '8798', '--log-level', 'error'], cwd=ROOT, stdout=log, stderr=log)
                def request(endpoint, auth=True, body=None):
                    req = urllib.request.Request('http://127.0.0.1:8798' + endpoint, data=body,
                                                 headers={'Authorization': 'Bearer ' + key} if auth else {})
                    try:
                        with urllib.request.urlopen(req, timeout=2) as response:
                            return response.status, json.loads(response.read(2000))
                    except urllib.error.HTTPError as error:
                        return error.code, None
                for _ in range(30):
                    if process.poll() is not None:
                        raise ValueError('LOCAL_RECOVERY_ENTRYPOINT_FAILED')
                    try:
                        status, body = request('/health')
                        if status == 200 and body == {'ready': True}:
                            break
                    except OSError:
                        pass
                    time.sleep(1)
                else:
                    raise ValueError('LOCAL_RECOVERY_ENTRYPOINT_TIMEOUT')
                if request('/keys', auth=False)[0] != 404 or request('/apply', body=b'[]')[0] != 503:
                    raise ValueError('LOCAL_RECOVERY_ACCESS_GUARD_FAILED')
                print(json.dumps({'runtime_started': True, 'anonymous_access': 404, 'empty_import': 503,
                                  'remote_bindings': False, 'production_database_access': False}))
            finally:
                if process is not None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()

if __name__ == '__main__':
    main()
