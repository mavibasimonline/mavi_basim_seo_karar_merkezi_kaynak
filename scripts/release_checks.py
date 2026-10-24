"""Offline release gates. Prints rule names/paths, never matching secret values."""
import argparse
import json
import re
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'github-token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b'),
    'google-client-secret': re.compile(r'\bGOCSPX-[A-Za-z0-9_-]{20,}\b'),
    'google-api-key': re.compile(r'\bAIza[0-9A-Za-z_-]{30,}\b'),
    'google-refresh-token': re.compile(r'\b1//[A-Za-z0-9_-]{30,}\b'),
    'environment-credential': re.compile(r'^[ \t]*(?:ADMIN_TOKEN|TOKEN_ENCRYPTION_KEY|GOOGLE_CLIENT_SECRET|BACKUP_ENCRYPTION_KEY)[ \t]*=[ \t]*[\"\']?[A-Za-z0-9_+/=-]{20,}', re.M),
}


def secret_rules(text):
    return [name for name, pattern in PATTERNS.items() if pattern.search(text)]


def config_errors(config, ready=False, bootstrap=False):
    errors = []
    if config.get('routes') or config.get('route'):
        errors.append('SITE_ROUTE_FORBIDDEN')
    if config.get('workers_dev') is not True:
        errors.append('SEPARATE_WORKERS_DEV_REQUIRED')
    if config.get('name') != 'mavi-basim-seo-prod':
        errors.append('UNEXPECTED_WORKER_NAME')
    if any(config.get(field) for field in ('r2_buckets', 'containers', 'queues', 'durable_objects', 'limits', 'logpush')):
        errors.append('UNREVIEWED_RESOURCE_OR_PAID_LIMIT')
    bindings = config.get('d1_databases', [])
    if len(bindings) != 1 or bindings[0].get('binding') != 'DB':
        errors.append('UNEXPECTED_D1_BINDING')
    variables = config.get('vars', {})
    if any(key in variables for key in ('ADMIN_TOKEN', 'TOKEN_ENCRYPTION_KEY', 'GOOGLE_CLIENT_SECRET', 'BACKUP_ENCRYPTION_KEY')):
        errors.append('SECRET_IN_CONFIG')
    if variables.get('SITE_ORIGIN') != 'https://mavibasim.com' or variables.get('ENABLE_GOOGLE_ADS') != 'false':
        errors.append('UNEXPECTED_SOURCE_OR_ADS_ENABLED')
    if variables.get('GSC_PROPERTY') not in ('https://mavibasim.com/', 'sc-domain:mavibasim.com'):
        errors.append('UNEXPECTED_GSC_PROPERTY')
    if variables.get('GA4_PROPERTY_ID', '') and not re.fullmatch(r'[1-9][0-9]*', variables['GA4_PROPERTY_ID']):
        errors.append('INVALID_GA4_PROPERTY_ID')
    cron = config.get('triggers', {}).get('crons', [])
    enabled = variables.get('AUTOMATION_ENABLED') == 'true'
    if cron not in ([], ['*/15 * * * *']) or variables.get('CRAWL_ENABLED') not in ('false', 'true') or variables.get('AUTOMATION_ENABLED') not in ('false', 'true'):
        errors.append('UNREVIEWED_AUTOMATION_SETTINGS')
    if variables.get('COMPETITOR_CRAWL_ENABLED','false') not in ('false','true'):
        errors.append('UNREVIEWED_COMPETITOR_SETTINGS')
    if not enabled and (cron or variables.get('CRAWL_ENABLED') == 'true' or variables.get('COMPETITOR_CRAWL_ENABLED') == 'true'):
        errors.append('AUTOMATION_OPT_IN_REQUIRED')
    if (ready or bootstrap) and (variables.get('CRAWL_ENABLED') != 'false' or variables.get('COMPETITOR_CRAWL_ENABLED','false') != 'false' or cron or enabled):
        errors.append('AUTOMATION_NOT_HELD_FOR_ACCEPTANCE')
    if ready or enabled:
        database_id = bindings[0].get('database_id', '') if len(bindings) == 1 else ''
        try:
            valid_id = str(uuid.UUID(database_id)) == database_id.lower() and uuid.UUID(database_id).int != 0
        except (ValueError, AttributeError):
            valid_id = False
        if not valid_id:
            errors.append('D1_ACCOUNT_AUTHORIZATION_REQUIRED')
        redirect = variables.get('GOOGLE_REDIRECT_URI', '')
        if not re.fullmatch(r'https://mavi-basim-seo-prod\.[a-z0-9-]+\.workers\.dev/api/oauth/google/callback', redirect):
            errors.append('OAUTH_ACCOUNT_CALLBACK_REQUIRED')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='origin/main')
    parser.add_argument('--config', type=Path, default=ROOT / 'deploy/wrangler.production.jsonc')
    parser.add_argument('--ready', action='store_true', help='Also require real resource IDs; does not authorize deployment')
    args = parser.parse_args()
    issues = []
    files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    for name in filter(None, files):
        path = ROOT / name
        if name.endswith('.csv') or not path.is_file():
            continue
        if path.name.startswith('.dev.vars') or (path.name.startswith('.env') and path.name != '.env.example'):
            issues.append({'path': name, 'rule': 'TRACKED_SECRET_FILE'})
        for rule in secret_rules(path.read_text(encoding='utf-8', errors='replace')):
            issues.append({'path': name, 'rule': rule})
    changed = subprocess.check_output(['git', 'diff', '--name-only', args.base, '--', '*.csv', 'AGENTS.md', 'PROJE_TALIMATLARI.md'], cwd=ROOT, text=True).splitlines()
    issues += [{'path': name, 'rule': 'PROTECTED_SOURCE_CHANGED'} for name in changed]
    issues += [{'path': str(args.config.relative_to(ROOT)), 'rule': rule} for rule in config_errors(json.loads(args.config.read_text()), args.ready)]
    print(json.dumps({'passed': not issues, 'issues': issues, 'ready_mode': args.ready,
                      'note': 'Yerel denetim hesap erişimini, ücretsiz planı veya gerçek veri kabulünü doğrulamaz.'}, ensure_ascii=False, indent=2))
    raise SystemExit(bool(issues))


if __name__ == '__main__':
    main()
