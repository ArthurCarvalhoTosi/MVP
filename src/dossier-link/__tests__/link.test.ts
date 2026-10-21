import { sha256 } from '@noble/hashes/sha2';
import { cloud } from '@/account';
import type { Db } from '@/db/client';
import {
  createDossierLink,
  deleteDossierLink,
  DOSSIER_PAGE,
  listDossierLinks,
  sealDossier,
} from '@/dossier-link';
import { fromByteaHex } from '@/sync/remote';

jest.mock('expo-crypto', () => require('@/test-utils/crypto').expoCryptoMock());
jest.mock('@/account', () => ({ cloud: jest.fn() }));

// The page's own script, run here with Node's WebCrypto: the app seals, the browser opens.
const page = require('../../../sites/garagem/d.js') as {
  openDossier(
    fragment: string,
    fetchSealed: (hashHex: string) => Promise<Uint8Array>,
  ): Promise<string>;
  LinkError: new (code: string) => Error & { code: string };
};

const HTML = '<!DOCTYPE html><p>Óleo e filtro · R$ 199,00 — São Paulo</p>';
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fragmentOf = (url: string) => url.split('#')[1];
const db = {} as Db;

test('the page opens what the app sealed, asking the server only for the hash', async () => {
  const { url, tokenHash, sealed } = await sealDossier(HTML);
  expect(url).toMatch(new RegExp(`^${DOSSIER_PAGE}#[A-Za-z0-9_-]{22}$`));

  const asked: string[] = [];
  const html = await page.openDossier(fragmentOf(url), async (hashHex) => {
    asked.push(hashHex);
    return sealed;
  });
  expect(html).toBe(HTML);
  expect(asked).toEqual([hex(tokenHash)]);
});

test('the server never gets the secret: the hash is the SHA-256 of the 16-byte secret', async () => {
  const { url, tokenHash } = await sealDossier(HTML);
  const secret = Uint8Array.from(
    atob(fragmentOf(url).replace(/-/g, '+').replace(/_/g, '/') + '=='),
    (c) => c.charCodeAt(0),
  );
  expect(secret).toHaveLength(16);
  expect(hex(tokenHash)).toBe(hex(sha256(secret)));
});

test('a link opens only its own copy, untouched', async () => {
  const a = await sealDossier(HTML);
  const b = await sealDossier(HTML);
  expect(a.url).not.toBe(b.url);

  const incomplete = { code: 'incomplete' };
  await expect(page.openDossier(fragmentOf(a.url), async () => b.sealed)).rejects.toMatchObject(
    incomplete,
  );
  const tampered = a.sealed.slice();
  tampered[tampered.length - 1] ^= 1;
  await expect(page.openDossier(fragmentOf(a.url), async () => tampered)).rejects.toMatchObject(
    incomplete,
  );
  const otherFormat = a.sealed.slice();
  otherFormat[0] = 2;
  await expect(page.openDossier(fragmentOf(a.url), async () => otherFormat)).rejects.toMatchObject(
    incomplete,
  );
});

test('a cut or mangled link is refused before asking the server', async () => {
  const fetchSealed = jest.fn();
  const { url } = await sealDossier(HTML);
  for (const fragment of [
    '',
    fragmentOf(url).slice(0, 21),
    `${fragmentOf(url)}A`,
    'a+b/'.repeat(5) + 'ab',
  ]) {
    await expect(page.openDossier(fragment, fetchSealed)).rejects.toMatchObject({
      code: 'incomplete',
    });
  }
  expect(fetchSealed).not.toHaveBeenCalled();
});

test('a server answer (link gone) reaches the page as it is', async () => {
  const { url } = await sealDossier(HTML);
  await expect(
    page.openDossier(fragmentOf(url), async () => {
      throw new page.LinkError('gone');
    }),
  ).rejects.toMatchObject({ code: 'gone' });
});

describe('with the server', () => {
  const calls: { op: string; args: unknown[] }[] = [];
  let result: { data?: unknown; error: { code: string } | null };

  // A chainable stand-in for supabase.from(...): records each call, resolves to `result`.
  const query: Record<string, unknown> = {};
  for (const op of ['insert', 'select', 'eq', 'order', 'delete'])
    query[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return query;
    };
  query.overrideTypes = () => Promise.resolve(result);
  query.then = (resolve: (r: unknown) => void) => resolve(result);

  beforeEach(() => {
    calls.length = 0;
    result = { data: [], error: null };
    (cloud as jest.Mock).mockReturnValue({ from: () => query });
  });

  test('a new link stores only the hash and the sealed bytes, and returns the URL', async () => {
    const url = await createDossierLink(db, 'car-1', HTML, '2026-11-20T12:00:00.000Z');
    const row = calls.find((c) => c.op === 'insert')!.args[0] as Record<string, string>;
    expect(Object.keys(row).sort()).toEqual(
      ['ciphertext', 'expires_at', 'token_hash', 'vehicle_id'].sort(),
    );
    expect(row.vehicle_id).toBe('car-1');
    expect(row.expires_at).toBe('2026-11-20T12:00:00.000Z');

    const sealed = fromByteaHex(row.ciphertext);
    const html = await page.openDossier(fragmentOf(url), async (hashHex) => {
      expect(`\\x${hashHex}`).toBe(row.token_hash);
      return sealed;
    });
    expect(html).toBe(HTML);
  });

  test('a failed insert throws instead of handing out a dead link', async () => {
    result = { error: { code: '42501' } };
    await expect(createDossierLink(db, 'car-1', HTML, null)).rejects.toThrow('42501');
  });

  test('the list leaves out links that already expired', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    result = {
      data: [
        { id: 'a', created_at: '2026-10-21T10:00:00Z', expires_at: future },
        { id: 'b', created_at: '2026-10-20T10:00:00Z', expires_at: past },
        { id: 'c', created_at: '2026-10-19T10:00:00Z', expires_at: null },
      ],
      error: null,
    };
    expect(await listDossierLinks(db, 'car-1')).toEqual([
      { id: 'a', createdAt: '2026-10-21T10:00:00Z', expiresAt: future },
      { id: 'c', createdAt: '2026-10-19T10:00:00Z', expiresAt: null },
    ]);
    expect(calls).toContainEqual({ op: 'eq', args: ['vehicle_id', 'car-1'] });
  });

  test('deactivating deletes the share', async () => {
    await deleteDossierLink(db, 'a');
    expect(calls.map((c) => c.op)).toEqual(['delete', 'eq']);
    expect(calls[1].args).toEqual(['id', 'a']);
  });
});
