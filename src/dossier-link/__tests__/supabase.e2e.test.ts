/**
 * @jest-environment node
 */
// The dossier link against a real local Supabase: RLS on dossier_shares, the dossier Edge
// Function and open_dossier. Skipped unless SYNC_E2E=1; needs `npx supabase start` with the
// migrations applied and `npx supabase functions serve` running:
//   SYNC_E2E=1 npx jest src/dossier-link/__tests__/supabase.e2e.test.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cloud } from '@/account';
import type { Db } from '@/db/client';
import { createDossierLink, deleteDossierLink, linkKeys, listDossierLinks } from '@/dossier-link';
import { toByteaHex } from '@/sync/remote';

jest.mock('expo-crypto', () => require('@/test-utils/crypto').expoCryptoMock());
jest.mock('@/account', () => ({ cloud: jest.fn() }));

const page = require('../../../sites/garagem/d.js') as {
  openDossier(
    fragment: string,
    fetchSealed: (hashHex: string) => Promise<Uint8Array>,
  ): Promise<string>;
};

const e2e = process.env.SYNC_E2E ? describe : describe.skip;

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
  const sb = createClient(API, PUBLISHABLE, { auth: { persistSession: false }, global: { fetch } });
  const { error } = await sb.auth.signInWithPassword({ email, password: 'local-test-pass-123' });
  if (error) throw error;
  return sb;
}

const HTML = '<!DOCTYPE html><p>Óleo e filtro · 40.800 km</p>';
const CAR = '0192b3c4-0000-7000-8000-000000000001';
const db = {} as Db;
const as = (sb: SupabaseClient) => (cloud as jest.Mock).mockReturnValue(sb);

e2e('dossier link against local Supabase', () => {
  let ana: SupabaseClient;
  let bia: SupabaseClient;
  // What the page does, without a browser: no session, no key, only the hash.
  const openFromPage = (url: string) =>
    page.openDossier(url.split('#')[1], async (hashHex) => {
      const res = await fetch(`${localStack().API_URL}/functions/v1/dossier?h=${hashHex}`, {
        headers: { 'x-forwarded-for': `198.51.100.${Date.now() % 250}` },
      });
      if (!res.ok) throw Object.assign(new Error(`status ${res.status}`), { status: res.status });
      return new Uint8Array(await res.arrayBuffer());
    });

  beforeAll(async () => {
    const run = Date.now();
    ana = await signedInClient(`ana-${run}@test.local`);
    bia = await signedInClient(`bia-${run}@test.local`);
  });

  test('a link opens from the public page, and the server holds only ciphertext and hash', async () => {
    as(ana);
    const url = await createDossierLink(db, CAR, HTML, null);
    expect(await openFromPage(url)).toBe(HTML);

    const { data } = await ana.from('dossier_shares').select('*').eq('vehicle_id', CAR);
    const row = data!.at(-1)!;
    expect(Object.keys(row).sort()).toEqual(
      [
        'ciphertext',
        'created_at',
        'expires_at',
        'id',
        'token_hash',
        'user_id',
        'vehicle_id',
      ].sort(),
    );
    expect(JSON.stringify(row)).not.toContain('40.800');
    const secret = Uint8Array.from(
      atob(url.split('#')[1].replace(/-/g, '+').replace(/_/g, '/') + '=='),
      (c) => c.charCodeAt(0),
    );
    expect(row.token_hash).toBe(toByteaHex(linkKeys(secret).tokenHash));
  });

  test('only the owner lists and deactivates; deactivated, the link stops at once', async () => {
    as(ana);
    const url = await createDossierLink(
      db,
      CAR,
      HTML,
      new Date(Date.now() + 86_400_000).toISOString(),
    );
    const mine = await listDossierLinks(db, CAR);
    expect(mine.length).toBeGreaterThan(0);

    as(bia);
    expect(await listDossierLinks(db, CAR)).toEqual([]);
    for (const l of mine) await deleteDossierLink(db, l.id);
    expect(await openFromPage(url)).toBe(HTML);

    as(ana);
    for (const l of mine) await deleteDossierLink(db, l.id);
    expect(await listDossierLinks(db, CAR)).toEqual([]);
    await expect(openFromPage(url)).rejects.toMatchObject({ status: 404 });
  });

  test('a link nobody made is a 404, a malformed hash a 400', async () => {
    const res = await fetch(`${localStack().API_URL}/functions/v1/dossier?h=${'0'.repeat(64)}`);
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect((await fetch(`${localStack().API_URL}/functions/v1/dossier?h=xyz`)).status).toBe(400);
  });
});
