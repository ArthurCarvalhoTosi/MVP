import { assertEquals, assertRejects } from '@std/assert';
import { handleUserKey, type KeyStore, type StoredKey } from './handler.ts';
import { fromBase64, generateDek, loadKeks, toBase64, wrapDek } from './keys.ts';

const USER = '00000000-0000-0000-0000-00000000000a';
const post = () => new Request('http://local/user-key', { method: 'POST' });

function memoryStore(): KeyStore & { rows: Map<string, StoredKey> } {
  const rows = new Map<string, StoredKey>();
  return {
    rows,
    read: (id) => Promise.resolve(rows.get(id) ?? null),
    insertIfAbsent(id, key) {
      if (!rows.has(id)) rows.set(id, key);
      return Promise.resolve();
    },
  };
}

const keks = (...versions: number[]) =>
  loadKeks(
    JSON.stringify(
      Object.fromEntries(versions.map((v) => [v, toBase64(new Uint8Array(32).fill(v))])),
    ),
  );

async function dekOf(res: Response) {
  return fromBase64((await res.json()).dek);
}

Deno.test('only POST is accepted', async () => {
  const res = await handleUserKey(
    new Request('http://local/user-key'),
    USER,
    memoryStore(),
    await keks(1),
  );
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

Deno.test('the first call creates a key, wrapped with the current KEK', async () => {
  const store = memoryStore();
  const res = await handleUserKey(post(), USER, store, await keks(1, 2));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'no-store');
  assertEquals((await dekOf(res)).length, 32);
  assertEquals(store.rows.get(USER)?.kekVersion, 2);
});

Deno.test('later calls (another phone) return the same key', async () => {
  const store = memoryStore();
  const k = await keks(1);
  const first = await dekOf(await handleUserKey(post(), USER, store, k));
  const second = await dekOf(await handleUserKey(post(), USER, store, k));
  assertEquals(second, first);
});

Deno.test('when another phone stores its key first, both get that key', async () => {
  const k = await keks(1);
  const theirs = generateDek();
  const store = memoryStore();
  // Another request inserts between our read (empty) and our insert.
  let reads = 0;
  const racing: KeyStore = {
    read(id) {
      if (reads++ === 0) return Promise.resolve(null);
      return store.read(id);
    },
    async insertIfAbsent(id, key) {
      await store.insertIfAbsent(id, {
        wrapped: await wrapDek(theirs, k.byVersion.get(1)!, id),
        kekVersion: 1,
      });
      await store.insertIfAbsent(id, key);
    },
  };
  assertEquals(await dekOf(await handleUserKey(post(), USER, racing, k)), theirs);
});

Deno.test('a key wrapped before a KEK rotation still opens', async () => {
  const before = await keks(1);
  const store = memoryStore();
  const dek = await dekOf(await handleUserKey(post(), USER, store, before));
  const after = await keks(1, 2);
  assertEquals(await dekOf(await handleUserKey(post(), USER, store, after)), dek);
});

Deno.test('a key wrapped by a KEK that is gone fails instead of making a new key', async () => {
  const store = memoryStore();
  await handleUserKey(post(), USER, store, await keks(1)).then((r) => r.body?.cancel());
  const rotatedAway = await keks(2);
  await assertRejects(
    () => handleUserKey(post(), USER, store, rotatedAway),
    Error,
    'no KEK for version 1',
  );
  assertEquals(store.rows.get(USER)?.kekVersion, 1);
});
