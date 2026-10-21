// Dossier link (v1): a frozen copy of the history, sealed on the phone with a key only the link
// holds. The link is DOSSIER_PAGE#<secret>; browsers never send what follows the "#", so the
// server keeps the ciphertext and the secret's SHA-256 and can read neither. The page
// (sites/garagem/d.js) derives the same key and decrypts in the browser. See "Fatia 5" in
// section 12 of decisoes_projeto_manutencao_veicular.md.
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { AESEncryptionKey, aesEncryptAsync, getRandomBytes } from 'expo-crypto';
import { cloud } from '@/account';
import type { Db } from '@/db/client';
import { toByteaHex } from '@/sync/remote';

export const DOSSIER_PAGE = 'https://garagem.acttechsoftware.com.br/d';
// d.js reads both: changing either breaks every link already sent.
const FORMAT = 1;
const KEY_INFO = 'garagem/dossier/key/v1';

/** The share's name on the server and the key that seals it, both from the link secret. */
export function linkKeys(secret: Uint8Array) {
  return {
    tokenHash: sha256(secret),
    key: hkdf(sha256, secret, undefined, KEY_INFO, 32),
  };
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** Draws a 128-bit secret and seals the page with it. Layout: format byte, nonce, ciphertext, tag. */
export async function sealDossier(html: string) {
  const secret = getRandomBytes(16);
  const { tokenHash, key } = linkKeys(secret);
  const body = await (
    await aesEncryptAsync(new TextEncoder().encode(html), await AESEncryptionKey.import(key))
  ).combined();
  const sealed = new Uint8Array(1 + body.length);
  sealed[0] = FORMAT;
  sealed.set(body, 1);
  return { url: `${DOSSIER_PAGE}#${base64url(secret)}`, tokenHash, sealed };
}

/** Publishes the sealed page and returns the link. The secret is not kept: a lost link is replaced. */
export async function createDossierLink(
  db: Db,
  vehicleId: string,
  html: string,
  expiresAt: string | null,
): Promise<string> {
  const { url, tokenHash, sealed } = await sealDossier(html);
  // user_id comes from the session on the server.
  const { error } = await cloud(db)
    .from('dossier_shares')
    .insert({
      vehicle_id: vehicleId,
      token_hash: toByteaHex(tokenHash),
      ciphertext: toByteaHex(sealed),
      expires_at: expiresAt,
    });
  if (error) throw new Error(`create dossier link: ${error.code}`);
  return url;
}

export type DossierLink = { id: string; createdAt: string; expiresAt: string | null };

/** This car's links that still open, newest first. Expired ones wait for the hourly cleanup. */
export async function listDossierLinks(db: Db, vehicleId: string): Promise<DossierLink[]> {
  const { data, error } = await cloud(db)
    .from('dossier_shares')
    .select('id, created_at, expires_at')
    .eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: false })
    .overrideTypes<
      { id: string; created_at: string; expires_at: string | null }[],
      { merge: false }
    >();
  if (error) throw new Error(`list dossier links: ${error.code}`);
  const now = Date.now();
  return data
    .filter((s) => s.expires_at === null || new Date(s.expires_at).getTime() > now)
    .map((s) => ({ id: s.id, createdAt: s.created_at, expiresAt: s.expires_at }));
}

/** Deactivating deletes the share: the link stops opening at once and nothing stays behind. */
export async function deleteDossierLink(db: Db, id: string): Promise<void> {
  const { error } = await cloud(db).from('dossier_shares').delete().eq('id', id);
  if (error) throw new Error(`delete dossier link: ${error.code}`);
}
