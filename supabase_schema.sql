CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    settings TEXT
);

CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    settings TEXT
);

CREATE TABLE IF NOT EXISTS spotify_connections (
    user_id TEXT PRIMARY KEY,
    spotify_id TEXT,
    display_name TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at BIGINT
);
