-- Option de privilèges minimaux, après 001, 002 et 004.
-- Un administrateur doit d'abord créer le rôle PostgreSQL rh_backend avec LOGIN
-- et définir son mot de passe hors Git et hors de la conversation. Ne pas
-- utiliser ce rôle dans le navigateur. À valider sur un projet isolé.
-- Ne donne NI les droits propriétaire, NI BYPASSRLS à ce rôle.

GRANT USAGE ON SCHEMA public, rh_private TO rh_backend;
GRANT SELECT ON public.rh_users TO rh_backend;
GRANT SELECT, INSERT, UPDATE ON public.rh_personal_workspace TO rh_backend;
GRANT SELECT, INSERT ON public.rh_import_employees, public.rh_import_absences, public.rh_import_pointage TO rh_backend;
GRANT INSERT ON public.rh_audit TO rh_backend;
GRANT USAGE ON public.rh_audit_id_seq, public.rh_import_employees_id_seq,
  public.rh_import_absences_id_seq, public.rh_import_pointage_id_seq TO rh_backend;
GRANT SELECT, INSERT, UPDATE, DELETE ON rh_private.login_attempts TO rh_backend;
GRANT EXECUTE ON FUNCTION rh_private.email_for_identifier(text) TO rh_backend;

-- L'API serveur applique ensuite le filtre obligatoire user_id à chaque requête.
-- Ce rôle a accès à tous les espaces : sa clé reste strictement côté serveur.
DROP POLICY IF EXISTS voomnet_backend ON public.rh_users;
CREATE POLICY voomnet_backend ON public.rh_users FOR SELECT TO rh_backend USING (true);
DROP POLICY IF EXISTS voomnet_backend ON public.rh_personal_workspace;
CREATE POLICY voomnet_backend ON public.rh_personal_workspace FOR ALL TO rh_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS voomnet_backend ON public.rh_import_employees;
CREATE POLICY voomnet_backend ON public.rh_import_employees FOR ALL TO rh_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS voomnet_backend ON public.rh_import_absences;
CREATE POLICY voomnet_backend ON public.rh_import_absences FOR ALL TO rh_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS voomnet_backend ON public.rh_import_pointage;
CREATE POLICY voomnet_backend ON public.rh_import_pointage FOR ALL TO rh_backend USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS voomnet_backend ON public.rh_audit;
CREATE POLICY voomnet_backend ON public.rh_audit FOR INSERT TO rh_backend WITH CHECK (true);
