"""Scheduled, bounded Sheets evidence ingestion; main Worker/OAuth remain untouched."""
import json
import os
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

from cloudflare_diagnostics import Cloudflare
from d1_quota_checkpoint import observation
from d1_quota_control import DATABASE
from release_readiness import APP, REPOSITORY, get_json
from sheets_recovery_plan import SPREADSHEET, MAX_SOURCE, read_xlsx, plan, canonical
import hashlib

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_APP = '8b56115f52ef2e7690927614365165ade4bfbdaa'
WORKERS = ('mavi-basim-seo-prod', 'mavi-basim-quota-observer')
PARITY = ('src/d1-read-budget.ts', 'src/sync-budget.ts', 'src/types.ts', 'src/google.ts', 'src/security.ts',
          'package.json', 'package-lock.json', 'deploy/wrangler.production.jsonc')

def source_parity():
    for path in PARITY:
        existing = subprocess.check_output(['git', 'show', EXPECTED_APP + ':' + path], cwd=ROOT, stderr=subprocess.DEVNULL)
        if existing != (ROOT / path).read_bytes():
            raise ValueError('SOURCE_GUARD_PARITY_REQUIRED')

def eligible_records(records, stamp):
    cutoff = datetime.fromisoformat(stamp.replace('Z', '+00:00')).date()
    result = []
    for record in records:
        end = datetime.fromisoformat(record['end']).date()
        closed_month = (record['start'].endswith('-01') and record['start'][:7] == record['end'][:7]
                        and (end + timedelta(days=1)).day == 1 and end + timedelta(days=3) < cutoff)
        if record['family'] == 'site_daily_total' or closed_month:
            result.append(record)
    return result

def source_ci(github=None):
    sha = os.environ.get('GITHUB_SHA', '')
    if os.environ.get('GITHUB_REF') != 'refs/heads/main' or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY or not re.fullmatch('[a-f0-9]{40}', sha):
        return 'EXACT_MAIN_CONTEXT_REQUIRED'
    github = github or (lambda path: get_json('https://api.github.com/repos/' + REPOSITORY + path, os.environ.get('GITHUB_TOKEN')))
    if github('/branches/main').get('commit', {}).get('sha') != sha:
        return 'SOURCE_COMMIT_SUPERSEDED'
    runs = github('/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=' + sha + '&per_page=20').get('workflow_runs', [])
    if not any(r.get('head_sha') == sha and r.get('head_branch') == 'main' and r.get('event') == 'push' and r.get('conclusion') == 'success' and r.get('status') == 'completed' for r in runs):
        return 'EXACT_SOURCE_CI_REQUIRED'
    failed = github('/actions/workflows/sheets-recovery.yml/runs?status=failure&per_page=1').get('workflow_runs', [])
    if failed:
        previous = failed[0].get('head_sha', '')
        if not re.fullmatch('[a-f0-9]{40}', previous) or previous == sha:
            return 'PREVIOUS_FAILURE_REQUIRES_REVIEWED_SOURCE'
        relevant = ('scripts/sheets_recovery.py', 'scripts/sheets_recovery_plan.py', 'src/sheets-recovery-pilot.ts', '.github/workflows/sheets-recovery.yml')
        changed = subprocess.check_output(['git', 'diff', '--name-only', previous, sha, '--', *relevant], cwd=ROOT, stderr=subprocess.DEVNULL)
        if not changed.strip():
            return 'PREVIOUS_FAILURE_REQUIRES_REVIEWED_SOURCE'
    return None

def locks(client):
    found = {}
    for worker in WORKERS:
        base = f'/accounts/{client.account}/workers/scripts/{worker}'
        deployment = client.request('GET', base + '/deployments')
        schedules = client.request('GET', base + '/schedules')
        if not deployment.get('ok') or not schedules.get('ok'):
            raise ValueError('SOURCE_WORKER_LOCK_REQUIRED')
        raw = deployment['result']
        rows = raw.get('deployments', []) if isinstance(raw, dict) else raw
        versions = sorted(rows, key=lambda r: r.get('created_on', ''), reverse=True)[0]['versions']
        if len(versions) != 1 or versions[0].get('percentage') != 100:
            raise ValueError('SOURCE_WORKER_LOCK_REQUIRED')
        raw = schedules['result']
        crons = [s['cron'] for s in (raw.get('schedules', []) if isinstance(raw, dict) else raw)]
        found[worker] = {'version': versions[0]['version_id'], 'crons': crons}
    if get_json(APP + '/api/health').get('deployment', {}).get('commit') != EXPECTED_APP:
        raise ValueError('SOURCE_LIVE_COMMIT_CHANGED')
    return found

def run():
    ci_issue = source_ci()
    if ci_issue:
        return {'status': 'held', 'reason': ci_issue, 'inserted': 0, 'daily_jobs_completed': 0}
    source_parity()
    client = Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'), os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
    usage = observation(client)
    if not usage.get('ok') or usage.get('mode') != 'open':
        return {'status': 'held', 'reason': 'CURRENT_OPEN_ACCOUNT_QUOTA_REQUIRED', 'inserted': 0, 'daily_jobs_completed': 0}
    saved = locks(client)
    backup = client.request('GET', f'/accounts/{client.account}/d1/database/{DATABASE}/time_travel/bookmark')
    bookmark = backup.get('result', {}).get('bookmark') if backup.get('ok') else None
    if not isinstance(bookmark, str) or not re.fullmatch(r'[a-f0-9-]{20,100}', bookmark):
        raise ValueError('NATIVE_D1_BACKUP_BOOKMARK_REQUIRED')
    folder = ROOT / '.local/sheets-recovery'
    folder.mkdir(parents=True, exist_ok=True)
    folder.chmod(0o700)
    key = secrets.token_hex(32)
    secret = folder / '.dev.vars'
    secret.write_text('RECOVERY_KEY=' + key + '\n')
    secret.chmod(0o600)
    production = json.loads((ROOT / 'deploy/wrangler.production.jsonc').read_text())
    config = {'name': 'mavi-local-sheets-recovery', 'main': '../../src/sheets-recovery-pilot.ts',
              'compatibility_date': production['compatibility_date'], 'workers_dev': False, 'preview_urls': False,
              'vars': {**production['vars'], 'AUTOMATION_ENABLED': 'false', 'CRAWL_ENABLED': 'false', 'D1_READ_GUARD_ENABLED': 'true'},
              'd1_databases': [{**{k: production['d1_databases'][0][k] for k in ('binding', 'database_name', 'database_id')}, 'remote': True}]}
    if config['d1_databases'][0]['database_id'] != DATABASE:
        raise ValueError('SOURCE_DATABASE_REJECTED')
    config_file = folder / 'wrangler.jsonc'
    config_file.write_text(json.dumps(config))
    process = None
    result = {'status': 'verified', 'inserted': 0, 'daily_jobs_completed': 0,
              'backup_bookmark': bookmark, 'backup_bookmark_observed_at': datetime.now(timezone.utc).isoformat(),
              'application_published': False, 'oauth_changed': False, 'r2_changed': False, 'drive_changed': False}
    def request(path, payload=None):
        req = urllib.request.Request('http://127.0.0.1:8797' + path,
                                     data=None if payload is None else canonical(payload).encode(),
                                     headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return json.loads(response.read(1_000_001))
        except urllib.error.HTTPError as error:
            if error.code == 429:
                body = json.loads(error.read(5000))
                return {'status': 'held', 'reason': body.get('reason'), 'inserted': 0, 'daily_jobs_completed': 0}
            raise ValueError('GUARDED_RECOVERY_REQUEST_FAILED') from None
    try:
        with (folder / 'runtime.log').open('w') as log:
            process = subprocess.Popen(['node', 'scripts/run.mjs', 'wrangler', 'dev', '--config', str(config_file), '--ip', '127.0.0.1', '--port', '8797', '--log-level', 'error'], cwd=ROOT, stdout=log, stderr=log)
            for _ in range(45):
                if process.poll() is not None:
                    raise ValueError('GUARDED_RECOVERY_RUNTIME_FAILED')
                try:
                    if request('/health').get('ready'):
                        break
                except OSError:
                    pass
                time.sleep(1)
            else:
                raise ValueError('GUARDED_RECOVERY_RUNTIME_TIMEOUT')
            existing = []
            after = ''
            for _ in range(40):
                rows = request('/keys?after=' + after)
                if isinstance(rows, dict) and rows.get('status') == 'held':
                    return {**result, **rows}
                if not isinstance(rows, list):
                    raise ValueError('RECOVERY_KEYS_REJECTED')
                existing.extend(row['source_key'] for row in rows)
                if len(rows) < 500:
                    break
                after = rows[-1]['source_key']
            else:
                raise ValueError('RECOVERY_ARCHIVE_SCOPE_LIMIT')
            req = urllib.request.Request('https://docs.google.com/spreadsheets/d/' + SPREADSHEET + '/export?format=xlsx', headers={'User-Agent': 'MaviBasimSourceRecovery/1.0'})
            with urllib.request.urlopen(req, timeout=45) as response:
                raw = response.read(MAX_SOURCE + 1)
            stamp = datetime.now(timezone.utc).isoformat()
            prepared = plan(read_xlsx(raw), hashlib.sha256(raw).hexdigest(), stamp, existing)
            # Rolling/in-progress query sets belong in the independent raw archive,
            # not in a growing D1 history of overlapping period totals.
            eligible = eligible_records(prepared['records'], stamp)
            result.update({'source_sha256': prepared['snapshot_sha256'], 'candidate_records': prepared['candidate_records'],
                           'ambiguous_identities': prepared['ambiguous_identities'], 'quarantined_records': len(prepared['quarantined_records']),
                           'eligible_missing': len(eligible)})
            for offset in range(0, min(len(eligible), 270), 90):
                imported = request('/apply', eligible[offset:offset + 90])
                if imported.get('status') == 'held' or imported.get('held'):
                    result.update({'status': 'held', 'reason': imported.get('reason') or imported.get('held')})
                    break
                result['inserted'] += imported['inserted']
            result['remaining_eligible'] = len(eligible) - result['inserted']
            return result
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        secret.unlink(missing_ok=True)
        if locks(client) != saved:
            raise ValueError('SOURCE_WORKER_LOCK_CHANGED')

if __name__ == '__main__':
    output = ROOT / '.local/sheets-recovery-summary.json'
    output.parent.mkdir(exist_ok=True)
    try:
        summary = run()
        output.write_text(canonical(summary))
        print(canonical(summary))
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[A-Z_]+', str(error)) else type(error).__name__
        raise SystemExit('SHEETS_RECOVERY_STOPPED_NO_RETRY:' + code)
