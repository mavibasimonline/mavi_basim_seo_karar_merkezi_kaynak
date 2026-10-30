"""Read fixed public Sheets into private scratch; prove real data in local SQLite DO.

No Cloudflare deploy/API call, D1, OAuth or Google Drive write occurs here.
"""
import os
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHEET = '1uKs8G9hUbmUvU8tqKfnDkZ1PbiVk-JcuJTgGqD3lB-4'
SECTIONS = ('GSC_GUNLUK', 'OZET', 'URUNLER', 'SORGULAR')
MAX_BYTES = 12_000_000

def run():
    folder = ROOT / '.local/independent-real-source'
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    for section in SECTIONS:
        url = f'https://docs.google.com/spreadsheets/d/{SHEET}/gviz/tq?tqx=out:json&headers=1&sheet={section}'
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(MAX_BYTES + 1)
            if response.status != 200 or not data or len(data) > MAX_BYTES:
                raise ValueError('INDEPENDENT_REAL_SOURCE_LIMIT')
        path = folder / (section + '.gviz')
        path.write_bytes(data)
        path.chmod(0o600)
    result = subprocess.run(['node', 'scripts/run.mjs', 'vitest', 'run', '--config',
                             'vitest.independent-acceptance.config.ts'], cwd=ROOT,
                            env={**os.environ, 'INDEPENDENT_REAL_SOURCE_DIR': str(folder)})
    if result.returncode:
        raise ValueError('INDEPENDENT_LOCAL_REAL_DATA_ACCEPTANCE_FAILED')

if __name__ == '__main__':
    run()
