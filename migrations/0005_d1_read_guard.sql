-- No source rows, OAuth grants or immutable evidence are changed.
CREATE TABLE d1_quota_state (
  day TEXT PRIMARY KEY, observed_at TEXT NOT NULL, data_through TEXT NOT NULL,
  valid_until TEXT NOT NULL, account_reads INTEGER NOT NULL CHECK(account_reads>=0),
  account_writes INTEGER NOT NULL CHECK(account_writes>=0),
  mode TEXT NOT NULL CHECK(mode IN ('open','slow','blocked')), reason TEXT NOT NULL
);
CREATE TABLE d1_quota_ledger (
  day TEXT PRIMARY KEY, reads INTEGER NOT NULL DEFAULT 0 CHECK(reads>=0),
  writes INTEGER NOT NULL DEFAULT 0 CHECK(writes>=0), updated_at TEXT NOT NULL
);
CREATE TABLE d1_query_costs (
  day TEXT NOT NULL, fingerprint TEXT NOT NULL, executions INTEGER NOT NULL,
  rows_read INTEGER NOT NULL, rows_written INTEGER NOT NULL, max_rows_read INTEGER NOT NULL,
  PRIMARY KEY(day,fingerprint)
);
-- The primary keys already cover dataset_id and CSV source_id. Do not duplicate them.
CREATE INDEX coverage_active ON dataset_coverage(provider,scope,complete,day,dataset_id,row_count,fetched_at);
CREATE INDEX report_cache_lookup ON analysis_runs(month,engine_version,json_extract(filters_json,'$.device'),created_at DESC);
CREATE INDEX coverage_fetched ON dataset_coverage(fetched_at);
CREATE INDEX keyword_imported ON keyword_sources(imported_at);
CREATE INDEX product_verified ON products(url_verified_at);
CREATE INDEX sync_recent_runs ON sync_runs(started_at DESC);
CREATE INDEX sync_recent_errors ON sync_errors(created_at DESC);
CREATE INDEX health_recent ON health_checks(checked_at DESC);
CREATE INDEX crawl_recent ON crawls(started_at DESC);
CREATE INDEX keyword_source_product ON keyword_sources(product_id);
CREATE TABLE api_read_cache (
  cache_key TEXT PRIMARY KEY, revision TEXT NOT NULL, created_at TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json))
);
