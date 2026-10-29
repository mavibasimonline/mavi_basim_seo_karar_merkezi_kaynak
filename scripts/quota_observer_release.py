"""Controlled release of the separate observer; never deploy the application."""
import json
import os
import re
import hashlib
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from d1_quota_checkpoint import observation
from release_readiness import get_json, live_guard_deployment, REPOSITORY
from d1_quota_control import DATABASE

WORKER = 'mavi-basim-quota-observer'
APP = 'mavi-basim-seo-prod'
ROOT = Path(__file__).resolve().parents[1]
CRON = '2,17,32,47 * * * *'
APP_SOURCE = '8b56115f52ef2e7690927614365165ade4bfbdaa'


def require(value, code):
 if not value: raise ValueError(code)


def inspect(client):
 """Read-only access/plan discovery; deliberately excludes secret values."""
 base = '/accounts/' + client.account
 subscriptions = client.request('GET', base + '/subscriptions?per_page=100&page=1')
 scripts = client.request('GET', base + '/workers/scripts')
 tokens = client.request('GET', base + '/tokens?per_page=1')
 plans = []
 if subscriptions.get('ok'):
  for row in subscriptions['result']:
   plan = row.get('rate_plan', {})
   plans.append({k: plan.get(k) for k in ('id', 'public_name', 'currency', 'scope')})
 secret = os.environ.get('CF_QUOTA_ANALYTICS_TOKEN')
 return {'read_only': True, 'runtime_token_available': bool(secret),
         'separate_token_required': True,
         'account_token_metadata_access': tokens.get('ok') is True,
         'subscriptions_access': subscriptions.get('ok') is True,
         'plans': plans,
         'worker_inventory_access': scripts.get('ok') is True,
         'worker_count': len(scripts['result']) if scripts.get('ok') else None,
         'observer_exists': any(r.get('id') == WORKER for r in scripts.get('result', []) if isinstance(r, dict))}


def api(client, method, path, body=None):
 result = client.request(method, '/accounts/' + client.account + path, body)
 require(result.get('ok') is True, 'OBSERVER_CONTROL_PLANE_ACCESS_REQUIRED')
 return result['result']


def cron_rows(value):
 rows = value.get('schedules', []) if isinstance(value, dict) else value
 require(isinstance(rows, list), 'OBSERVER_SCHEDULE_METADATA_REQUIRED')
 return [r['cron'] for r in rows]


def active_version(value):
 rows = value.get('deployments', []) if isinstance(value, dict) else value
 require(isinstance(rows, list) and rows, 'OBSERVER_VERSION_METADATA_REQUIRED')
 versions = max(rows, key=lambda r: r.get('created_on', '')).get('versions', [])
 require(len(versions) == 1 and versions[0].get('percentage') == 100,
         'SINGLE_OBSERVER_VERSION_REQUIRED')
 version = versions[0].get('version_id', '')
 require(bool(re.fullmatch('[a-f0-9-]{36}', version)), 'OBSERVER_VERSION_METADATA_REQUIRED')
 return version


def application_lock(client):
 base = '/workers/scripts/' + APP
 version = active_version(api(client, 'GET', base + '/deployments'))
 settings = api(client, 'GET', base + '/settings')
 bindings = settings.get('bindings', [])
 plain = {b['name']: b.get('text') for b in bindings if b.get('type') == 'plain_text'}
 require(any(b.get('name') == 'DB' and b.get('type') == 'd1' and
             (b.get('id') or b.get('database_id')) == DATABASE for b in bindings), 'APP_DATABASE_DRIFT')
 require(plain.get('D1_READ_GUARD_ENABLED') == 'true', 'APP_READ_GUARD_REQUIRED')
 crons = cron_rows(api(client, 'GET', base + '/schedules'))
 require(crons == ['*/15 * * * *'], 'APP_CRON_DRIFT')
 live = live_guard_deployment()
 require(live and live['commit'] == APP_SOURCE and live['version_id'] == version,
         'APP_SOURCE_OR_VERSION_MISMATCH')
 signature = hashlib.sha256(json.dumps(sorted(bindings, key=lambda b: b.get('name', '')),
                                      sort_keys=True).encode()).hexdigest()
 return {'version': version, 'commit': APP_SOURCE, 'bindings_digest': signature, 'crons': crons}


def free_plan(subscriptions):
 require(isinstance(subscriptions, list) and len(subscriptions) < 100,
         'FREE_PLAN_VERIFICATION_REQUIRED')
 for subscription in subscriptions:
  require(isinstance(subscription, dict) and isinstance(subscription.get('rate_plan'), dict),
          'FREE_PLAN_VERIFICATION_REQUIRED')
  plan = subscription['rate_plan']
  require(isinstance(plan.get('id'), str) and bool(plan['id']) and
          isinstance(plan.get('public_name'), str) and bool(plan['public_name']),
          'FREE_PLAN_VERIFICATION_REQUIRED')
  label = ' '.join(str(plan.get(k, '')) for k in ('id', 'public_name', 'scope')).lower()
  # Workers Free is the default without a Workers subscription. Unknown paid
  # Workers plans must never silently become a billable deployment.
  if 'worker' in label:
   require('free' in label, 'WORKERS_FREE_PLAN_REQUIRED')
 return True


def validate_config(config):
 require(config.get('name') == WORKER and config.get('main') == '../src/quota-observer.ts',
         'OBSERVER_CONFIG_REJECTED')
 require(config.get('workers_dev') is False and config.get('preview_urls') is False,
         'PUBLIC_OBSERVER_FORBIDDEN')
 require(set(config) <= {'$schema', 'name', 'main', 'compatibility_date', 'workers_dev',
         'preview_urls', 'd1_databases', 'vars', 'triggers', 'observability', 'version_metadata'},
         'OBSERVER_RESOURCE_OR_LIMIT_CHANGE_FORBIDDEN')
 require(config.get('d1_databases') == [{'binding': 'DB', 'database_name': 'mavi-basim-seo',
                                     'database_id': DATABASE}], 'OBSERVER_DATABASE_DRIFT')
 require(config.get('vars') == {'QUOTA_OBSERVER_ENABLED': 'false', 'CLOUDFLARE_ACCOUNT_ID': ''}
         and config.get('triggers') == {'crons': [CRON]}
         and config.get('version_metadata') == {'binding': 'CF_VERSION_METADATA'},
         'OBSERVER_CONFIG_REJECTED')


def preflight(client, sha, github=None):
 require(os.environ.get('GITHUB_REF') == 'refs/heads/main' and
         bool(re.fullmatch('[a-f0-9]{40}', sha or '')), 'EXACT_MAIN_RELEASE_REQUIRED')
 github = github or (lambda path: get_json('https://api.github.com/repos/' + REPOSITORY + path,
                                         os.environ.get('GITHUB_TOKEN')))
 require(github('/branches/main').get('commit', {}).get('sha') == sha, 'RELEASE_COMMIT_SUPERSEDED')
 runs = github('/actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=' + sha + '&per_page=20')
 require(any(r.get('head_sha') == sha and r.get('head_branch') == 'main' and
             r.get('event') == 'push' and r.get('conclusion') == 'success' and
             r.get('status') == 'completed' for r in runs.get('workflow_runs', [])),
         'SUCCESSFUL_EXACT_MAIN_CI_REQUIRED')
 token = os.environ.get('CF_QUOTA_ANALYTICS_TOKEN')
 require(bool(token) and token != client.token and not re.search(r'[\r\n]', token),
         'SEPARATE_ANALYTICS_READ_TOKEN_REQUIRED')
 free_plan(api(client, 'GET', '/subscriptions?per_page=100&page=1'))
 scripts = api(client, 'GET', '/workers/scripts')
 require(isinstance(scripts, list) and len(scripts) < 100, 'FREE_WORKER_LIMIT_REQUIRED')
 total_crons = 0
 for script in scripts:
  name = script.get('id', '')
  require(bool(re.fullmatch('[A-Za-z0-9_-]{1,63}', name)), 'WORKER_INVENTORY_INVALID')
  schedules = cron_rows(api(client, 'GET', '/workers/scripts/' + name + '/schedules'))
  total_crons += len(schedules) if name != WORKER else 0
  if name == WORKER:
   # A first installation may resume only our dormant Worker, never overwrite
   # an unrelated/active Worker with the same name.
   settings = api(client, 'GET', '/workers/scripts/' + name + '/settings')
   plain = {b['name']: b.get('text') for b in settings.get('bindings', [])
            if b.get('type') == 'plain_text'}
   require(plain.get('QUOTA_OBSERVER_ENABLED') == 'false' and not schedules,
           'EXISTING_ACTIVE_OBSERVER_REQUIRES_REVIEW')
 require(total_crons + 1 <= 5, 'FREE_CRON_LIMIT_REQUIRED')
 sample = observation(Cloudflare(token, client.account))
 require(sample.get('ok') and sample.get('mode') in ('open', 'slow'),
         'READ_ONLY_ANALYTICS_OR_CURRENT_QUOTA_REQUIRED')
 config = json.loads((ROOT / 'deploy/wrangler.quota-observer.jsonc').read_text())
 validate_config(config)
 # The bundle imports existing limits. They must be byte-identical to live.
 for path in ('src/d1-read-budget.ts', 'src/types.ts'):
  require(subprocess.check_output(['git', 'show', APP_SOURCE + ':' + path], cwd=ROOT) ==
          (ROOT / path).read_bytes(), 'LIVE_GUARD_SOURCE_PARITY_REQUIRED')
 return {'main_sha': sha, 'app': application_lock(client), 'free_plan_verified': True,
         'existing_crons': total_crons, 'runtime_token': token, 'config': config}


def publish(config, sha, account, enabled):
 folder = ROOT / '.local/quota-observer-release'
 folder.mkdir(parents=True, exist_ok=True)
 deployed = {**config, 'main': '../../src/quota-observer.ts',
             'vars': {'QUOTA_OBSERVER_ENABLED': str(enabled).lower(), 'CLOUDFLARE_ACCOUNT_ID': account},
             'triggers': {'crons': [CRON] if enabled else []}}
 path = folder / 'wrangler.jsonc'
 path.write_text(json.dumps(deployed))
 log_path = folder / ('enable.log' if enabled else 'dormant.log')
 with log_path.open('w') as log:
  log_path.chmod(0o600)
  result = subprocess.run(['node', 'scripts/run.mjs', 'wrangler', 'deploy', '--config',
                          str(path), '--tag', sha, '--message', 'Independent quota observer'],
                         cwd=ROOT, stdout=log, stderr=log)
 require(result.returncode == 0, 'OBSERVER_DEPLOY_FAILED')
 return path


def observer_settings(client, sha, enabled):
 base = '/workers/scripts/' + WORKER
 version = active_version(api(client, 'GET', base + '/deployments'))
 metadata = api(client, 'GET', base + '/versions/' + version)
 require(metadata.get('annotations', {}).get('workers/tag') == sha, 'OBSERVER_COMMIT_MISMATCH')
 bindings = api(client, 'GET', base + '/settings').get('bindings', [])
 expected = {'DB', 'CF_VERSION_METADATA', 'QUOTA_OBSERVER_ENABLED', 'CLOUDFLARE_ACCOUNT_ID'}
 require(expected <= {b.get('name') for b in bindings} <= expected | {'CF_QUOTA_ANALYTICS_TOKEN'},
         'OBSERVER_BINDING_DRIFT')
 require(any(b.get('name') == 'DB' and b.get('type') == 'd1' and
             (b.get('id') or b.get('database_id')) == DATABASE for b in bindings), 'OBSERVER_DATABASE_DRIFT')
 plain = {b['name']: b.get('text') for b in bindings if b.get('type') == 'plain_text'}
 require(plain == {'QUOTA_OBSERVER_ENABLED': str(enabled).lower(), 'CLOUDFLARE_ACCOUNT_ID': client.account},
         'OBSERVER_BINDING_DRIFT')
 if enabled:
  require(any(b.get('name') == 'CF_QUOTA_ANALYTICS_TOKEN' and b.get('type') == 'secret_text'
              for b in bindings), 'OBSERVER_RUNTIME_SECRET_REQUIRED')
 require(cron_rows(api(client, 'GET', base + '/schedules')) == ([CRON] if enabled else []),
         'OBSERVER_SCHEDULE_DRIFT')
 subdomain = api(client, 'GET', base + '/subdomain')
 require(subdomain.get('enabled') is False and subdomain.get('previews_enabled') is False,
         'PUBLIC_OBSERVER_FORBIDDEN')
 return version


def recorded_event(event, sha, version, activated):
 if event.get('scriptName') != WORKER or event.get('event', {}).get('cron') != CRON:
  return None
 stamp = event.get('eventTimestamp')
 if not isinstance(stamp, (int, float)) or stamp / 1000 < activated:
  return None
 require(event.get('outcome') == 'ok' and not event.get('exceptions'), 'OBSERVER_SCHEDULED_EXECUTION_FAILED')
 for log in event.get('logs', []):
  for message in log.get('message', []):
   try: result = json.loads(message)
   except (ValueError, TypeError): continue
   if not isinstance(result, dict) or result.get('event') != 'quota-observer': continue
   require(result.get('commit') == sha and result.get('version_id') == version,
           'OBSERVER_SCHEDULED_VERSION_MISMATCH')
   require(result.get('status') == 'checkpoint_recorded', 'OBSERVER_SCHEDULED_CHECKPOINT_NOT_RECORDED')
   require(all(type(result.get(k)) is int and 0 <= result[k] <= 10
               for k in ('rows_read', 'rows_written')), 'OBSERVER_COST_METADATA_REQUIRED')
   return result
 return None


def persisted_checkpoint(state, record, now):
 try:
  observed = datetime.fromisoformat(state['observed_at'].replace('Z', '+00:00'))
  source = datetime.fromisoformat(state['data_through'].replace('Z', '+00:00'))
  until = datetime.fromisoformat(state['valid_until'].replace('Z', '+00:00'))
  recorded = datetime.fromisoformat(record['observed_at'].replace('Z', '+00:00'))
  day_end = datetime.fromisoformat(state['day']).replace(tzinfo=timezone.utc).timestamp() + 86400
  return (state['day'] == now.date().isoformat() and observed >= recorded and
          0 <= (now - observed).total_seconds() < 75 * 60 and
          0 <= (now - source).total_seconds() <= 2 * 3600 and
          now < until and 0 < (until - observed).total_seconds() <= 75 * 60 and
          until.timestamp() <= day_end and state['mode'] in ('open', 'slow') and
          type(state['account_reads']) is int and 0 <= state['account_reads'] < 3_500_000 and
          type(state['account_writes']) is int and 0 <= state['account_writes'] < 85_000)
 except (ValueError, TypeError, KeyError): return False


def scheduled_acceptance(client, sha, version, config_path, activated):
 """Observe a genuine Cloudflare Cron event; no public/manual renewal endpoint."""
 folder = ROOT / '.local/quota-observer-release'
 path = folder / 'tail.log'
 with path.open('w') as output:
  path.chmod(0o600)
  process = subprocess.Popen(['node', 'scripts/run.mjs', 'wrangler', 'tail', '--config',
                             str(config_path), '--format', 'json'], cwd=ROOT, stdout=output, stderr=output)
  try:
   deadline = time.monotonic() + 32 * 60
   while time.monotonic() < deadline:
    require(process.poll() is None, 'OBSERVER_SCHEDULED_LOG_ACCESS_REQUIRED')
    text = path.read_text()
    require(len(text) < 1_000_000, 'OBSERVER_LOG_SIZE_LIMIT')
    decoder = json.JSONDecoder()
    offset = 0
    while offset < len(text):
     start = text.find('{', offset)
     if start < 0: break
     try: event, size = decoder.raw_decode(text[start:])
     except ValueError: break
     offset = start + size
     if isinstance(event, dict):
      record = recorded_event(event, sha, version, activated)
      if record:
       current = observation(client)
       require(current.get('ok') and current.get('mode') in ('open', 'slow'), 'CURRENT_ACCOUNT_QUOTA_REQUIRED')
       result = api(client, 'POST', '/d1/database/' + DATABASE + '/query', {
        'sql': 'SELECT day,observed_at,data_through,valid_until,account_reads,account_writes,mode FROM d1_quota_state WHERE day=?',
        'params': [datetime.now(timezone.utc).date().isoformat()]})
       rows = [row for statement in result for row in statement.get('results', [])]
       require(len(rows) == 1, 'PERSISTED_CHECKPOINT_REQUIRED')
       require(persisted_checkpoint(rows[0], record, datetime.now(timezone.utc)),
               'PERSISTED_CURRENT_QUOTA_REQUIRED')
       return {'scheduled_checkpoint_verified': True, 'rows_read': record['rows_read'],
               'rows_written': record['rows_written'], 'version': version, 'commit': sha}
    time.sleep(5)
   raise ValueError('REAL_SCHEDULED_OBSERVER_ACCEPTANCE_PENDING')
  finally:
   process.terminate()
   try: process.wait(timeout=10)
   except subprocess.TimeoutExpired: process.kill(); process.wait()


def deploy(client, sha):
 saved = preflight(client, sha)
 mutated = False
 try:
  mutated = True
  publish(saved['config'], sha, client.account, False)
  observer_settings(client, sha, False)
  # Only the separately supplied read-only token enters the new runtime.
  api(client, 'PUT', '/workers/scripts/' + WORKER + '/secrets',
      {'name': 'CF_QUOTA_ANALYTICS_TOKEN', 'type': 'secret_text', 'text': saved['runtime_token']})
  require(application_lock(client) == saved['app'], 'APPLICATION_CHANGED_DURING_OBSERVER_RELEASE')
  activated = time.time()
  path = publish(saved['config'], sha, client.account, True)
  version = observer_settings(client, sha, True)
  accepted = scheduled_acceptance(client, sha, version, path, activated)
  require(application_lock(client) == saved['app'], 'APPLICATION_CHANGED_DURING_OBSERVER_RELEASE')
  # Existing guard + actual D1 API acceptance, using the unchanged selected source.
  environment = {**os.environ, 'RELEASE_SOURCE_COMMIT': APP_SOURCE}
  result = subprocess.run(['python3', 'scripts/performance_acceptance.py'], cwd=ROOT, env=environment)
  require(result.returncode == 0, 'GUARDED_PERFORMANCE_ACCEPTANCE_FAILED')
  print(json.dumps({**accepted, 'application_preserved': True, 'free_plan_verified': True}))
 except Exception:
  if mutated:
   # Stop only this observer. Never reset state or touch the application's Cron.
   api(client, 'PUT', '/workers/scripts/' + WORKER + '/schedules', [])
   require(cron_rows(api(client, 'GET', '/workers/scripts/' + WORKER + '/schedules')) == [],
           'OBSERVER_SCHEDULE_STOP_UNVERIFIED')
  raise


if __name__ == '__main__':
 import sys
 try:
  client = Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'), os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
  if sys.argv[1:] == ['inspect']: print(json.dumps(inspect(client), ensure_ascii=False, indent=2))
  elif sys.argv[1:] == ['deploy']: deploy(client, os.environ.get('GITHUB_SHA'))
  else: raise ValueError('OBSERVER_OPERATION_NOT_REVIEWED')
 except Exception as error:
  code = str(error) if isinstance(error, ValueError) and re.fullmatch('[A-Z_]+', str(error)) else type(error).__name__
  raise SystemExit('OBSERVER_RELEASE_STOPPED:' + code)
