-- Read-only, fail-closed post-import acceptance against the authorized D1.
-- SQLite raises 'malformed JSON' if any count differs; no data is changed.
SELECT CASE WHEN (SELECT count(*) FROM product_groups)=4 THEN 'groups_ok' ELSE json_extract('INVALID_GROUP_COUNT', '$.failure') END AS groups;
SELECT CASE WHEN (SELECT count(*) FROM products)=29 THEN 'products_ok' ELSE json_extract('INVALID_PRODUCT_COUNT', '$.failure') END AS products;
SELECT CASE WHEN (SELECT count(*) FROM keyword_sources)=521 THEN 'sources_ok' ELSE json_extract('INVALID_SOURCE_COUNT', '$.failure') END AS sources;
SELECT CASE WHEN (SELECT count(*) FROM keyword_metric_observations)=9075 THEN 'observations_ok' ELSE json_extract('INVALID_OBSERVATION_COUNT', '$.failure') END AS observations;
SELECT CASE WHEN (SELECT count(*) FROM keyword_catalog)=6765 THEN 'catalog_ok' ELSE json_extract('INVALID_CATALOG_COUNT', '$.failure') END AS catalog;
SELECT CASE WHEN (SELECT count(*) FROM pragma_foreign_key_check)=0 THEN 'foreign_keys_ok' ELSE json_extract('INVALID_FOREIGN_KEYS', '$.failure') END AS foreign_keys;
