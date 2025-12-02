-- ============================================
-- TEST: RLS Policies simulando un utente specifico
-- ============================================
-- Questo script ti permette di testare le policies
-- come se fossi un utente specifico
-- ============================================

-- STEP 1: Lista tutti gli utenti disponibili
SELECT '=== AVAILABLE USERS ===' as info;
SELECT
  id,
  email,
  username,
  role,
  CASE
    WHEN role = 'admin' THEN '👑 ADMIN'
    ELSE '👤 USER'
  END as user_type
FROM public.profiles
ORDER BY role DESC, created_at;

-- ============================================
-- STEP 2: SCEGLI UN UTENTE E INCOLLA IL SUO ID QUI SOTTO
-- ============================================
-- Copia l'ID di un utente dalla lista sopra e sostituisci 'YOUR-USER-ID-HERE'

\set test_user_id 'YOUR-USER-ID-HERE'

-- Oppure usa questo blocco DO per settare l'ID:
/*
DO $$
BEGIN
  -- Sostituisci con l'ID utente che vuoi testare
  PERFORM set_config('request.jwt.claims',
    json_build_object(
      'sub', 'YOUR-USER-ID-HERE',
      'role', 'authenticated'
    )::text,
    true);
END $$;
*/

-- ============================================
-- STEP 3: Verifica chi sei ora
-- ============================================
SELECT '=== YOUR CURRENT IDENTITY ===' as info;
SELECT
  auth.uid() as your_user_id,
  CASE
    WHEN auth.uid() IS NULL THEN '❌ NOT AUTHENTICATED (questo è il problema!)'
    ELSE '✅ Authenticated as: ' || (SELECT email FROM public.profiles WHERE id = auth.uid())
  END as status,
  (SELECT role FROM public.profiles WHERE id = auth.uid()) as your_role,
  public.is_admin() as are_you_admin;

-- ============================================
-- STEP 4: Verifica formato accessible_users
-- ============================================
SELECT '=== PROJECTS ACCESSIBLE_USERS FORMAT ===' as info;
SELECT
  id,
  title,
  owner_id,
  accessible_users,
  jsonb_typeof(accessible_users) as type_check,
  jsonb_array_length(accessible_users) as num_users
FROM public.projects
ORDER BY created_at DESC
LIMIT 5;

-- ============================================
-- STEP 5: Progetti a cui dovresti avere accesso
-- ============================================
SELECT '=== PROJECTS YOU SHOULD ACCESS ===' as info;
SELECT
  p.id,
  p.title,
  CASE
    WHEN p.owner_id = auth.uid() THEN '👤 Owner'
    WHEN p.accessible_users @> jsonb_build_array(auth.uid()::text) THEN '🔗 Shared'
    WHEN public.is_admin() THEN '👑 Admin'
    ELSE '❌ No access'
  END as access_type,
  p.owner_id = auth.uid() as can_via_ownership,
  p.accessible_users @> jsonb_build_array(auth.uid()::text) as can_via_sharing,
  public.is_admin() as can_via_admin,
  p.accessible_users
FROM public.projects p
ORDER BY p.created_at DESC
LIMIT 10;

-- ============================================
-- STEP 6: Lista tutte le policies attive
-- ============================================
SELECT '=== ACTIVE POLICIES FOR PROJECTS TABLE ===' as info;
SELECT
  policyname,
  cmd as command,
  permissive,
  CASE
    WHEN cmd = 'SELECT' THEN '👁️ READ'
    WHEN cmd = 'INSERT' THEN '➕ CREATE'
    WHEN cmd = 'UPDATE' THEN '✏️ UPDATE'
    WHEN cmd = 'DELETE' THEN '🗑️ DELETE'
    WHEN cmd = '*' THEN '🌟 ALL'
  END as operation_icon,
  substring(qual::text, 1, 60) as using_condition
FROM pg_policies
WHERE tablename = 'projects'
ORDER BY
  CASE cmd
    WHEN 'SELECT' THEN 1
    WHEN 'INSERT' THEN 2
    WHEN 'UPDATE' THEN 3
    WHEN 'DELETE' THEN 4
    ELSE 5
  END,
  policyname;

-- ============================================
-- TROUBLESHOOTING GUIDE
-- ============================================
/*
❌ Se auth.uid() è NULL:
   - Stai eseguendo dal SQL Editor (non puoi testare RLS qui)
   - Soluzione: testa dall'applicazione con utente vero

✅ Se auth.uid() ha un valore:
   - Verifica che "can_via_sharing" sia TRUE per progetti condivisi
   - Verifica che "can_via_admin" sia TRUE se sei admin
   - Verifica che accessible_users contenga il tuo user ID

🔍 Se accessible_users è vuoto []:
   - L'admin non ha condiviso il progetto con nessuno
   - Solo l'owner può accedere

⚠️ Se type_check non è "array":
   - C'è un problema nel formato di accessible_users
   - Dovrebbe essere un array JSON
*/
