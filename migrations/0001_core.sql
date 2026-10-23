PRAGMA foreign_keys = ON;

CREATE TABLE product_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE products (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES product_groups(id), name TEXT NOT NULL,
  source_folder TEXT NOT NULL UNIQUE, canonical_url TEXT UNIQUE, url_verified_at TEXT,
  CHECK (canonical_url IS NULL OR canonical_url LIKE 'https://mavibasim.com/%')
);
CREATE TABLE pages (
  url TEXT PRIMARY KEY, product_id TEXT REFERENCES products(id), canonical_url TEXT,
  discovered_at TEXT NOT NULL, mapping_source TEXT
);
CREATE INDEX pages_product ON pages(product_id);
CREATE TABLE page_aliases (
  alias_url TEXT PRIMARY KEY, canonical_url TEXT NOT NULL REFERENCES pages(url),
  verified_at TEXT NOT NULL, evidence TEXT NOT NULL
);
CREATE TABLE keyword_catalog (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), keyword TEXT NOT NULL,
  variant_family TEXT NOT NULL, UNIQUE(product_id, keyword)
);
CREATE INDEX keyword_product ON keyword_catalog(product_id, keyword);
CREATE TABLE keyword_sources (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), path TEXT NOT NULL,
  sha256 TEXT NOT NULL, exported_at TEXT NOT NULL, export_timezone TEXT,
  period_label TEXT NOT NULL, header_json TEXT NOT NULL CHECK(json_valid(header_json)),
  location TEXT, language TEXT, network TEXT,
  imported_at TEXT NOT NULL, row_count INTEGER NOT NULL CHECK(row_count >= 0),
  UNIQUE(path, sha256)
);
CREATE TABLE keyword_metric_observations (
  source_id TEXT NOT NULL REFERENCES keyword_sources(id), row_number INTEGER NOT NULL CHECK(row_number >= 4),
  keyword_id TEXT NOT NULL REFERENCES keyword_catalog(id), currency TEXT,
  avg_monthly_searches REAL CHECK(avg_monthly_searches IS NULL OR avg_monthly_searches >= 0),
  advertiser_competition TEXT, advertiser_competition_index REAL,
  monthly_json TEXT NOT NULL CHECK(json_valid(monthly_json)),
  raw_cells_json TEXT NOT NULL CHECK(json_valid(raw_cells_json)),
  PRIMARY KEY(source_id, row_number)
);
CREATE INDEX keyword_observations ON keyword_metric_observations(keyword_id, source_id);

CREATE TABLE oauth_credentials (
  provider TEXT PRIMARY KEY, encrypted_tokens TEXT NOT NULL, scopes TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
CREATE TABLE auth_attempts (client_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_start TEXT NOT NULL);
CREATE TABLE sync_jobs (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, day TEXT NOT NULL, scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','retry','blocked','done')) DEFAULT 'pending',
  generation TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL, lease_until TEXT, lease_token TEXT,
  error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(provider, day, scope)
);
CREATE INDEX sync_ready ON sync_jobs(status, next_attempt_at, lease_until);
CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES sync_jobs(id), started_at TEXT NOT NULL,
  finished_at TEXT, status TEXT NOT NULL, rows_received INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sync_errors (
  id INTEGER PRIMARY KEY, run_id TEXT NOT NULL REFERENCES sync_runs(id), code TEXT NOT NULL,
  retry_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE dataset_coverage (
  provider TEXT NOT NULL, day TEXT NOT NULL, scope TEXT NOT NULL, dataset_id TEXT NOT NULL,
  complete INTEGER NOT NULL CHECK(complete IN (0,1)), query_partial INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL, fetched_at TEXT NOT NULL, notes TEXT NOT NULL,
  PRIMARY KEY(provider, day, scope)
);
CREATE TABLE gsc_daily_by_page (
  dataset_id TEXT NOT NULL, date TEXT NOT NULL, page TEXT NOT NULL, country TEXT NOT NULL, device TEXT NOT NULL,
  clicks REAL NOT NULL CHECK(clicks >= 0), impressions REAL NOT NULL CHECK(impressions >= clicks),
  ctr REAL NOT NULL CHECK(ctr BETWEEN 0 AND 1), position REAL NOT NULL CHECK(position >= 0),
  PRIMARY KEY(dataset_id, date, page, country, device)
);
CREATE INDEX gsc_page_dates ON gsc_daily_by_page(date, dataset_id, page);
CREATE TABLE gsc_daily_by_query_device (
  dataset_id TEXT NOT NULL, date TEXT NOT NULL, page TEXT NOT NULL, query TEXT NOT NULL,
  country TEXT NOT NULL, device TEXT NOT NULL, is_brand INTEGER NOT NULL CHECK(is_brand IN (0,1)),
  clicks REAL NOT NULL CHECK(clicks >= 0), impressions REAL NOT NULL CHECK(impressions >= clicks),
  ctr REAL NOT NULL CHECK(ctr BETWEEN 0 AND 1), position REAL NOT NULL CHECK(position >= 0),
  PRIMARY KEY(dataset_id, date, page, query, country, device)
);
CREATE INDEX gsc_query_dates ON gsc_daily_by_query_device(date, dataset_id, page);
CREATE TABLE ga4_daily_by_city_device (
  dataset_id TEXT NOT NULL, date TEXT NOT NULL, landing_page TEXT NOT NULL, country TEXT NOT NULL,
  city TEXT NOT NULL, device TEXT NOT NULL, sessions INTEGER NOT NULL CHECK(sessions >= 0),
  engaged_sessions INTEGER NOT NULL CHECK(engaged_sessions BETWEEN 0 AND sessions),
  key_events REAL CHECK(key_events IS NULL OR key_events >= 0),
  PRIMARY KEY(dataset_id, date, landing_page, country, city, device)
);
CREATE INDEX ga4_dates ON ga4_daily_by_city_device(date, dataset_id);

CREATE TABLE crawl_queue (
  url TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('page','sitemap')), depth INTEGER NOT NULL DEFAULT 0,
  next_crawl_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  lease_until TEXT, lease_token TEXT
);
CREATE TABLE crawl_policies (
  origin TEXT PRIMARY KEY, robots_text TEXT NOT NULL, fetched_at TEXT NOT NULL, next_request_at TEXT NOT NULL
);
CREATE TABLE crawls (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  status_code INTEGER, error_code TEXT, robots_allowed INTEGER NOT NULL DEFAULT 0,
  rendering TEXT NOT NULL DEFAULT 'static-html', response_headers_json TEXT
);
CREATE INDEX crawl_dates ON crawls(url, started_at);
CREATE TABLE seo_snapshots (
  id TEXT PRIMARY KEY, crawl_id TEXT NOT NULL UNIQUE REFERENCES crawls(id), url TEXT NOT NULL,
  observed_at TEXT NOT NULL, content_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
);
CREATE INDEX snapshots_url ON seo_snapshots(url, observed_at);
CREATE TRIGGER immutable_snapshot_update BEFORE UPDATE ON seo_snapshots BEGIN SELECT RAISE(ABORT, 'immutable_snapshot'); END;
CREATE TRIGGER immutable_snapshot_delete BEFORE DELETE ON seo_snapshots BEGIN SELECT RAISE(ABORT, 'immutable_snapshot'); END;
CREATE TABLE seo_change_events (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, previous_snapshot_id TEXT NOT NULL REFERENCES seo_snapshots(id),
  next_snapshot_id TEXT NOT NULL REFERENCES seo_snapshots(id), observed_from TEXT NOT NULL, observed_to TEXT NOT NULL,
  published_at TEXT, publication_evidence TEXT, diff_json TEXT NOT NULL CHECK(json_valid(diff_json)),
  CHECK(published_at IS NULL OR publication_evidence IS NOT NULL)
);
CREATE TABLE analysis_runs (
  id TEXT PRIMARY KEY, month TEXT NOT NULL, engine_version TEXT NOT NULL, created_at TEXT NOT NULL,
  filters_json TEXT NOT NULL CHECK(json_valid(filters_json)), result_json TEXT NOT NULL CHECK(json_valid(result_json))
);
CREATE TABLE evidence_refs (
  id TEXT PRIMARY KEY, analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id), source TEXT NOT NULL,
  source_ref TEXT NOT NULL, observed_at TEXT NOT NULL, scope_json TEXT NOT NULL CHECK(json_valid(scope_json))
);
CREATE TABLE recommendations (
  id TEXT PRIMARY KEY, analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id), product_id TEXT NOT NULL REFERENCES products(id),
  decision TEXT NOT NULL CHECK(decision IN ('Koru','İncele','İyileştir','Veri bekle')),
  confidence TEXT NOT NULL, risk TEXT NOT NULL, next_measurement TEXT NOT NULL,
  computation_json TEXT NOT NULL CHECK(json_valid(computation_json)), evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  CHECK(decision = 'Veri bekle' OR json_array_length(evidence_ids_json) > 0)
);
CREATE TABLE recommendation_outcomes (
  id TEXT PRIMARY KEY, recommendation_id TEXT NOT NULL REFERENCES recommendations(id), measured_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), result TEXT NOT NULL
);
CREATE TABLE user_questions (
  id TEXT PRIMARY KEY, asked_at TEXT NOT NULL, question TEXT NOT NULL, analysis_run_id TEXT REFERENCES analysis_runs(id),
  answer_json TEXT NOT NULL CHECK(json_valid(answer_json))
);
CREATE TABLE backups_manifest (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, format TEXT NOT NULL, sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL, restored_at TEXT
);
