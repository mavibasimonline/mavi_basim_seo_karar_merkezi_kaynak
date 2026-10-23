ALTER TABLE sync_jobs ADD COLUMN quality_failed INTEGER NOT NULL DEFAULT 0;
CREATE TABLE ads_observations (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), requested_at TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json)), result_json TEXT NOT NULL CHECK(json_valid(result_json))
);
CREATE TABLE applied_changes (
  id TEXT PRIMARY KEY, recommendation_id TEXT NOT NULL REFERENCES recommendations(id),
  applied_at TEXT NOT NULL, recorded_at TEXT NOT NULL, evidence TEXT NOT NULL,
  old_json TEXT NOT NULL CHECK(json_valid(old_json)), new_json TEXT NOT NULL CHECK(json_valid(new_json))
);
CREATE TABLE outcome_windows (
  applied_change_id TEXT NOT NULL REFERENCES applied_changes(id), days INTEGER NOT NULL CHECK(days IN (7,28,60,90)),
  measured_at TEXT, status TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  PRIMARY KEY(applied_change_id, days)
);
CREATE TABLE health_checks (
  provider TEXT NOT NULL, day TEXT NOT NULL, checked_at TEXT NOT NULL, status TEXT NOT NULL, code TEXT,
  PRIMARY KEY(provider, day)
);
CREATE TABLE crawl_findings (
  id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES seo_snapshots(id), url TEXT NOT NULL,
  code TEXT NOT NULL, severity TEXT NOT NULL, evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  observed_at TEXT NOT NULL
);
