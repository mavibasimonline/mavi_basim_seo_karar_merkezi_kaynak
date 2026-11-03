"""Read only the fixed public Google Sheet. Print counts and safe period metadata, no rows or secrets."""
import json
import re
import urllib.request
from collections import Counter
from datetime import date, timedelta

SHEET = "1uKs8G9hUbmUvU8tqKfnDkZ1PbiVk-JcuJTgGqD3lB-4"
SECTIONS = ("GSC_GUNLUK", "OZET", "URUNLER", "SORGULAR")

def fetch(section):
    url = f"https://docs.google.com/spreadsheets/d/{SHEET}/gviz/tq?tqx=out:json&headers=1&sheet={section}"
    with urllib.request.urlopen(url, timeout=30) as response:
        raw = response.read(12_000_001).decode()
    prefix = "google.visualization.Query.setResponse("
    start = raw.find(prefix)
    end = raw.rfind(");")
    if start < 0 or end < start or len(raw) > 12_000_000:
        raise ValueError("SOURCE_RESPONSE_UNAVAILABLE")
    data = json.loads(raw[start + len(prefix):end])
    if data.get("status") != "ok":
        raise ValueError("SOURCE_STATUS_INVALID")
    cols = [v.get("label", "") for v in data["table"]["cols"]]
    return cols, [
        {cols[i]: str(c["v"]) for i, c in enumerate(item["c"]) if c and c.get("v") is not None}
        for item in data["table"]["rows"]
    ]

def date_value(raw):
    text = str(raw)
    match = re.fullmatch(r"Date\((\d{4}),(\d{1,2}),(\d{1,2})\)", text)
    if match:
        return date(int(match[1]), int(match[2]) + 1, int(match[3]))
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return date.fromisoformat(text)
    if re.fullmatch(r"\d{5}", text):
        return date(1899, 12, 30) + timedelta(days=int(text))
    return None

def main():
    tables = {}
    for section in SECTIONS:
        headers, rows = fetch(section)
        tables[section] = rows
        print(json.dumps({"section": section, "rows": len(rows), "headers": headers}, ensure_ascii=False))
    periods = []
    for row in tables["OZET"]:
        start = date_value(row.get("Başlangıç Tarihi", ""))
        end = date_value(row.get("Bitiş Tarihi", ""))
        complete = bool(start and end and start.day == 1 and end + timedelta(days=1) == (date(end.year + 1, 1, 1) if end.month == 12 else date(end.year, end.month + 1, 1)) and (start.year, start.month) == (end.year, end.month))
        periods.append({"period": row.get("Dönem Kodu"), "start": str(start), "end": str(end), "calendar_complete": complete, "today_closed": bool(complete and (date.today() - end).days > 3)})
    print(json.dumps({"period_summaries": periods, "product_period_counts": dict(Counter(r.get("Dönem Kodu", "missing") for r in tables["URUNLER"])), "query_period_counts": dict(Counter(r.get("Dönem Kodu", "missing") for r in tables["SORGULAR"]))}, ensure_ascii=False))
if __name__ == "__main__":
    main()
