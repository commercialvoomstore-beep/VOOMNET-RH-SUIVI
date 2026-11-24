-- Voomnet RH : inscription et connexion par e-mail Supabase Auth.
-- Script autonome, additif et relançable pour un projet Supabase DÉDIÉ.
-- Sauvegarder d'abord et tester sur une copie. Ne supprime pas les imports,
-- comptes ou fiches existants. Un bref arrêt est nécessaire lors du basculement.
-- Le rôle propriétaire qui exécute ce script crée la fonction SECURITY DEFINER.

BEGIN;
CREATE TABLE IF NOT EXISTS public.rh_users (
  user_id text PRIMARY KEY,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rh_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.rh_users(user_id),
  action text NOT NULL CHECK (action IN ('read', 'write')),
  version integer NOT NULL,
  happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rh_personal_workspace (
  user_id text PRIMARY KEY REFERENCES public.rh_users(user_id),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_employees bigint,
  active_absences bigint,
  active_pointage bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rh_import_employees (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.rh_users(user_id),
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rh_import_absences (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.rh_users(user_id),
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rh_import_pointage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.rh_users(user_id),
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rh_import_employees_owner_idx ON public.rh_import_employees (user_id, id DESC);
CREATE INDEX IF NOT EXISTS rh_import_absences_owner_idx ON public.rh_import_absences (user_id, id DESC);
CREATE INDEX IF NOT EXISTS rh_import_pointage_owner_idx ON public.rh_import_pointage (user_id, id DESC);

-- Aucun accès direct aux tables par navigateur ; les opérations autorisées
-- passent exclusivement par la fonction ci-dessous, filtrées par auth.uid().
ALTER TABLE public.rh_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_personal_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_import_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_import_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_import_pointage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rh_users, public.rh_audit, public.rh_personal_workspace,
  public.rh_import_employees, public.rh_import_absences, public.rh_import_pointage
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rh_audit_id_seq, public.rh_import_employees_id_seq,
  public.rh_import_absences_id_seq, public.rh_import_pointage_id_seq FROM PUBLIC, anon, authenticated;

-- Retirer les autorisations de l'ancien serveur, sans supprimer ses données.
DROP POLICY IF EXISTS voomnet_backend ON public.rh_users;
DROP POLICY IF EXISTS voomnet_backend ON public.rh_audit;
DROP POLICY IF EXISTS voomnet_backend ON public.rh_personal_workspace;
DROP POLICY IF EXISTS voomnet_backend ON public.rh_import_employees;
DROP POLICY IF EXISTS voomnet_backend ON public.rh_import_absences;
DROP POLICY IF EXISTS voomnet_backend ON public.rh_import_pointage;
DO $$ BEGIN
  IF to_regclass('public.rh_workspace') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.rh_workspace ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.rh_workspace FROM PUBLIC, anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rh_backend') THEN
    EXECUTE 'REVOKE ALL ON public.rh_users, public.rh_audit, public.rh_personal_workspace, public.rh_import_employees, public.rh_import_absences, public.rh_import_pointage FROM rh_backend';
    EXECUTE 'REVOKE ALL ON public.rh_audit_id_seq, public.rh_import_employees_id_seq, public.rh_import_absences_id_seq, public.rh_import_pointage_id_seq FROM rh_backend';
    IF to_regnamespace('rh_private') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA rh_private FROM rh_backend';
      EXECUTE 'REVOKE USAGE ON SCHEMA rh_private FROM rh_backend';
      IF to_regprocedure('rh_private.email_for_identifier(text)') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION rh_private.email_for_identifier(text) FROM rh_backend';
      END IF;
    END IF;
  END IF;
END $$;

-- Retirer l'ancien déclencheur imposant un identifiant numérique. Le compte
-- et son espace sont initialisés à la première opération authentifiée.
DROP TRIGGER IF EXISTS voomnet_rh_on_signup ON auth.users;

CREATE OR REPLACE FUNCTION public.voomnet_workspace(
  p_action text DEFAULT 'get',
  p_expected_version integer DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_id text DEFAULT NULL,
  p_source jsonb DEFAULT NULL,
  p_snapshot jsonb DEFAULT NULL,
  p_before text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  owner_id text := auth.uid()::text;
  allowed boolean;
  row_workspace public.rh_personal_workspace%ROWTYPE;
  table_name text;
  field_name text;
  saved_id text;
  result jsonb;
  entries jsonb := '{}'::jsonb;
  items jsonb;
  item_kind text;
  cursor_id bigint;
BEGIN
  IF owner_id IS NULL OR COALESCE(auth.jwt()->>'is_anonymous', 'false') = 'true' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_UNAUTHORIZED';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('get', 'source', 'history', 'save', 'import', 'restore', 'remove') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_INVALID';
  END IF;
  IF p_action IN ('source', 'import', 'restore', 'remove') AND (p_kind IS NULL OR p_kind NOT IN ('employees', 'absences', 'pointage')) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_INVALID';
  END IF;
  IF p_action = 'history' AND p_before IS NOT NULL AND (p_kind IS NULL OR p_kind NOT IN ('employees', 'absences', 'pointage') OR p_before !~ '^[1-9][0-9]{0,17}$') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_INVALID';
  END IF;
  IF p_action IN ('source', 'restore') AND (p_id IS NULL OR p_id !~ '^[1-9][0-9]{0,17}$') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_INVALID';
  END IF;
  IF p_action IN ('save', 'import', 'restore', 'remove') AND (p_expected_version IS NULL OR p_expected_version < 0) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_INVALID';
  END IF;
  IF p_action = 'import' THEN
    IF p_source IS NULL OR jsonb_typeof(p_source) <> 'object' OR octet_length(p_source::text) > 4194304
      OR jsonb_typeof(p_source->'filename') IS DISTINCT FROM 'string' OR length(p_source->>'filename') > 255
      OR jsonb_typeof(p_source->'rows') IS DISTINCT FROM 'array' OR jsonb_typeof(p_source->'stats') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_INVALID';
    END IF;
    IF jsonb_array_length(p_source->'rows') > 50000 OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_source->'rows') AS element WHERE jsonb_typeof(element) <> 'object') THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_INVALID';
    END IF;
  END IF;
  IF p_action = 'save' THEN
    IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR octet_length(p_snapshot::text) > 4194304
      OR p_snapshot->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(p_snapshot->'contracts') IS DISTINCT FROM 'object'
      OR jsonb_typeof(p_snapshot->'settings') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_INVALID';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(p_snapshot->'contracts')) > 10000 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_INVALID';
    END IF;
  END IF;

  INSERT INTO public.rh_users (user_id, active) VALUES (owner_id, true) ON CONFLICT (user_id) DO NOTHING;
  SELECT active INTO allowed FROM public.rh_users WHERE user_id = owner_id;
  IF allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_FORBIDDEN';
  END IF;
  INSERT INTO public.rh_personal_workspace (user_id) VALUES (owner_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO row_workspace FROM public.rh_personal_workspace WHERE user_id = owner_id FOR UPDATE;

  IF p_action = 'get' THEN
    INSERT INTO public.rh_audit(user_id, action, version) VALUES (owner_id, 'read', row_workspace.version);
    RETURN jsonb_build_object('version', row_workspace.version,
      'snapshot', jsonb_build_object('version', 1, 'contracts', COALESCE(row_workspace.payload->'contracts', '{}'::jsonb), 'settings', COALESCE(row_workspace.payload->'settings', '{}'::jsonb)),
      'active', jsonb_build_object('employees', row_workspace.active_employees::text, 'absences', row_workspace.active_absences::text, 'pointage', row_workspace.active_pointage::text));
  END IF;
  IF p_action = 'source' THEN
    table_name := CASE p_kind WHEN 'employees' THEN 'rh_import_employees' WHEN 'absences' THEN 'rh_import_absences' ELSE 'rh_import_pointage' END;
    EXECUTE format('SELECT payload FROM public.%I WHERE user_id = $1 AND id = $2', table_name) INTO result USING owner_id, p_id::bigint;
    IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_NOT_FOUND'; END IF;
    INSERT INTO public.rh_audit(user_id, action, version) VALUES (owner_id, 'read', row_workspace.version);
    RETURN jsonb_build_object('source', result);
  END IF;
  IF p_action = 'history' THEN
    FOREACH item_kind IN ARRAY ARRAY['employees', 'absences', 'pointage'] LOOP
      table_name := CASE item_kind WHEN 'employees' THEN 'rh_import_employees' WHEN 'absences' THEN 'rh_import_absences' ELSE 'rh_import_pointage' END;
      cursor_id := CASE WHEN p_kind = item_kind AND p_before IS NOT NULL THEN p_before::bigint ELSE NULL END;
      EXECUTE format('SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'', id::text, ''filename'', filename, ''created_at'', created_at) ORDER BY id DESC), ''[]''::jsonb) FROM (SELECT id, payload->>''filename'' AS filename, created_at FROM public.%I WHERE user_id = $1 AND ($2::bigint IS NULL OR id < $2::bigint) ORDER BY id DESC LIMIT 100) q', table_name) INTO items USING owner_id, cursor_id;
      entries := entries || jsonb_build_object(item_kind, items);
    END LOOP;
    INSERT INTO public.rh_audit(user_id, action, version) VALUES (owner_id, 'read', row_workspace.version);
    RETURN jsonb_build_object('history', entries);
  END IF;
  IF row_workspace.version <> p_expected_version THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_CONFLICT';
  END IF;
  IF p_action = 'save' THEN
    UPDATE public.rh_personal_workspace SET version = version + 1,
      payload = jsonb_build_object('contracts', p_snapshot->'contracts', 'settings', p_snapshot->'settings'), updated_at = now() WHERE user_id = owner_id;
  ELSE
    table_name := CASE p_kind WHEN 'employees' THEN 'rh_import_employees' WHEN 'absences' THEN 'rh_import_absences' ELSE 'rh_import_pointage' END;
    field_name := CASE p_kind WHEN 'employees' THEN 'active_employees' WHEN 'absences' THEN 'active_absences' ELSE 'active_pointage' END;
    saved_id := NULL;
    IF p_action = 'import' THEN
      EXECUTE format('INSERT INTO public.%I(user_id, payload) VALUES ($1, $2) RETURNING id::text', table_name) INTO saved_id USING owner_id, p_source;
    ELSIF p_action = 'restore' THEN
      EXECUTE format('SELECT id::text FROM public.%I WHERE user_id = $1 AND id = $2', table_name) INTO saved_id USING owner_id, p_id::bigint;
      IF saved_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'VOOMNET_NOT_FOUND'; END IF;
    END IF;
    EXECUTE format('UPDATE public.rh_personal_workspace SET version = version + 1, %I = $2::bigint, updated_at = now() WHERE user_id = $1', field_name) USING owner_id, saved_id;
  END IF;
  INSERT INTO public.rh_audit(user_id, action, version) VALUES (owner_id, 'write', row_workspace.version + 1);
  RETURN jsonb_build_object('version', row_workspace.version + 1);
END $$;
REVOKE ALL ON FUNCTION public.voomnet_workspace(text, integer, text, text, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voomnet_workspace(text, integer, text, text, jsonb, jsonb, text) TO authenticated;

COMMIT;
