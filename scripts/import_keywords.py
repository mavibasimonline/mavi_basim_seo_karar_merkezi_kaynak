"""Read-only, provenance-preserving Keyword Planner -> D1/SQLite import."""
import argparse
import base64
import gzip
import csv
import hashlib
import io
import json
import re
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LABELS = {
    'afis': 'Afiş', 'brosur': 'Broşür', 'el-ilani': 'El İlanı', 'antetli': 'Antetli Kağıt',
    'bloknotlar': 'Bloknot', 'dosyalar': 'Dosya', 'karton-canta': 'Karton Çanta',
    'kartvizit': 'Kartvizit', 'kataloglar': 'Katalog', 'kup-bloknot': 'Küp Bloknot',
    'zarf': 'Zarf', 'adisyon': 'Adisyon', 'arac-kiralama': 'Araç Kiralama',
    'gider-makbuzu': 'Gider Makbuzu', 'para-makbuzu': 'Para Makbuzu', 'recete': 'Reçete',
    'sigorta-policeleri': 'Sigorta Poliçeleri', 'siparis-fisi': 'Sipariş Fişi',
    'sozlesme-baski': 'Sözleşme Baskı', 'tahsilat-makbuzu': 'Tahsilat Makbuzu',
    'tediye-makbuzu': 'Tediye Makbuzu', 'ambalaj': 'Ambalaj',
    'amerikan-servis': 'Amerikan Servis', 'etiket': 'Etiket', 'kitap-ayraci': 'Kitap Ayracı',
    'kutu': 'Kutu', 'magnet': 'Magnet', 'oto-paspas': 'Oto Paspas', 'yag-karti': 'Yağ Kartı',
}


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def family(value):
    value = value.casefold().replace('ı', 'i')
    return ''.join(c for c in unicodedata.normalize('NFKD', value) if not unicodedata.combining(c))


def number(raw):
    if raw.strip() in ('', '—', '--', 'N/A'):
        return None
    text = raw.strip().replace('\u00a0', '').replace(' ', '').replace('.', '').replace(',', '.')
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f'Geçersiz sayı: {raw!r}') from exc
    if not value.is_finite() or value < 0:
        raise ValueError('Sayı sonlu ve negatif olmayan bir değer olmalı')
    return float(value)


def sql(value):
    if value is None:
        return 'NULL'
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def insert(table, values):
    return f"INSERT OR IGNORE INTO {table} ({','.join(values)}) VALUES ({','.join(sql(v) for v in values.values())});"


def inspect_sources(root=ROOT):
    report = {'files': [], 'errors': [], 'rows': 0, 'empty_cells': 0, 'zero_monthly_cells': 0, 'missing_monthly_cells': 0, 'missing_average_searches': 0,
              'duplicate_rows_within_file': 0, 'repeated_observations_across_exports': 0,
              'scope_warning': 'Lokasyon, dil ve ağ bilgisi dosyada bulunmuyorsa bilinmiyor; tahmin edilmez.'}
    statements = []
    seen_exports = set()
    keyword_counts = Counter()
    variants = {}
    timestamp = datetime.now(timezone.utc).isoformat()
    paths = sorted(root.glob('*/*/*.csv'))
    for path in paths:
        relative = path.relative_to(root).as_posix()
        product, group = path.parent.name, path.parent.parent.name
        raw = path.read_bytes()
        item = {'path': relative, 'sha256': digest(raw), 'product': product, 'group': group, 'rows': 0}
        try:
            if not raw.startswith((b'\xff\xfe', b'\xfe\xff')):
                raise ValueError('UTF-16 BOM eksik')
            rows = list(csv.reader(io.StringIO(raw.decode('utf-16'), newline=''), delimiter='\t', strict=True))
            if len(rows) < 4 or rows[2][:3] != ['Keyword', 'Currency', 'Avg. monthly searches']:
                raise ValueError('Başlık veya veri satırı eksik')
            header = rows[2]
            if len(set(header)) != len(header):
                raise ValueError('Tekrarlı sütun başlığı')
            item.update(columns=len(header), period=rows[1][0], export_label=rows[0][0])
            match = re.search(r'(\d{4}-\d{2}-\d{2}) at (\d{2})_(\d{2})_(\d{2})', path.name)
            if not match:
                raise ValueError('Dışa aktarım tarihi dosya adında bulunamadı')
            exported = f'{match[1]}T{match[2]}:{match[3]}:{match[4]}'
            datetime.fromisoformat(exported)
            source_id = digest(relative + '\0' + digest(raw))
            group_id = family(group).replace(' ', '-')
            statements += [insert('product_groups', {'id': group_id, 'name': group}),
                           insert('products', {'id': product, 'group_id': group_id,
                                  'name': LABELS.get(product, product), 'source_folder': str(path.parent.relative_to(root)),
                                  'canonical_url': f'https://mavibasim.com/{product}' if product in ('brosur', 'el-ilani') else None})]
            source_statement_index = len(statements)
            statements.append('')
            seen_rows = set()
            for line, cells in enumerate(rows[3:], 4):
                if not cells or len(cells) != len(header) or not cells[0].strip():
                    report['errors'].append({'path': relative, 'line': line, 'error': 'Boş/eksik/geçersiz satır'})
                    continue
                values = dict(zip(header, cells))
                keyword = cells[0]  # Original keyword remains distinct, including accent variants.
                keyword_id = digest(product + '\0' + keyword)
                keyword_counts[(product, keyword)] += 1
                variants.setdefault((product, family(keyword)), set()).add(keyword)
                repeated = tuple(cells)
                report['duplicate_rows_within_file'] += int(repeated in seen_rows)
                report['repeated_observations_across_exports'] += int((product, repeated) in seen_exports)
                seen_rows.add(repeated)
                seen_exports.add((product, repeated))
                report['empty_cells'] += sum(c == '' for c in cells)
                monthly = [{'month': k.removeprefix('Searches: '), 'value': number(v), 'raw': v}
                           for k, v in values.items() if k.startswith('Searches: ')]
                report['zero_monthly_cells'] += sum(m['value'] == 0 for m in monthly)
                report['missing_monthly_cells'] += sum(m['value'] is None for m in monthly)
                report['missing_average_searches'] += int(number(values.get('Avg. monthly searches', '')) is None)
                statements += [insert('keyword_catalog', {'id': keyword_id, 'product_id': product,
                                     'keyword': keyword, 'variant_family': family(keyword)}),
                               insert('keyword_metric_observations', {
                                   'source_id': source_id, 'row_number': line, 'keyword_id': keyword_id,
                                   'currency': values.get('Currency') or None,
                                   'avg_monthly_searches': number(values.get('Avg. monthly searches', '')),
                                   'advertiser_competition': values.get('Competition') or None,
                                   'advertiser_competition_index': number(values.get('Competition (indexed value)', '')),
                                   'monthly_json': json.dumps(monthly, ensure_ascii=False),
                                   'raw_cells_json': json.dumps(cells, ensure_ascii=False)})]
                item['rows'] += 1
            statements[source_statement_index] = insert('keyword_sources', {
                'id': source_id, 'product_id': product, 'path': relative, 'sha256': digest(raw),
                'exported_at': exported, 'period_label': rows[1][0],
                'header_json': json.dumps(header, ensure_ascii=False), 'imported_at': timestamp,
                'row_count': item['rows']})
            report['rows'] += item['rows']
        except (ValueError, UnicodeError, csv.Error) as exc:
            report['errors'].append({'path': relative, 'error': str(exc)})
        report['files'].append(item)
    report['file_count'] = len(paths)
    report['product_count'] = len({p.parent for p in paths})
    report['group_count'] = len({p.parent.parent for p in paths})
    report['unique_product_keywords'] = len(keyword_counts)
    report['repeated_keywords'] = [{'product': product, 'keyword': word, 'observations': count}
                                   for (product, word), count in sorted(keyword_counts.items()) if count > 1]
    report['variant_groups'] = [{'product': product, 'family': variant, 'keywords': sorted(words)}
                                for (product, variant), words in sorted(variants.items()) if len(words) > 1]
    return report, '\n'.join(statements) + '\n'


def planner_bundle(output, root=ROOT):
    """Compact, deterministic application data from the original read-only CSVs."""
    sources, words, observations, index, products = [], [], [], {}, {}
    for path in sorted(root.glob('*/*/*.csv')):
        raw = path.read_bytes()
        rows = list(csv.reader(io.StringIO(raw.decode('utf-16'), newline=''), delimiter='\t', strict=True))
        if len(rows) < 4 or rows[2][:3] != ['Keyword', 'Currency', 'Avg. monthly searches']:
            raise ValueError('PLANNER_SOURCE_HEADER_INVALID')
        header, product, group = rows[2], path.parent.name, path.parent.parent.name
        relative, sha = path.relative_to(root).as_posix(), digest(raw)
        match = re.search(r'(\d{4}-\d{2}-\d{2}) at (\d{2})_(\d{2})_(\d{2})', path.name)
        if not match:
            raise ValueError('PLANNER_SOURCE_DATE_INVALID')
        exported = f'{match[1]}T{match[2]}:{match[3]}:{match[4]}'
        datetime.fromisoformat(exported)
        sid, si = digest(relative + '\0' + sha), len(sources)
        products[product] = {'id': product, 'name': LABELS.get(product, product), 'group_id': family(group).replace(' ', '-'), 'group': group, 'folder': str(path.parent.relative_to(root))}
        count = 0
        for line, cells in enumerate(rows[3:], 4):
            if len(cells) != len(header) or not cells[0].strip():
                raise ValueError('PLANNER_SOURCE_ROW_INVALID')
            for col, value in zip(header, cells):
                if col.startswith('Searches: ') or col in ('Avg. monthly searches', 'Competition (indexed value)'):
                    number(value)
            wid = digest(product + '\0' + cells[0])
            if wid not in index:
                index[wid] = len(words)
                words.append([wid, product, cells[0], family(cells[0])])
            observations.append([si, line, index[wid], cells])
            count += 1
        sources.append({'id': sid, 'product_id': product, 'path': relative, 'sha256': sha, 'exported_at': exported, 'export_timezone': None, 'period_label': rows[1][0], 'header': header, 'row_count': count})
    value = {'format': 'repo-keyword-planner-v1', 'products': list(products.values()), 'sources': sources, 'words': words, 'observations': observations}
    raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
    packed = base64.b64encode(gzip.compress(raw, mtime=0)).decode()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text('// Derived only from unchanged repository CSVs; not live Google Ads data.\nexport const plannerDigest=' + json.dumps(digest(raw)) + ';\nexport const plannerPacked=' + json.dumps(packed) + ';\n', encoding='utf-8')
    return {'files': len(sources), 'rows': len(observations), 'product_keywords': len(words), 'products': len(products), 'sha256': digest(raw), 'raw_bytes': len(raw), 'packed_bytes': len(packed)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--planner-bundle', type=Path)
    args = parser.parse_args()
    if args.planner_bundle:
        print(json.dumps(planner_bundle(args.planner_bundle)))
        return
    if not args.output or not args.report:
        parser.error('--output and --report are required for SQL preparation')
    report, commands = inspect_sources()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    if report['errors'] or not report['file_count']:
        raise SystemExit('İçe aktarma durduruldu; denetim raporuna bakın.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(commands, encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k not in ('files', 'repeated_keywords', 'variant_groups')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
