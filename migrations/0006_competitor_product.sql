-- One explicit comparison page per product and competitor; preserves existing snapshots.
CREATE UNIQUE INDEX competitor_product_mapping ON competitor_targets(competitor_id,product_id);
