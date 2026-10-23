"""Read-only acceptance of an explicitly configured SEO application, never the live site."""
import argparse
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path


def check_payload(stage, status, report=None, inventory=None, day=None, products=('brosur', 'el-ilani')):
    checks = []
    add = lambda name, passed: checks.append({'check': name, 'passed': bool(passed)})
    if stage == 'disconnected':
        add('google_not_connected', status.get('google_connected') is False)
        add('original_source_counts', report.get('sources', {}).get('csv_files') == 521 and report.get('sources', {}).get('csv_rows') == 9075)
        add('all_29_products_present', len(report.get('products', [])) == 29)
        add('no_fake_search_performance', all(p.get('decision') == 'Veri bekle' and p.get('current') is None for p in report.get('products', [])))
    if stage == 'sync':
        add('oauth_record_present', status.get('google_connected') is True)
        health = sorted([h for h in status.get('health', []) if h.get('provider') == 'gsc'], key=lambda h: h.get('checked_at', ''), reverse=True)
        recent = datetime.now(timezone.utc) - timedelta(hours=24)
        add('recent_successful_gsc_response', health and health[0].get('status') == 'ok' and datetime.fromisoformat(health[0]['checked_at'].replace('Z', '+00:00')) >= recent)
        for scope in ('page', 'query'):
            add(f'completed_{scope}_dataset_for_latest_expected_day', any(c.get('provider') == 'gsc' and c.get('scope') == scope and c.get('latest') == day for c in status.get('coverage', [])))
    if stage == 'crawl':
        add('crawl_explicitly_enabled', status.get('crawl_enabled') is True)
        for product in products:
            url = f'https://mavibasim.com/{product}'
            page = next((row for row in inventory or [] if row.get('url') == url), None)
            add(f'{product}_real_snapshot_present', page and page.get('snapshot_id') and page.get('observed_at'))
            snapshot = json.loads(page['snapshot_json']) if page and page.get('snapshot_json') else {}
            add(f'{product}_http_200_static_inventory', snapshot.get('status') == 200 and snapshot.get('rendering') == 'static-html' and snapshot.get('title') and snapshot.get('body_hash'))
            add(f'{product}_self_canonical', snapshot.get('canonical') == [url] or snapshot.get('canonical') == [url + '/'])
    if stage == 'report':
        add('real_google_source', report.get('sources', {}).get('google_connected') is True)
        add('completed_report_has_no_global_gaps', not report.get('missing'))
        add('report_id_and_engine_saved', report.get('id') and report.get('engine_version'))
        for product in products:
            row = next((p for p in report.get('products', []) if p.get('id') == product), {})
            add(f'{product}_two_periods_and_evidence', row.get('current') is not None and row.get('previous') is not None and row.get('evidence') and not row.get('missing'))
            add(f'{product}_evidence_based_decision', row.get('decision') in ('Koru', 'İncele', 'İyileştir'))
            add(f'{product}_missing_queries_are_not_zero', all(q.get('clicks') is None for q in row.get('queries', []) if q.get('missing_current')))
    return checks


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', choices=('disconnected', 'sync', 'crawl', 'report'), required=True)
    parser.add_argument('--origin', default=os.environ.get('SEO_APP_ORIGIN', ''))
    parser.add_argument('--month')
    parser.add_argument('--day', default=(datetime.now(timezone.utc) - timedelta(days=3)).date().isoformat())
    parser.add_argument('--local', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    origin = urllib.parse.urlparse(args.origin)
    production = origin.scheme == 'https' and re.fullmatch(r'mavi-basim-seo-prod\.[a-z0-9-]+\.workers\.dev', origin.netloc or '')
    local = args.local and origin.scheme == 'http' and origin.hostname in ('127.0.0.1', 'localhost')
    if not (production or local) or origin.path not in ('', '/') or origin.query or origin.fragment:
        parser.error('Ayrı uygulamanın HTTPS workers.dev adresini belirtin; canlı mavibasim.com hedefi kabul edilmez.')
    token = os.environ.get('ADMIN_TOKEN')
    if not token:
        parser.error('ADMIN_TOKEN güvenli süreç ortamında sağlanmalı; değerini komuta veya sohbete yazmayın.')
    if args.stage == 'report' and not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', args.month or ''):
        parser.error('Rapor kabulü için --month YYYY-MM gerekli.')
    opener = urllib.request.build_opener(NoRedirect)

    def request(path, authorized=True):
        headers = {'Authorization': 'Bearer ' + token} if authorized else {}
        req = urllib.request.Request(args.origin.rstrip('/') + path, headers=headers)
        try:
            with opener.open(req, timeout=30) as response:
                payload = response.read(5_000_001)
                if len(payload) > 5_000_000:
                    raise ValueError('RESPONSE_LIMIT')
                return response.status, json.loads(payload)
        except urllib.error.HTTPError as exc:
            return exc.code, None

    results = []
    try:
        health_code, _ = request('/api/health', False)
        denied, _ = request('/api/report', False)
        status_code, status = request('/api/status')
        results += [{'check': 'public_minimal_health', 'passed': health_code == 200}, {'check': 'private_report_requires_login', 'passed': denied == 401}, {'check': 'owner_status_access', 'passed': status_code == 200}]
        if status_code != 200:
            raise ValueError('OWNER_ACCESS_NOT_VERIFIED')
        report, inventory = None, []
        if args.stage in ('disconnected', 'report'):
            code, report = request('/api/report' + ('?month=' + args.month if args.month else ''))
            if code != 200:
                raise ValueError('REPORT_NOT_AVAILABLE')
        if args.stage == 'crawl':
            after = ''
            for _ in range(21):
                code, page = request('/api/inventory?after=' + urllib.parse.quote(after, safe=''))
                if code != 200:
                    raise ValueError('INVENTORY_NOT_AVAILABLE')
                inventory.extend(page['rows'])
                if not page.get('next'):
                    break
                after = page['next']
        results += check_payload(args.stage, status, report, inventory, args.day)
    except (ValueError, KeyError, TypeError, AttributeError, urllib.error.URLError, TimeoutError):
        results.append({'check': 'required_response_or_data_available', 'passed': False})
    summary = {'stage': args.stage, 'checked_at': datetime.now(timezone.utc).isoformat(),
               'result': 'passed' if results and all(c['passed'] for c in results) else 'blocked', 'checks': results,
               'note': 'Sadece mevcut yanıtları okur. Senkron/tarama tetiklemez, OAuth kurmaz, siteye yazmaz. SQL ve hesap karşılaştırması ayrıca kabul yönergesindedir.'}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    raise SystemExit(summary['result'] != 'passed')


if __name__ == '__main__':
    main()
