"""Controlled release of the separate observer; never deploy the application."""
import json
import os
import re
from pathlib import Path
from cloudflare_diagnostics import Cloudflare
from d1_quota_checkpoint import observation
from d1_quota_control import DATABASE
from datetime import datetime, timezone
import urllib.request
import urllib.error

WORKER = 'mavi-basim-quota-observer'
APP = 'mavi-basim-seo-prod'
ROOT = Path(__file__).resolve().parents[1]


def require(value, code):
 if not value: raise ValueError(code)


def deployment_identity(client):
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self, *args, **kwargs): return None
 opener = urllib.request.build_opener(NoRedirect())
 def read(path):
  request = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
   headers={'Authorization': 'Bearer ' + client.token, 'Accept': 'application/json'})
  try:
   with opener.open(request, timeout=20) as response:
    raw = response.read(64001)
   if len(raw) > 64000: return {'ok': False, 'code': 'RESPONSE_LIMIT'}
   value = json.loads(raw)
   return {'ok': value.get('success') is True, 'result': value.get('result')}
  except urllib.error.HTTPError as error: return {'ok': False, 'code': 'HTTP_' + str(error.code)}
  except (OSError, ValueError): return {'ok': False, 'code': 'TRANSPORT_OR_JSON_ERROR'}
 result = read('/user/tokens/verify'); scope = '/user/tokens/'
 if not result.get('ok'):
  scope = '/accounts/' + client.account + '/tokens/'
  result = read(scope + 'verify')
 if not result.get('ok'): return {'verified': False, 'code': result.get('code')}
 record = result.get('result') or {}; token_id = record.get('id', '')
 if not re.fullmatch('[a-f0-9]{32}', token_id): return {'verified': False, 'code': 'TOKEN_ID_UNAVAILABLE'}
 details = read(scope + token_id)
 out = {'verified': True, 'token_id': token_id, 'status': record.get('status'),
        'token_details_access': details.get('ok') is True, 'token_details_code': details.get('code'),
        'application_account_suffix': client.account[-6:]}
 if details.get('ok'):
  metadata = details.get('result') or {}
  out['matches_expected_name'] = metadata.get('name') == 'mavi-basim-seo-deploy'
  out['policies'] = [{'effect': p.get('effect'),
     'permissions': [g.get('name') or g.get('id') for g in p.get('permission_groups', [])],
     'applies_to_application_account': ('com.cloudflare.api.account.' + client.account) in p.get('resources', {})
      or p.get('resources', {}).get('com.cloudflare.api.account') == '*'} for p in metadata.get('policies', [])]
 return out


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
 evidence={}
 if any(s.get('id') == WORKER for s in scripts.get('result', []) if isinstance(s, dict)):
  prefix=base+'/workers/scripts/'+WORKER
  schedules=client.request('GET',prefix+'/schedules')
  settings=client.request('GET',prefix+'/settings')
  evidence['schedules']=schedules
  if settings.get('ok'):
   bindings=settings['result'].get('bindings',[])
   evidence['enabled']=next((b.get('text') for b in bindings if b.get('name')=='QUOTA_OBSERVER_ENABLED'),None)
   evidence['analytics_secret_bound']=any(b.get('name')=='CF_QUOTA_ANALYTICS_TOKEN' and b.get('type')=='secret_text' for b in bindings)
  if sample.get('ok') and sample.get('mode') in ('open','slow'):
   data=client.request('POST',base+'/d1/database/'+DATABASE+'/query',{'sql':'SELECT day,observed_at,data_through,valid_until,mode,reason FROM d1_quota_state WHERE day=?','params':[datetime.now(timezone.utc).date().isoformat()]})
   evidence['checkpoint']=data
  start=int(datetime(2026,10,29,13,31,tzinfo=timezone.utc).timestamp()*1000)
  end=int(datetime(2026,10,29,13,34,tzinfo=timezone.utc).timestamp()*1000)
  logs=client.request('POST',base+'/workers/observability/telemetry/query',{'queryId':'observer-failure-read-only','dry':True,'timeframe':{'from':start,'to':end},'limit':20,'parameters':{'datasets':[WORKER],'view':'events'}})
  evidence['historical_logs_access']=logs.get('ok')
  evidence['historical_logs_code']=logs.get('code')
  encoded=json.dumps(logs.get('result',{}))
  evidence['runtime_codes']=sorted(set(re.findall(r'(?:OBSERVER_[A-Z_]+|LIVE_READ_GUARD_REQUIRED|UTC_DAY_CHANGED|ACCOUNT_BUDGET_HOLD|checkpoint_recorded|newer_checkpoint_preserved)',encoded)))
 return {'observer_evidence':evidence,'deployment_identity': deployment_identity(client),
         'application_present_in_bound_account': any(s.get('id') == APP for s in scripts.get('result', []) if isinstance(s, dict)),
         'read_only': True, 'runtime_token_available': bool(secret),
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
