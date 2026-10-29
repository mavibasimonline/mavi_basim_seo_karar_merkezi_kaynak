"""Controlled release of the separate observer; never deploy the application."""
import json
import os
import re
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from d1_quota_checkpoint import observation

WORKER = 'mavi-basim-quota-observer'
APP = 'mavi-basim-seo-prod'
ROOT = Path(__file__).resolve().parents[1]


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
 plain_subscriptions = client.request('GET', base + '/subscriptions')
 sample = observation(Cloudflare(secret, client.account)) if secret else {'ok': False, 'reason': 'MISSING_SECRET'}
 return {'read_only': True, 'runtime_token_available': bool(secret),
         'separate_token_required': True,
         'account_token_metadata_access': tokens.get('ok') is True,
         'subscriptions_access': subscriptions.get('ok') is True,
         'plans': plans,
         'subscriptions_error': {k: subscriptions.get(k) for k in ('code','error_codes')},
         'plain_subscriptions_access': plain_subscriptions.get('ok') is True,
         'plain_subscriptions_error': {k: plain_subscriptions.get(k) for k in ('code','error_codes')},
         'analytics_token_verified': sample.get('ok') is True,
         'analytics_status': sample.get('mode') or sample.get('reason'),
         'worker_inventory_access': scripts.get('ok') is True,
         'worker_count': len(scripts['result']) if scripts.get('ok') else None,
         'observer_exists': any(r.get('id') == WORKER for r in scripts.get('result', []) if isinstance(r, dict))}


if __name__ == '__main__':
 import sys
 try:
  client = Cloudflare(os.environ.get('CLOUDFLARE_API_TOKEN'), os.environ.get('CLOUDFLARE_ACCOUNT_ID'))
  require(sys.argv[1:] == ['inspect'], 'OBSERVER_OPERATION_NOT_REVIEWED')
  print(json.dumps(inspect(client), ensure_ascii=False, indent=2))
 except Exception as error:
  code = str(error) if isinstance(error, ValueError) and re.fullmatch('[A-Z_]+', str(error)) else type(error).__name__
  raise SystemExit('OBSERVER_RELEASE_STOPPED:' + code)
