-- Versioned, immutable derived insights retain their exact input and rule version.
CREATE TABLE insight_runs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, analysis_id TEXT REFERENCES analysis_runs(id),
  source_key TEXT NOT NULL, created_at TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)), UNIQUE(kind,source_key)
);
CREATE INDEX insights_history ON insight_runs(kind,created_at);
CREATE TRIGGER immutable_insight_update BEFORE UPDATE ON insight_runs BEGIN SELECT RAISE(ABORT,'immutable_insight'); END;
CREATE TRIGGER immutable_insight_delete BEFORE DELETE ON insight_runs BEGIN SELECT RAISE(ABORT,'immutable_insight'); END;
