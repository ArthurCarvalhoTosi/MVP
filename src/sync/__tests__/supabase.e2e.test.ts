/**
 * @jest-environment node
 */
// Sync against a real local Supabase (PostgREST, RLS, the sync_records trigger and grants).
// Skipped unless SYNC_E2E=1; needs `npx supabase start` with the migrations applied:
//   SYNC_E2E=1 npx jest src/sync/__tests__/supabase.e2e.test.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AESEncryptionKey } from 'expo-crypto';
import type { Db } from '@/db/client';
import { createVehicle, renameVehicle, vehiclesQuery } from '@/db/repo';
import { createTestDb } from '@/db/test-utils/testDb';
import { syncOnce } from '..';
import { supabaseRemote } from '../remote';

jest.mock('expo-crypto', () => require('@/test-utils/crypto').expoCryptoMock());

const e2e = process.env.SYNC_E2E ? describe : describe.skip;

// The local stack's URL and keys, as `supabase status` prints them (never committed).
function localStack(): { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string } {
  const out: string = require('child_process').execSync('npx supabase status -o json', {
    encoding: 'utf8',
  });
  return JSON.parse(out.slice(out.indexOf('{')));
}
// jest-expo replaces the global fetch with a stub, even in the node environment.
const fetch = require('node-fetch');

async function signedInClient(email: string): Promise<SupabaseClient> {
  const { API_URL: API, PUBLISHABLE_KEY: PUBLISHABLE, SECRET_KEY: SECRET } = localStack();
  const admin = createClient(API, SECRET, { auth: { persistSession: false }, global: { fetch } });
  await admin.auth.admin.createUser({
    email,
    password: 'local-test-pass-123',
    email_confirm: true,
  });
  const sb = createClient(API, PUBLISHABLE, {
    auth: { persistSession: false },
    global: { fetch },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: 'local-test-pass-123' });
  if (error) throw error;
  return sb;
}

const NEW_CAR = { odometerKm: 40000, monthlyKmEstimate: 1000, severeUse: false, items: [] };
const names = (db: Db) =>
  vehiclesQuery(db)
    .all()
    .map((v) => v.nickname);

e2e('sync against local Supabase', () => {
  let ana: SupabaseClient;
  let bia: SupabaseClient;
  let key: AESEncryptionKey;

  beforeAll(async () => {
    const run = Date.now();
    ana = await signedInClient(`ana-${run}@test.local`);
    bia = await signedInClient(`bia-${run}@test.local`);
    key = await AESEncryptionKey.generate();
  });

  test('two phones of one account converge; the newer edit wins on the server', async () => {
    const phoneA = await createTestDb();
    const phoneB = await createTestDb();
    const id = await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');

    expect(await syncOnce(phoneA, supabaseRemote(ana), key)).toMatchObject({ pushed: 3 });
    expect(await syncOnce(phoneB, supabaseRemote(ana), key)).toMatchObject({ pulled: 3 });
    expect(names(phoneB)).toEqual(['Meu Sandero']);

    await renameVehicle(phoneA, id, 'Velho');
    await new Promise((r) => setTimeout(r, 5));
    await renameVehicle(phoneB, id, 'Novo');
    await syncOnce(phoneB, supabaseRemote(ana), key);
    // A pushes its older copy: the trigger keeps B's, then A pulls it.
    await syncOnce(phoneA, supabaseRemote(ana), key);
    await syncOnce(phoneA, supabaseRemote(ana), key);
    expect(names(phoneA)).toEqual(['Novo']);
  });

  test("another account sees none of it, and can't overwrite it", async () => {
    const phoneA = await createTestDb();
    await createVehicle(phoneA, { nickname: 'Da Ana', ...NEW_CAR }, '2026-10-01');
    await syncOnce(phoneA, supabaseRemote(ana), key);

    const phoneC = await createTestDb();
    expect(await syncOnce(phoneC, supabaseRemote(bia), key)).toMatchObject({ pulled: 0 });

    // Bia pushes rows with the same ids: they become Bia's own rows, Ana's stay untouched.
    const copy = await createTestDb();
    await syncOnce(copy, supabaseRemote(ana), key);
    await renameVehicle(copy, vehiclesQuery(copy).all()[0].id, 'Sequestrado');
    await syncOnce(copy, supabaseRemote(bia), key);

    const anaAgain = await createTestDb();
    await syncOnce(anaAgain, supabaseRemote(ana), key);
    expect(names(anaAgain)).not.toContain('Sequestrado');
  });
});
