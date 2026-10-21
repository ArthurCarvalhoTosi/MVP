import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import {
  fromBase64,
  fromByteaHex,
  generateDek,
  loadKeks,
  toBase64,
  toByteaHex,
  unwrapDek,
  wrapDek,
} from './keys.ts';

const kekB64 = (fill: number) => toBase64(new Uint8Array(32).fill(fill));
const USER_A = '00000000-0000-0000-0000-00000000000a';
const USER_B = '00000000-0000-0000-0000-00000000000b';

Deno.test('wrap then unwrap returns the same 32-byte key', async () => {
  const keks = await loadKeks(JSON.stringify({ 1: kekB64(1) }));
  const kek = keks.byVersion.get(1)!;
  const dek = generateDek();
  const wrapped = await wrapDek(dek, kek, USER_A);
  assertEquals(wrapped.length, 12 + 32 + 16);
  assertEquals(await unwrapDek(wrapped, kek, USER_A), dek);
});

Deno.test('the same key wraps differently each time (fresh nonce)', async () => {
  const kek = (await loadKeks(JSON.stringify({ 1: kekB64(1) }))).byVersion.get(1)!;
  const dek = generateDek();
  const a = await wrapDek(dek, kek, USER_A);
  const b = await wrapDek(dek, kek, USER_A);
  assertEquals(a.subarray(0, 12).toString() === b.subarray(0, 12).toString(), false);
});

Deno.test('a wrapped key moved to another user does not unwrap', async () => {
  const kek = (await loadKeks(JSON.stringify({ 1: kekB64(1) }))).byVersion.get(1)!;
  const wrapped = await wrapDek(generateDek(), kek, USER_A);
  await assertRejects(() => unwrapDek(wrapped, kek, USER_B));
});

Deno.test('a wrapped key does not unwrap with another KEK or after tampering', async () => {
  const keks = await loadKeks(JSON.stringify({ 1: kekB64(1), 2: kekB64(2) }));
  const wrapped = await wrapDek(generateDek(), keks.byVersion.get(1)!, USER_A);
  await assertRejects(() => unwrapDek(wrapped, keks.byVersion.get(2)!, USER_A));
  const tampered = wrapped.slice();
  tampered[20] ^= 1;
  await assertRejects(() => unwrapDek(tampered, keks.byVersion.get(1)!, USER_A));
});

Deno.test('the highest KEK version is the current one', async () => {
  const keks = await loadKeks(JSON.stringify({ 1: kekB64(1), 3: kekB64(3), 2: kekB64(2) }));
  assertEquals(keks.currentVersion, 3);
  assertEquals(keks.byVersion.size, 3);
});

Deno.test('a missing or malformed KEKS secret fails closed', async () => {
  await assertRejects(() => loadKeks(undefined), Error, 'not set');
  await assertRejects(() => loadKeks(''), Error, 'not set');
  await assertRejects(() => loadKeks('{}'), Error, 'no keys');
  await assertRejects(() => loadKeks('[1]'), Error, 'invalid');
  await assertRejects(() => loadKeks('{"0": "AAAA"}'), Error, 'invalid');
  await assertRejects(
    () => loadKeks(JSON.stringify({ 1: toBase64(new Uint8Array(16)) })),
    Error,
    '32 bytes',
  );
  await assertRejects(() => loadKeks('not json'));
});

Deno.test('base64 round-trips every byte value', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assertEquals(fromBase64(toBase64(all)), all);
});

Deno.test('bytea hex round-trips and matches the PostgREST format', () => {
  assertEquals(toByteaHex(Uint8Array.of(0, 15, 255)), '\\x000fff');
  assertEquals(fromByteaHex('\\x000FFF'), Uint8Array.of(0, 15, 255));
  assertEquals(fromByteaHex('\\x'), new Uint8Array(0));
  assertThrows(() => fromByteaHex('000fff'));
  assertThrows(() => fromByteaHex('\\x0'));
  assertThrows(() => fromByteaHex('\\xzz'));
});
