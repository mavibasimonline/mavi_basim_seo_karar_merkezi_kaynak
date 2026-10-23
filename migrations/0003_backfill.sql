CREATE TABLE backfill_progress (
  provider TEXT PRIMARY KEY, oldest_enqueued_day TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE outcome_windows ADD COLUMN next_check_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';
