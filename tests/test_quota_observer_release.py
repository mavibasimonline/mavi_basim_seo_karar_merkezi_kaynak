import importlib
import json
import os
import sys
import subprocess
import unittest
import io
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
release = importlib.import_module('quota_observer_release')
SHA = 'c' * 40
VERSION = '11111111-1111-4111-8111-111111111111'


class Client:
 account = 'a' * 32
 token = 'TEST_DEPLOY_IDENTITY'
 def __init__(self): self.calls = []
 def request(self, method, path, body=None):
  self.calls.append((method, path, body))
  return {'ok': False}


def ci(path):
 if path == '/branches/main': return {'commit': {'sha': SHA}}
 return {'workflow_runs': [{'head_sha': SHA, 'head_branch': 'main', 'event': 'push',
                           'conclusion': 'success', 'status': 'completed'}]}


def scheduled():
 return {'scriptName': release.WORKER, 'event': {'cron': release.CRON},
         'eventTimestamp': 2000, 'outcome': 'ok', 'exceptions': [],
         'logs': [{'message': [json.dumps({'event': 'quota-observer', 'commit': SHA,
          'version_id': VERSION, 'status': 'checkpoint_recorded', 'rows_read': 1,
          'rows_written': 1, 'observed_at': '2026-10-29T12:17:00.000Z'})]}]}


class ObserverReleaseTests(unittest.TestCase):
 def test_only_the_exact_reviewed_stopped_observer_can_resume(self):
  client = Client()
  settings = {'bindings': [
   {'name': 'DB', 'type': 'd1', 'id': release.DATABASE},
   {'name': 'CF_VERSION_METADATA', 'type': 'version_metadata'},
   {'name': 'QUOTA_OBSERVER_ENABLED', 'type': 'plain_text', 'text': 'true'},
   {'name': 'CLOUDFLARE_ACCOUNT_ID', 'type': 'plain_text', 'text': client.account},
   {'name': 'CF_QUOTA_ANALYTICS_TOKEN', 'type': 'secret_text'}]}
  deployments = {'deployments': [{'created_on': '2026-10-29', 'versions': [
   {'version_id': VERSION, 'percentage': 100}]}]}
  metadata = {'annotations': {'workers/tag': release.FAILED_OBSERVER_SOURCE}}
  with patch.object(release, 'api', side_effect=[deployments, metadata]):
   release.verify_stopped_observer(client, settings, [], VERSION)
  for crons, pin in ([release.CRON], VERSION), ([], ''), ([], 'invalid'):
   with patch.object(release, 'api') as api, self.assertRaises(ValueError):
    release.verify_stopped_observer(client, settings, crons, pin)
   api.assert_not_called()
  with patch.object(release, 'api', return_value=deployments):
   with self.assertRaisesRegex(ValueError, 'STOPPED_OBSERVER_VERSION_CHANGED'):
    release.verify_stopped_observer(client, settings, [], '22222222-2222-4222-8222-222222222222')
  with patch.object(release, 'api', side_effect=[deployments, {'annotations': {'workers/tag': 'd'*40}}]):
   with self.assertRaisesRegex(ValueError, 'STOPPED_OBSERVER_SOURCE_CHANGED'):
    release.verify_stopped_observer(client, settings, [], VERSION)

 def test_rejected_event_retains_safe_reason_and_phase_without_private_payloads(self):
  event = scheduled()
  result = {'event': 'quota-observer', 'commit': SHA, 'version_id': VERSION,
            'status': 'held', 'code': 'OBSERVER_UNAVAILABLE_NO_RETRY', 'phase': 'health'}
  for code, phase in [('OBSERVER_UNAVAILABLE_NO_RETRY', 'health'), ('TEST_PRIVATE_TOKEN', 'TEST_PRIVATE_URL')]:
   event['logs'][0]['message'] = [json.dumps({**result, 'code': code, 'phase': phase})]
   output = io.StringIO()
   with redirect_stdout(output), self.assertRaisesRegex(ValueError, 'OBSERVER_SCHEDULED_CHECKPOINT_NOT_RECORDED'):
    release.recorded_event(event, SHA, VERSION, 1)
   safe = json.loads(output.getvalue())
   if code == result['code']:
    self.assertEqual((safe['code'], safe['phase']), (code, phase))
   else:
    self.assertEqual(safe['code'], 'UNKNOWN_OBSERVER_RESULT'); self.assertIsNone(safe['phase'])
   self.assertNotIn('TEST_PRIVATE', output.getvalue())

 def test_inspection_and_publication_use_the_unpaginated_subscriptions_api(self):
  client = Client()
  def request(method, path, body=None):
   self.assertEqual(method, 'GET')
   self.assertIsNone(body)
   client.calls.append((method, path, body))
   if '/subscriptions' in path:
    return {'ok': True, 'result': []} if path.endswith('/subscriptions') else {'ok': False, 'code': 'HTTP_400'}
   return {'ok': True, 'result': []}
  client.request = request
  self.assertTrue(release.inspect(client)['subscriptions_access'])
  client.calls.clear()
  with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main', 'CF_QUOTA_ANALYTICS_TOKEN': 'TEST_ANALYTICS_ONLY'}), \
       patch.object(release, 'observation', return_value={'ok': True, 'mode': 'open'}), \
       patch.object(release, 'application_lock', return_value={'fixture': True}), \
       patch.object(release, 'APP_SOURCE', subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip()):
   self.assertTrue(release.preflight(client, SHA, ci)['free_plan_verified'])
  self.assertIn(('GET', '/accounts/' + client.account + '/subscriptions', None), client.calls)

 def test_changed_guard_tree_still_fails_the_production_parity_gate(self):
  client = Client()
  def request(method, path, body=None):
   if path.endswith('/subscriptions'):return {'ok': True, 'result': []}
   if path.endswith('/workers/scripts'):return {'ok': True, 'result': []}
   return {'ok': False}
  client.request = request
  with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main', 'CF_QUOTA_ANALYTICS_TOKEN': 'TEST_ANALYTICS_ONLY'}), \
       patch.object(release, 'observation', return_value={'ok': True, 'mode': 'open'}):
   with self.assertRaisesRegex(ValueError, 'LIVE_GUARD_SOURCE_PARITY_REQUIRED'):
    release.preflight(client, SHA, ci)

 def test_real_free_plan_is_required_and_unknown_workers_plans_are_held(self):
  self.assertTrue(release.free_plan([]))
  self.assertTrue(release.free_plan([{'rate_plan': {'id': 'workers_free', 'public_name': 'Workers Free'}}]))
  for plan in ('workers_paid', 'workers_standard', 'workers_enterprise'):
   with self.assertRaisesRegex(ValueError, 'WORKERS_FREE_PLAN_REQUIRED'):
    release.free_plan([{'rate_plan': {'id': plan, 'public_name': plan}}])
  for invalid in (None, {}, [{}] * 100, [{}], [{'rate_plan': {'id': 'unknown'}}]):
   with self.assertRaises(ValueError): release.free_plan(invalid)

 def test_public_routes_extra_resources_wrong_db_and_raised_cpu_are_rejected(self):
  original = json.loads((ROOT / 'deploy/wrangler.quota-observer.jsonc').read_text())
  release.validate_config(original)
  for key, value in [('route', 'mavibasim.com/*'), ('workers_dev', True),
                     ('preview_urls', True), ('limits', {'cpu_ms': 100}),
                     ('assets', {'directory': '../public'}), ('name', release.APP),
                     ('d1_databases', [{'binding': 'DB', 'database_id': 'other'}]),
                     ('services', []),
                     ('services', [{'binding': 'APP_HEALTH', 'service': 'wrong-worker'}]),
                     ('compatibility_flags', ['global_fetch_private_origin'])]:
   config = {**original, key: value}
   with self.subTest(key=key), self.assertRaises(ValueError): release.validate_config(config)

 def test_missing_or_reused_deploy_token_stops_before_any_cloudflare_mutation(self):
  client = Client()
  for token in ('', client.token, 'TEST\nunsafe'):
   with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main', 'CF_QUOTA_ANALYTICS_TOKEN': token}):
    with self.assertRaisesRegex(ValueError, 'SEPARATE_ANALYTICS_READ_TOKEN_REQUIRED'):
     release.preflight(client, SHA, ci)
   self.assertEqual(client.calls, [])

 def test_exact_green_main_is_required_before_any_access_or_deployment(self):
  client = Client()
  with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/main'}):
   for github in (lambda _: {}, lambda path: {'commit': {'sha': SHA}} if path == '/branches/main' else {}):
    with self.assertRaises(ValueError): release.preflight(client, SHA, github)
  with patch.dict(os.environ, {'GITHUB_REF': 'refs/heads/feature'}):
   with self.assertRaisesRegex(ValueError, 'EXACT_MAIN_RELEASE_REQUIRED'):
    release.preflight(client, SHA, ci)
  self.assertEqual(client.calls, [])

 def test_real_current_scheduled_success_requires_the_released_version_and_measured_cost(self):
  self.assertEqual(release.recorded_event(scheduled(), SHA, VERSION, 1)['rows_read'], 1)
  self.assertIsNone(release.recorded_event(scheduled(), SHA, VERSION, 3))
  for event in ({**scheduled(), 'outcome': 'exceededCpu'},
                {**scheduled(), 'exceptions': [{'name': 'TEST'}]}):
   with self.assertRaisesRegex(ValueError, 'OBSERVER_SCHEDULED_EXECUTION_FAILED'):
    release.recorded_event(event, SHA, VERSION, 1)
  for field, value in [('version_id', 'other'), ('commit', 'd' * 40),
                       ('rows_read', 11), ('rows_written', -1), ('status', 'held')]:
   event = scheduled()
   log = json.loads(event['logs'][0]['message'][0]); log[field] = value
   event['logs'][0]['message'] = [json.dumps(log)]
   with self.subTest(field=field), self.assertRaises(ValueError):
    release.recorded_event(event, SHA, VERSION, 1)

 def test_split_traffic_cannot_pass_version_lock(self):
  record = {'deployments': [{'created_on': '2026-10-29', 'versions': [
   {'version_id': VERSION, 'percentage': 50}, {'version_id': VERSION, 'percentage': 50}]}]}
  with self.assertRaisesRegex(ValueError, 'SINGLE_OBSERVER_VERSION_REQUIRED'):
   release.active_version(record)

 def test_persisted_lease_requires_real_current_utc_day_and_unchanged_limits(self):
  state = {'day': '2026-10-29', 'observed_at': '2026-10-29T12:17:00Z',
           'data_through': '2026-10-29T12:00:00Z', 'valid_until': '2026-10-29T13:32:00Z',
           'account_reads': 10000, 'account_writes': 1000, 'mode': 'open'}
  now = datetime(2026, 10, 29, 12, 18, tzinfo=timezone.utc)
  record = {'observed_at': state['observed_at']}
  self.assertTrue(release.persisted_checkpoint(state, record, now))
  for key, value in [('day', '2026-10-28'), ('observed_at', '2026-10-29T12:19:00Z'),
                     ('data_through', '2026-10-29T10:00:00Z'),
                     ('data_through', '2026-10-29T13:00:00Z'),
                     ('valid_until', '2026-10-29T12:17:00Z'),
                     ('valid_until', '2026-10-29T13:33:00Z'), ('mode', 'blocked'),
                     ('account_reads', 3500000), ('account_writes', 85000),
                     ('account_reads', -1), ('account_reads', True)]:
   with self.subTest(key=key, value=value):
    self.assertFalse(release.persisted_checkpoint({**state, key: value}, record, now))

 def test_preflight_failure_does_not_publish_or_stop_any_schedules(self):
  client = Client()
  with patch.object(release, 'preflight', side_effect=ValueError('MISSING_ACCESS')), \
       patch.object(release, 'publish') as publish:
   with self.assertRaisesRegex(ValueError, 'MISSING_ACCESS'): release.deploy(client, SHA)
  publish.assert_not_called(); self.assertEqual(client.calls, [])

 def test_failed_release_stops_only_the_new_observer_without_touching_d1_or_application(self):
  client = Client()
  def request(method, path, body=None):
   client.calls.append((method, path, body))
   return {'ok': True, 'result': []}
  client.request = request
  with patch.object(release, 'preflight', return_value={'config': {}}), \
       patch.object(release, 'publish', side_effect=ValueError('TEST_DEPLOY_FAILED')):
   with self.assertRaisesRegex(ValueError, 'TEST_DEPLOY_FAILED'): release.deploy(client, SHA)
  self.assertEqual([(method, path, body) for method, path, body in client.calls], [
   ('PUT', '/accounts/' + client.account + '/workers/scripts/' + release.WORKER + '/schedules', []),
   ('GET', '/accounts/' + client.account + '/workers/scripts/' + release.WORKER + '/schedules', None)])


if __name__ == '__main__': unittest.main()
