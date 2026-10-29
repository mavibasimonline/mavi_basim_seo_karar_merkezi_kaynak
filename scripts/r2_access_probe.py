"""One read-only R2 authorization probe. Never requests D1 or writes any service."""
import json
import os
import re
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
account = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
if not token or not re.fullmatch('[a-f0-9]{32}', account):
    raise SystemExit('CF_BINDINGS_REQUIRED')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = urllib.request.build_opener(NoRedirect())
def read(path):
    if path != '/user/tokens/verify' and not path.startswith('/accounts/' + account + '/workers/scripts') and path != '/accounts/' + account + '/r2/buckets':
        raise ValueError('READ_ONLY_R2_PATH_REQUIRED')
    req = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
                                  headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'}, method='GET')
    try:
        response = opener.open(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(1_000_001)
        if len(raw) > 1_000_000:
            raise ValueError('METADATA_RESPONSE_LIMIT')
        data = json.loads(raw)
        meta = {'http_status': response.status, 'success': data.get('success'),
                'cf_error_codes': [e.get('code') for e in data.get('errors', [])],
                'known_errors': [e['message'] for e in data.get('errors', []) if e.get('message') in ('Authentication error', 'Unauthorized', 'Forbidden', 'Invalid access token')]}
        return meta, data.get('result')

result = {'observed_at': datetime.now(timezone.utc).isoformat(), 'read_only': True,
          'd1_requested': False, 'services_modified': False, 'test_objects_written': 0,
          'account_suffix': account[-6:], 'requests': {}}
meta, verified = read('/user/tokens/verify')
result['requests']['credential_verify'] = meta
if meta['success'] and isinstance(verified, dict):
    result['credential'] = {'id': verified.get('id'), 'status': verified.get('status')}
meta, scripts = read('/accounts/' + account + '/workers/scripts')
result['requests']['same_account_workers'] = meta
result['workers'] = []
if meta['success'] and isinstance(scripts, list):
    result['account_worker_count'] = len(scripts)
    for worker in scripts:
        name = worker.get('id', '')
        if not re.fullmatch('[A-Za-z0-9_-]{1,100}', name) or not re.search('mavi|gsc|seo|archive|backup|arsiv', name, re.I):
            continue
        settings_meta, settings = read('/accounts/' + account + '/workers/scripts/' + name + '/settings')
        row = {'name': name, 'settings': settings_meta}
        if settings_meta['success']:
            row['r2_bindings'] = [{k: binding[k] for k in ('name', 'type', 'bucket_name', 'jurisdiction') if k in binding}
                                  for binding in settings.get('bindings', []) if binding.get('type') == 'r2_bucket']
        schedules_meta, schedules = read('/accounts/' + account + '/workers/scripts/' + name + '/schedules')
        row['schedules'] = schedules_meta
        if schedules_meta['success']:
            rows = schedules.get('schedules', []) if isinstance(schedules, dict) else schedules
            row['crons'] = [s.get('cron') for s in rows]
        result['workers'].append(row)
meta, buckets = read('/accounts/' + account + '/r2/buckets')
result['requests']['r2_bucket_list'] = {'method': 'GET', 'path': '/accounts/<same-account>/r2/buckets', **meta}
if meta['success'] and isinstance(buckets, dict):
    result['r2_bucket_count'] = len(buckets.get('buckets', []))
    result['project_buckets'] = [b.get('name') for b in buckets.get('buckets', []) if re.search('mavi|gsc|seo|archive|backup|arsiv', b.get('name', ''), re.I)]
result['existing_s3_credentials'] = {name: bool(os.environ.get(name)) for name in (
    'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_API_TOKEN',
    'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME')}
folder = Path('.local'); folder.mkdir(exist_ok=True)
(folder / 'production-diagnostics.json').write_text(json.dumps(result, ensure_ascii=False))
print(json.dumps(result, ensure_ascii=False))
