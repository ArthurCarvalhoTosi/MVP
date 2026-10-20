import { generateDek, type Keks, toBase64, unwrapDek, wrapDek } from './keys.ts';

export interface StoredKey {
  wrapped: Uint8Array<ArrayBuffer>;
  kekVersion: number;
}

export interface KeyStore {
  read(userId: string): Promise<StoredKey | null>;
  // Must not overwrite: a second device may have stored its key first.
  insertIfAbsent(userId: string, key: StoredKey): Promise<void>;
}

// POST /user-key -> { dek } for the signed-in user, creating it on first use. The DEK is
// made here rather than on the phone: the server sees it anyway when wrapping, and two
// devices signing in for the first time at once must end up with the same key.
export async function handleUserKey(
  req: Request,
  userId: string,
  store: KeyStore,
  keks: Keks,
): Promise<Response> {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });

  let stored = await store.read(userId);
  if (!stored) {
    const kek = keks.byVersion.get(keks.currentVersion)!;
    await store.insertIfAbsent(userId, {
      wrapped: await wrapDek(generateDek(), kek, userId),
      kekVersion: keks.currentVersion,
    });
    // Read back instead of trusting our own copy: another device may have won the race.
    stored = await store.read(userId);
    if (!stored) throw new Error('user key missing after insert');
  }

  const kek = keks.byVersion.get(stored.kekVersion);
  if (!kek) throw new Error(`no KEK for version ${stored.kekVersion}`);
  // shortcut: keys wrapped by an older KEK are served as is; re-wrap them with the current
  // version here when the first rotation happens.
  const dek = await unwrapDek(stored.wrapped, kek, userId);

  return Response.json({ dek: toBase64(dek) }, { headers: { 'Cache-Control': 'no-store' } });
}
