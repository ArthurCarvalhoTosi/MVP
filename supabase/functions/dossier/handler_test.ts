import { assertEquals, assertNotEquals, assertRejects } from '@std/assert';
import { clientKey, handleDossier, type OpenDossier, RateLimited } from './handler.ts';

const HASH = 'ab'.repeat(32);
const get = (query: string, headers: Record<string, string> = {}) =>
  new Request(`http://local/dossier${query}`, { headers });

function opener(result: Uint8Array | null | Error) {
  const calls: { tokenHash: Uint8Array; client: string }[] = [];
  const open: OpenDossier = (tokenHash, client) => {
    calls.push({ tokenHash, client });
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { open, calls };
}

Deno.test('a live link returns the sealed bytes, uncached', async () => {
  const { open, calls } = opener(Uint8Array.of(1, 2, 3));
  const res = await handleDossier(get(`?h=${HASH}`), open);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Content-Type'), 'application/octet-stream');
  assertEquals(res.headers.get('Cache-Control'), 'no-store');
  assertEquals(new Uint8Array(await res.arrayBuffer()), Uint8Array.of(1, 2, 3));
  assertEquals(calls[0].tokenHash, new Uint8Array(32).fill(0xab));
});

Deno.test('an unknown, deleted or expired link is a 404 nobody caches', async () => {
  const res = await handleDossier(get(`?h=${HASH}`), opener(null).open);
  assertEquals(res.status, 404);
  assertEquals(res.headers.get('Cache-Control'), 'no-store');
  assertEquals(await res.json(), { error: 'not_found' });
});

Deno.test('past the limit: 429 with Retry-After', async () => {
  const res = await handleDossier(get(`?h=${HASH}`), opener(new RateLimited()).open);
  assertEquals(res.status, 429);
  assertEquals(res.headers.get('Retry-After'), '600');
  await res.body?.cancel();
});

Deno.test('other failures propagate (index.ts answers 500)', async () => {
  await assertRejects(() => handleDossier(get(`?h=${HASH}`), opener(new Error('db')).open));
});

Deno.test('only GET with a 64-hex hash reaches the database', async () => {
  const { open, calls } = opener(Uint8Array.of(1));
  for (const query of ['', '?h=', `?h=${HASH.toUpperCase()}`, `?h=${HASH}0`, '?h=zz']) {
    const res = await handleDossier(get(query), open);
    assertEquals(res.status, 400, query);
    await res.body?.cancel();
  }
  const post = await handleDossier(
    new Request(`http://local/dossier?h=${HASH}`, { method: 'POST' }),
    open,
  );
  assertEquals(post.status, 405);
  await post.body?.cancel();
  assertEquals(calls.length, 0);
});

Deno.test('the rate-limit key is a hash of the first forwarded IP, never the IP', async () => {
  const a = await clientKey(get('', { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
  assertEquals(a.length, 64);
  assertEquals(a, await clientKey(get('', { 'x-forwarded-for': '203.0.113.7' })));
  assertNotEquals(a, await clientKey(get('', { 'x-forwarded-for': '203.0.113.8' })));
  assertEquals((await clientKey(get(''))).length, 64);
});
