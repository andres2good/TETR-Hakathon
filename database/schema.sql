-- ============================================================
-- TETR — Schema de Base de Datos (Supabase / PostgreSQL)
-- ============================================================
-- Ejecutar en Supabase → SQL Editor → New query
-- ============================================================

-- ─── Extensiones ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Tabla: users ────────────────────────────────────────────────────────────
-- Un usuario = un celular identificado por su deviceId.
-- El nombre es opcional (futuro: pedírselo en el primer uso).

CREATE TABLE IF NOT EXISTS users (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id   TEXT        NOT NULL UNIQUE,
    name        TEXT,
    language    TEXT        NOT NULL DEFAULT 'es',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id);
CREATE INDEX IF NOT EXISTS idx_users_last_seen  ON users(last_seen DESC);

-- ─── Tabla: sessions ──────────────────────────────────────────────────────────
-- Cada vez que el usuario abre la app y se conecta al servidor = 1 sesión.

CREATE TABLE IF NOT EXISTS sessions (
    id              UUID        PRIMARY KEY,
    user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    actions_count   INT         NOT NULL DEFAULT 0,
    duration_ms     INT         GENERATED ALWAYS AS (
        CASE
            WHEN ended_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000
            ELSE NULL
        END
    ) STORED
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);

-- ─── Tabla: actions ───────────────────────────────────────────────────────────
-- Historial completo de cada interacción: lo que dijo el usuario,
-- lo que respondió el agente y qué acción se ejecutó en el celular.

CREATE TABLE IF NOT EXISTS actions (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         UUID        REFERENCES users(id) ON DELETE SET NULL,
    session_id      UUID        REFERENCES sessions(id) ON DELETE CASCADE,
    user_text       TEXT        NOT NULL,
    agent_text      TEXT,
    action_type     TEXT,       -- 'click', 'set_text', 'open_app', etc.
    action_payload  JSONB,      -- parámetros completos de la acción
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actions_user_id    ON actions(user_id);
CREATE INDEX IF NOT EXISTS idx_actions_session_id ON actions(session_id);
CREATE INDEX IF NOT EXISTS idx_actions_created_at ON actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_type       ON actions(action_type);

-- ─── Tabla: feedback ──────────────────────────────────────────────────────────
-- Futuro: el usuario puede marcar si el agente se equivocó o lo hizo bien.
-- Sirve para mejorar el sistema prompt con casos reales.

CREATE TABLE IF NOT EXISTS feedback (
    id          BIGSERIAL   PRIMARY KEY,
    action_id   BIGINT      REFERENCES actions(id) ON DELETE CASCADE,
    user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
    rating      SMALLINT    NOT NULL CHECK (rating IN (-1, 1)), -- -1 mal, 1 bien
    comment     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_action_id ON feedback(action_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id   ON feedback(user_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- Cada usuario solo puede ver sus propios datos.
-- El servidor usa la service_role_key que bypasa RLS (esto es correcto).

ALTER TABLE users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback  ENABLE ROW LEVEL SECURITY;

-- Política: solo el service role puede leer/escribir (la app Android no accede directamente)
-- El backend Node.js usa SUPABASE_SERVICE_ROLE_KEY que bypasa RLS por diseño.

-- ─── Vista: resumen por usuario ───────────────────────────────────────────────
-- Útil para un futuro dashboard de estadísticas.

CREATE OR REPLACE VIEW user_stats AS
SELECT
    u.id,
    u.device_id,
    u.name,
    u.language,
    u.last_seen,
    COUNT(DISTINCT s.id)  AS total_sessions,
    COUNT(a.id)           AS total_actions,
    MAX(s.started_at)     AS last_session_at
FROM users u
LEFT JOIN sessions s ON s.user_id = u.id
LEFT JOIN actions  a ON a.user_id = u.id
GROUP BY u.id;

-- ─── Vista: acciones más frecuentes ──────────────────────────────────────────

CREATE OR REPLACE VIEW top_actions AS
SELECT
    action_type,
    COUNT(*)    AS total,
    COUNT(DISTINCT user_id) AS unique_users
FROM actions
WHERE action_type IS NOT NULL
GROUP BY action_type
ORDER BY total DESC;

-- ─── Trigger: actualizar last_seen en users ───────────────────────────────────

CREATE OR REPLACE FUNCTION update_user_last_seen()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE users SET last_seen = NOW() WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_session_updates_last_seen
    AFTER INSERT ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_user_last_seen();

-- ─── Datos de prueba ──────────────────────────────────────────────────────────
-- Descomenta para probar sin celular real.

/*
INSERT INTO users (device_id, name, language) VALUES
    ('test-device-001', 'María García', 'es'),
    ('test-device-002', 'Carlos López', 'es'),
    ('test-device-003', 'John Smith', 'en');

INSERT INTO sessions (id, user_id, started_at, ended_at, actions_count)
SELECT
    uuid_generate_v4(),
    id,
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '50 minutes',
    5
FROM users WHERE device_id = 'test-device-001';
*/
