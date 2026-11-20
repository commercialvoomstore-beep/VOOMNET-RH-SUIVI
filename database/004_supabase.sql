-- Projet Supabase dédié à Voomnet RH. Sauvegarder avant application.
-- Exécuter après 001_initial.sql puis 002_individual_imports.sql dans SQL Editor.
-- Ne supprime ni ne migre automatiquement les données Neon existantes.
-- Ce déclencheur s'applique à TOUTE nouvelle inscription email du projet Auth.
-- Le client doit fournir raw_user_meta_data.rh_identifier (1 à 16 chiffres).

CREATE SCHEMA IF NOT EXISTS rh_private;
REVOKE ALL ON SCHEMA rh_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS rh_private.identifiers (
  identifier text PRIMARY KEY CHECK (identifier ~ '^[0-9]{1,16}$'),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rh_private.login_attempts (
  identifier_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA rh_private FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS rh_login_attempts_expiry ON rh_private.login_attempts (window_start);

-- Tous les accès aux données RH passent par la fonction serveur, jamais par
-- l'API REST Supabase. Sans cette protection, le schéma public est exposable.
ALTER TABLE public.rh_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_personal_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_import_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_import_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_import_pointage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rh_users, public.rh_workspace, public.rh_audit,
  public.rh_personal_workspace, public.rh_import_employees,
  public.rh_import_absences, public.rh_import_pointage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rh_audit_id_seq, public.rh_import_employees_id_seq,
  public.rh_import_absences_id_seq, public.rh_import_pointage_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION rh_private.on_signup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rh_id text;
BEGIN
  rh_id := NEW.raw_user_meta_data ->> 'rh_identifier';
  IF rh_id IS NULL OR rh_id !~ '^[0-9]{1,16}$' OR NEW.email IS NULL THEN
    RAISE EXCEPTION 'Identifiant RH invalide';
  END IF;
  INSERT INTO rh_private.identifiers (identifier, user_id) VALUES (rh_id, NEW.id);
  INSERT INTO public.rh_users (user_id, active) VALUES (NEW.id::text, true);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION rh_private.on_signup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS voomnet_rh_on_signup ON auth.users;
CREATE TRIGGER voomnet_rh_on_signup AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION rh_private.on_signup();

-- Lookup utilisable seulement par le rôle PostgreSQL serveur, pas par les
-- clients navigateur. La valeur est transmise uniquement au service Auth.
CREATE OR REPLACE FUNCTION rh_private.email_for_identifier(rh_id text) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '' AS $$
  SELECT u.email::text FROM rh_private.identifiers i
  JOIN auth.users u ON u.id = i.user_id
  JOIN public.rh_users r ON r.user_id = u.id::text AND r.active = true
  WHERE i.identifier = rh_id AND u.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION rh_private.email_for_identifier(text) FROM PUBLIC, anon, authenticated;
