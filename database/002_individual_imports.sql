-- Migration additive : ne supprime pas l'ancien espace partagé ni les comptes.
-- À exécuter après 001_initial.sql sur une sauvegarde vérifiée.
CREATE TABLE IF NOT EXISTS rh_personal_workspace (
  user_id text PRIMARY KEY REFERENCES rh_users(user_id),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_employees bigint,
  active_absences bigint,
  active_pointage bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rh_import_employees (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES rh_users(user_id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rh_import_absences (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES rh_users(user_id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rh_import_pointage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES rh_users(user_id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rh_import_employees_owner_idx ON rh_import_employees (user_id, id DESC);
CREATE INDEX IF NOT EXISTS rh_import_absences_owner_idx ON rh_import_absences (user_id, id DESC);
CREATE INDEX IF NOT EXISTS rh_import_pointage_owner_idx ON rh_import_pointage (user_id, id DESC);
