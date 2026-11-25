-- Palaid Neon SQL Editor precīzi tajā datubāzē, kas norādīta DATABASE_URL.
-- Šeit tiek glabāti konti, laboratoriju metadati un aktivitātes, nevis skolēnu PG/MySQL tabulas.
CREATE TABLE IF NOT EXISTS lab_users (
    id UUID PRIMARY KEY,
    username VARCHAR(40) NOT NULL UNIQUE,
    display_name VARCHAR(90) NOT NULL,
    class_group VARCHAR(40) NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS lab_workspaces (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES lab_users(id) ON DELETE CASCADE,
    engine VARCHAR(16) NOT NULL CHECK (engine IN ('sqlite','postgres','mysql')),
    provisioned BOOLEAN NOT NULL DEFAULT FALSE,
    sqlite_data TEXT NOT NULL DEFAULT '',
    draft_sql TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id,engine)
);
CREATE TABLE IF NOT EXISTS lab_queries (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES lab_users(id) ON DELETE CASCADE,
    engine VARCHAR(16) NOT NULL,
    statement_preview VARCHAR(1200) NOT NULL,
    success BOOLEAN NOT NULL,
    duration_ms INTEGER,
    error_summary VARCHAR(320),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_queries_user_created ON lab_queries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_workspaces_user ON lab_workspaces(user_id);
CREATE TABLE IF NOT EXISTS lab_login_attempts (
    id BIGSERIAL PRIMARY KEY,
    ip_hash CHAR(64) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_login_attempts_time ON lab_login_attempts(ip_hash,created_at DESC);
