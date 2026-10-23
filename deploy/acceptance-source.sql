-- Read-only checks for the new SEO D1 only. Never query encrypted_tokens.
SELECT 'product_groups' AS check_name, count(*) AS actual, 4 AS expected FROM product_groups;
SELECT 'products' AS check_name, count(*) AS actual, 29 AS expected FROM products;
SELECT 'keyword_sources' AS check_name, count(*) AS actual, 521 AS expected FROM keyword_sources;
SELECT 'source_observations' AS check_name, count(*) AS actual, 9075 AS expected FROM keyword_metric_observations;
SELECT 'keyword_catalog' AS check_name, count(*) AS actual, 6765 AS expected FROM keyword_catalog;
SELECT name FROM d1_migrations ORDER BY id;
PRAGMA foreign_key_check;
SELECT 'private_credentials' AS check_name, count(*) AS count_only FROM oauth_credentials;
SELECT provider, scope, min(day) AS earliest, max(day) AS latest, count(*) AS complete_days
FROM dataset_coverage WHERE complete=1 GROUP BY provider, scope;
SELECT provider, status, count(*) AS jobs FROM sync_jobs GROUP BY provider, status;
