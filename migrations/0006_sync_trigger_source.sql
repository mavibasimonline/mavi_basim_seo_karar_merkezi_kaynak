-- Legacy runs cannot be claimed as independently verified automatic execution.
ALTER TABLE sync_runs ADD COLUMN trigger_source TEXT NOT NULL DEFAULT 'legacy'
  CHECK(trigger_source IN ('legacy','manual','cron'));
CREATE INDEX sync_automatic_success ON sync_runs(started_at DESC)
  WHERE trigger_source='cron' AND status='done' AND rows_received>0;
