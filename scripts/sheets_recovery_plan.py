"""Validate the fixed Sheets source and prepare immutable evidence, without D1 writes.

Site totals and period aggregates NEVER activate daily page/query datasets.
Original user decision/work fields stay in each immutable payload. Nothing here
updates existing decisions, sync jobs, dataset coverage, OAuth, R2 or Drive.
"""
import argparse
import hashlib
import io
import json
import math
import re
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

SPREADSHEET = '1uKs8G9hUbmUvU8tqKfnDkZ1PbiVk-JcuJTgGqD3lB-4'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
MAX_SOURCE = 10_000_000
MAX_EXPANDED = 40_000_000
HEADERS = {
    'GSC_GUNLUK': ['Tarih', 'Tıklama', 'Gösterim', 'TO (%)', 'Ortalama Konum'],
    'OZET': ['Dönem Kodu', 'Dönem Etiketi', 'Başlangıç Tarihi', 'Bitiş Tarihi', 'Tıklama', 'Gösterim', 'TO (%)', 'Ortalama Konum', 'Durum', 'Son Güncelleme'],
    'URUNLER': ['Dönem Kodu', 'Ürün ID', 'Ürün Adı', 'Kategori Kodu', 'Kategori Adı', 'Tıklama', 'Gösterim', 'TO (%)', 'Ortalama Konum', 'Performans Durumu', 'Durum Nedeni', 'En İyi Sayfa URL'],
    'SORGULAR': ['Dönem Kodu', 'Ürün ID', 'Ürün Adı', 'Sorgu', 'Tıklama', 'Gösterim', 'TO (%)', 'Ortalama Konum'],
}

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def sheet_date(value):
    if isinstance(value, bool):
        raise ValueError('INVALID_SOURCE_DATE')
    if isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        result = date.fromisoformat(value)
    else:
        serial = float(value)
        if not math.isfinite(serial) or serial != int(serial) or not 36526 <= serial <= 73415:
            raise ValueError('INVALID_SOURCE_DATE')
        result = date(1899, 12, 30) + timedelta(days=serial)
    if not date(2000, 1, 1) <= result <= date(2100, 12, 31):
        raise ValueError('INVALID_SOURCE_DATE')
    return result.isoformat()

def read_xlsx(raw):
    if len(raw) > MAX_SOURCE:
        raise ValueError('SOURCE_SIZE_LIMIT')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if len(archive.infolist()) > 100 or sum(i.file_size for i in archive.infolist()) > MAX_EXPANDED:
            raise ValueError('EXPANDED_SOURCE_LIMIT')
        if len(archive.namelist()) != len(set(archive.namelist())):
            raise ValueError('DUPLICATE_ZIP_MEMBER')
        def xml(path):
            text = archive.read(path)
            if b'<!DOCTYPE' in text or b'<!ENTITY' in text:
                raise ValueError('XML_ENTITY_FORBIDDEN')
            return ET.fromstring(text)
        shared = [''.join(t.text or '' for t in item.findall('.//s:t', NS))
                  for item in xml('xl/sharedStrings.xml').findall('s:si', NS)] if 'xl/sharedStrings.xml' in archive.namelist() else []
        relations = {r.attrib['Id']: r.attrib['Target'] for r in xml('xl/_rels/workbook.xml.rels')}
        output = {}
        for sheet in xml('xl/workbook.xml').findall('s:sheets/s:sheet', NS):
            name = sheet.attrib['name']
            if name in output:
                raise ValueError('DUPLICATE_SHEET')
            target = relations[sheet.attrib['{' + REL + '}id']]
            if '..' in target or ':' in target:
                raise ValueError('EXTERNAL_WORKSHEET_FORBIDDEN')
            path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            rows = []
            for row in xml(path).findall('s:sheetData/s:row', NS):
                cells = {}
                for cell in row.findall('s:c', NS):
                    key = re.sub(r'\d+$', '', cell.attrib['r'])
                    node = cell.find('s:v', NS)
                    value = node.text if node is not None else None
                    if cell.attrib.get('t') == 's' and value is not None:
                        value = shared[int(value)]
                    elif cell.attrib.get('t') == 'inlineStr':
                        value = ''.join(t.text or '' for t in cell.findall('.//s:t', NS))
                    if value is not None:
                        cells[key] = value
                if cells:
                    rows.append(cells)
            if not rows:
                output[name] = []
                continue
            header = rows[0]
            if len(set(header.values())) != len(header):
                raise ValueError('DUPLICATE_COLUMN_LABEL')
            if any(key not in header for row in rows[1:] for key in row):
                raise ValueError('SOURCE_UNLABELED_COLUMN')
            output[name] = [{header[key]: value for key, value in row.items()} for row in rows[1:]]
            if name in HEADERS and not set(HEADERS[name]).issubset(header.values()):
                raise ValueError('SOURCE_HEADER_MISMATCH')
        if not set(HEADERS).issubset(output):
            raise ValueError('SOURCE_SHEETS_REQUIRED')
        return output

def metrics(row):
    values = []
    for name in ['Tıklama', 'Gösterim', 'TO (%)', 'Ortalama Konum']:
        value = row.get(name)
        if isinstance(value, bool):
            raise ValueError('INVALID_SOURCE_METRIC')
        number = float(value)
        if not math.isfinite(number) or number < 0:
            raise ValueError('INVALID_SOURCE_METRIC')
        values.append(number)
    clicks, impressions, ctr, position = values
    if clicks != int(clicks) or impressions != int(impressions) or impressions > 9007199254740991 or clicks > impressions or ctr > 100:
        raise ValueError('INVALID_SOURCE_COUNTS')
    if abs(ctr - (100 * clicks / impressions if impressions else 0)) > 0.011:
        raise ValueError('SOURCE_CTR_MISMATCH')
    if impressions > 0 and position <= 0:
        raise ValueError('INVALID_SOURCE_POSITION')
    return {'clicks': int(clicks), 'impressions': int(impressions), 'ctr': ctr / 100, 'position': position}

def plan(sheets, snapshot_sha, retrieved_at, existing_keys=()):
    if not re.fullmatch('[a-f0-9]{64}', snapshot_sha):
        raise ValueError('SOURCE_HASH_REQUIRED')
    stamp = datetime.fromisoformat(retrieved_at.replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('SOURCE_TIMESTAMP_REQUIRED')
    records, logical = {}, {}
    periods = {}
    def append(section, family, identity, start, end, payload):
        if start > end or end > stamp.date().isoformat():
            raise ValueError('INVALID_SOURCE_PERIOD')
        normalized = {key: value for key, value in payload.items() if key != 'Son Güncelleme'}
        for name in ('Tıklama', 'Gösterim'):
            if name in normalized:
                normalized[name] = int(float(normalized[name]))
        for name in ('TO (%)', 'Ortalama Konum'):
            if name in normalized:
                normalized[name] = float(normalized[name])
        if 'Tarih' in normalized:
            normalized['Tarih'] = start
        if 'Başlangıç Tarihi' in normalized:
            normalized['Başlangıç Tarihi'] = start
            normalized['Bitiş Tarihi'] = end
        content = {'source': SPREADSHEET, 'section': section, 'family': family,
                   'identity': identity, 'start': start, 'end': end, 'payload': normalized}
        key = digest(content)
        logical_key = canonical([section, identity, start, end])
        logical.setdefault(logical_key, set()).add(key)
        records[key] = {'source_key': key, **content,
                        'content_json': canonical(content),
                        'provenance': {'snapshot_sha256': snapshot_sha, 'retrieved_at': retrieved_at,
                                       'source_updated_at': payload.get('Son Güncelleme'),
                                       'source_row': {key: value for key, value in payload.items() if key != 'validated_metrics'}},
                        'daily_page_query_coverage': False, 'source_filters_verified': False}
    for row in sheets['OZET']:
        code = row['Dönem Kodu']
        start, end = sheet_date(row['Başlangıç Tarihi']), sheet_date(row['Bitiş Tarihi'])
        if code in periods and periods[code] != (start, end):
            raise ValueError('AMBIGUOUS_SOURCE_PERIOD')
        periods[code] = (start, end)
        append('OZET', 'period_total', code, start, end, {**row, 'validated_metrics': metrics(row)})
    for row in sheets['GSC_GUNLUK']:
        day = sheet_date(row['Tarih'])
        append('GSC_GUNLUK', 'site_daily_total', day, day, day, {**row, 'validated_metrics': metrics(row)})
    for section, family in [('URUNLER', 'product_period'), ('SORGULAR', 'query_period')]:
        for row in sheets[section]:
            period = periods.get(row['Dönem Kodu'])
            if period is None:
                raise ValueError('SOURCE_PERIOD_REQUIRED')
            identity = [row.get('Ürün ID'), row.get('Sorgu')] if section == 'SORGULAR' else row.get('Ürün ID')
            if not row.get('Ürün ID') or section == 'SORGULAR' and not row.get('Sorgu'):
                raise ValueError('SOURCE_ENTITY_REQUIRED')
            append(section, family, identity, *period, {**row, 'validated_metrics': metrics(row)})
    conflicts = set().union(*(keys for keys in logical.values() if len(keys) > 1))
    existing = set(existing_keys)
    fresh = [record for key, record in records.items() if key not in existing and key not in conflicts]
    def priority(record):
        manual = any(record['payload'].get(key) for key in ('manuel_sinif', 'manuel_karar_notu', 'manuel_karar_tarihi'))
        return (0 if record['family'] == 'site_daily_total' and record['start'].startswith('2026-07') else
                1 if record['family'] == 'site_daily_total' else 2 if manual else
                3 if record['family'] == 'product_period' else 4 if record['family'] == 'period_total' else 5,
                record['start'], record['source_key'])
    fresh.sort(key=priority)
    quarantined = [record for key, record in records.items() if key in conflicts]
    return {'mode': 'read-only-plan', 'source': SPREADSHEET, 'snapshot_sha256': snapshot_sha,
            'candidate_records': len(records), 'missing_evidence_records': len(fresh),
            'already_archived': sum(key in existing for key in records), 'records': fresh,
            'quarantined_records': quarantined, 'ambiguous_identities': sum(len(keys) > 1 for keys in logical.values()),
            'daily_jobs_completed': 0, 'd1_records_written': 0,
            'work_records_in_current_sheet': len(sheets.get('AYLIK_CALISMALAR', []))}

def backup_histories(document):
    """Preserve JSON user history opaquely, including unknown nested fields."""
    return {section: {'source_key': digest([section, document[section]]), 'payload': document[section]}
            for section in ('manualDecisions', 'workRecords') if section in document}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--retrieved-at', required=True)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    raw = arguments.source.read_bytes()
    result = plan(read_xlsx(raw), hashlib.sha256(raw).hexdigest(), arguments.retrieved_at)
    with arguments.output.open('x', encoding='utf-8') as handle:
        arguments.output.chmod(0o600)
        handle.write(canonical(result))
    print(canonical({**{key: value for key, value in result.items() if key not in ('records', 'quarantined_records')},
                     'quarantined_records': len(result['quarantined_records'])}))
