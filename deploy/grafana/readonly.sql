-- Read-only Postgres role for Grafana. Run once on the server (and again to change the password):
--   docker compose exec -T postgres psql -U vulu -d vulu -v password="$GRAFANA_DB_PASSWORD" < deploy/grafana/readonly.sql
SELECT 'CREATE ROLE grafana_reader LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_reader') \gexec
ALTER ROLE grafana_reader LOGIN PASSWORD :'password';
ALTER ROLE grafana_reader SET statement_timeout = '30s';
GRANT CONNECT ON DATABASE vulu TO grafana_reader;
GRANT USAGE ON SCHEMA public TO grafana_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_reader;
-- Tables added by later migrations are readable too
ALTER DEFAULT PRIVILEGES FOR ROLE vulu IN SCHEMA public GRANT SELECT ON TABLES TO grafana_reader;
-- Secrets: session tokens, password hashes and OAuth tokens, reset tokens, webhook tokens
REVOKE SELECT ON sessions, accounts, verifications, integrations FROM grafana_reader;
-- Integrations without their tokens and settings
GRANT SELECT (id, user_id, kind, enabled, last_synced_at) ON integrations TO grafana_reader;
