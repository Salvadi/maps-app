// C9: Test freeze pre-cutover — verifica che supabase-freeze.sql sia correttamente applicato
// Usage: npx ts-node scripts/test-freeze.ts
// Eseguire in ambiente STAGING dopo aver applicato supabase-freeze.sql
// NON eseguire in produzione con dati reali

import { createClient } from '@supabase/supabase-js';
import assert from 'assert';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@opimappa-staging.io';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test-password-staging';

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Required env vars: SUPABASE_URL, SUPABASE_ANON_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, ANON_KEY);

async function main() {
  console.log('Test freeze Supabase pre-cutover...\n');

  // Login utente reale (deve esistere in staging)
  const { error: loginErr } = await sb.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (loginErr) {
    console.error('Login fallito:', loginErr.message);
    console.error('Assicurarsi che TEST_EMAIL/TEST_PASSWORD puntino a un utente staging valido');
    process.exit(1);
  }
  console.log('✓ Login utente authenticated riuscito');

  // Test 1: INSERT deve fallire (tabella con RLS attiva)
  const { error: insertErr } = await sb.from('projects').insert({
    title: 'test-freeze-check',
    owner_id: 'test-freeze',
  });
  assert(insertErr !== null, '❌ FAIL: INSERT projects non bloccato dal freeze');
  console.log('✓ INSERT projects bloccato correttamente:', insertErr.code ?? insertErr.message);

  // Test 2: UPDATE deve fallire
  const { error: updateErr } = await sb.from('projects').update({ title: 'freeze-test' }).eq('id', '00000000-0000-0000-0000-000000000000');
  assert(updateErr !== null, '❌ FAIL: UPDATE projects non bloccato dal freeze');
  console.log('✓ UPDATE projects bloccato correttamente:', updateErr.code ?? updateErr.message);

  // Test 3: DELETE deve fallire
  const { error: deleteErr } = await sb.from('projects').delete().eq('id', '00000000-0000-0000-0000-000000000000');
  assert(deleteErr !== null, '❌ FAIL: DELETE projects non bloccato dal freeze');
  console.log('✓ DELETE projects bloccato correttamente:', deleteErr.code ?? deleteErr.message);

  // Test 4: Storage upload deve fallire
  const { error: upErr } = await sb.storage.from('photos').upload('test-freeze-check.jpg', new Blob(['x']), { upsert: true });
  assert(upErr !== null, '❌ FAIL: Storage upload photos non bloccato dal freeze');
  console.log('✓ Storage upload photos bloccato correttamente:', upErr.message);

  // Test 5: Storage upload planimetrie deve fallire
  const { error: upErr2 } = await sb.storage.from('planimetrie').upload('test-freeze-check.pdf', new Blob(['x']), { upsert: true });
  assert(upErr2 !== null, '❌ FAIL: Storage upload planimetrie non bloccato dal freeze');
  console.log('✓ Storage upload planimetrie bloccato correttamente:', upErr2.message);

  // Test 6: SELECT deve funzionare (read-only non bloccato)
  const { error: selErr } = await sb.from('projects').select('id').limit(1);
  assert(selErr === null, `❌ FAIL: SELECT bloccato dal freeze (errato): ${selErr?.message}`);
  console.log('✓ SELECT projects funziona (read-only non bloccato)');

  console.log('\n✅ Tutti i test freeze passati. Supabase è in freeze corretto per il cutover.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Errore fatale nel test freeze:', e);
  process.exit(1);
});
