CREATE TABLE competitors (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,origin TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,
 robots_text TEXT,robots_fetched_at TEXT,next_request_at TEXT NOT NULL DEFAULT '1970-01-01',
 last_success TEXT,last_error TEXT
);
CREATE TABLE competitor_targets (
 id TEXT PRIMARY KEY,competitor_id TEXT NOT NULL REFERENCES competitors(id),product_id TEXT NOT NULL REFERENCES products(id),
 url TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',next_attempt_at TEXT NOT NULL,
 lease_token TEXT,lease_until TEXT,last_success TEXT,UNIQUE(competitor_id,url)
);
CREATE INDEX competitor_due ON competitor_targets(next_attempt_at,lease_until);
CREATE TABLE competitor_attempts (id TEXT PRIMARY KEY,target_id TEXT NOT NULL REFERENCES competitor_targets(id),started_at TEXT NOT NULL,finished_at TEXT,status_code INTEGER,error_code TEXT);
CREATE TABLE competitor_snapshots (id TEXT PRIMARY KEY,target_id TEXT NOT NULL REFERENCES competitor_targets(id),observed_at TEXT NOT NULL,summary_hash TEXT NOT NULL,summary_json TEXT NOT NULL CHECK(json_valid(summary_json)));
CREATE INDEX competitor_snapshot_history ON competitor_snapshots(target_id,observed_at);
CREATE TRIGGER immutable_competitor_update BEFORE UPDATE ON competitor_snapshots BEGIN SELECT RAISE(ABORT,'immutable_competitor'); END;
CREATE TRIGGER immutable_competitor_delete BEFORE DELETE ON competitor_snapshots BEGIN SELECT RAISE(ABORT,'immutable_competitor'); END;
CREATE TABLE competitor_events (id TEXT PRIMARY KEY,target_id TEXT NOT NULL REFERENCES competitor_targets(id),previous_id TEXT NOT NULL REFERENCES competitor_snapshots(id),next_id TEXT NOT NULL REFERENCES competitor_snapshots(id),observed_from TEXT NOT NULL,observed_to TEXT NOT NULL,diff_json TEXT NOT NULL CHECK(json_valid(diff_json)));
