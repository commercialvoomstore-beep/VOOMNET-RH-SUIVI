-- Autoriser un compte RH EXISTANT, exemple identifiant 1005.
-- AVANT : créer le compte dans Neon Auth avec le mot de passe par la procédure
-- administrative prévue ; exécuter 001_initial.sql et 002_individual_imports.sql.
-- Dans Neon, sélectionner la branche et la base utilisées par l'application.
-- Remplacer ci-dessous ID_INTERNE_NEON_AUTH par l'id du compte vérifié dans
-- Auth > Users. Ne pas mettre de mot de passe dans ce script ou le SQL Editor.
-- Le compte doit avoir l'email technique exact 1005@rh-identifiant.invalid.
-- Ce script ne crée pas le compte Neon Auth et ne change pas son mot de passe.
-- La fonction API créera automatiquement l'espace personnel à la première connexion.

DO $$
DECLARE
  identifiant_rh text := '1005'; -- Modifier pour autoriser un autre identifiant numérique.
  id_neon text := 'ID_INTERNE_NEON_AUTH'; -- Remplacer par le vrai id Neon Auth vérifié.
  alias_attendu text;
  est_actif boolean;
  lignes_inserees integer;
BEGIN
  IF identifiant_rh !~ '^[0-9]{1,16}$' THEN
    RAISE EXCEPTION 'Identifiant RH invalide : utiliser 1 à 16 chiffres.';
  END IF;
  IF id_neon = 'ID_INTERNE_NEON_AUTH' OR id_neon = '' OR id_neon <> btrim(id_neon) THEN
    RAISE EXCEPTION 'Remplacer ID_INTERNE_NEON_AUTH par le vrai id du compte Neon Auth.';
  END IF;
  alias_attendu := identifiant_rh || '@rh-identifiant.invalid';

  -- L'identifiant interne ET l'alias doivent correspondre au même compte.
  IF NOT EXISTS (
    SELECT 1 FROM neon_auth."user"
    WHERE id::text = id_neon AND email = alias_attendu
  ) THEN
    RAISE EXCEPTION 'Compte introuvable ou alias incorrect. Vérifier Auth > Users et la branche Neon.';
  END IF;

  INSERT INTO public.rh_users (user_id, active)
  VALUES (id_neon, true)
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS lignes_inserees = ROW_COUNT;

  SELECT active INTO est_actif FROM public.rh_users WHERE user_id = id_neon;
  IF NOT est_actif THEN
    RAISE EXCEPTION 'Compte RH déjà désactivé : aucune réactivation automatique. Vérifier avant toute réactivation manuelle.';
  END IF;
  IF lignes_inserees = 0 THEN
    RAISE NOTICE 'Compte RH déjà autorisé ; aucune modification effectuée.';
  ELSE
    RAISE NOTICE 'Compte RH autorisé. La création du compte et du mot de passe reste du ressort de Neon Auth.';
  END IF;
END $$;
