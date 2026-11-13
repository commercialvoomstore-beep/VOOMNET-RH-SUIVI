-- Exécuter une seule fois avec un rôle propriétaire via l'éditeur SQL Neon.
-- N'accorder les accès qu'aux utilisateurs vérifiés individuellement.
CREATE TABLE IF NOT EXISTS rh_users (
  user_id text PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rh_workspace (
  id smallint PRIMARY KEY CHECK (id = 1),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES rh_users(user_id)
);
INSERT INTO rh_workspace (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS rh_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES rh_users(user_id),
  action text NOT NULL CHECK (action IN ('read', 'write')),
  version integer NOT NULL,
  happened_at timestamptz NOT NULL DEFAULT now()
);
