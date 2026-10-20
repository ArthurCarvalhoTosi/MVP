import type { SupabaseClient } from '@supabase/supabase-js';
import type { Remote, SealedRow } from '.';

const PAGE = 1000;
const BUCKET = 'attachments';
const COLUMNS =
  'table_name, id, updated_at, deleted_at, ciphertext, nonce, key_version, server_updated_at';

type Record = {
  table_name: string;
  id: string;
  updated_at: string;
  deleted_at: string | null;
  ciphertext: string;
  nonce: string;
  key_version: number;
  server_updated_at: string;
};

// PostgREST reads and writes bytea as "\x" followed by hex.
export function toByteaHex(bytes: Uint8Array): string {
  let hex = '\\x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export function fromByteaHex(s: string): Uint8Array {
  if (!/^\\x([0-9a-f]{2})*$/i.test(s)) throw new Error('not a bytea hex string');
  const out = new Uint8Array((s.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

// Postgres answers "2026-10-20T20:01:17.886+00:00"; rows carry toISOString() ("…17.886Z").
// The same instant must be the same string, or the sealed-vs-readable check and the newer-copy
// comparison (both on strings) go wrong. Millisecond precision is all the app writes.
export function isoMs(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

// React Native's Blob has no arrayBuffer(); its FileReader reads one.
async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(new Error('could not read the photo'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * The sync_records table and the photo bucket, as the signed-in user sees them through RLS.
 * Photos live in the user's own folder: "<user id>/<attachment id>.bin".
 */
export function supabaseRemote(sb: SupabaseClient): Remote {
  const photoPath = async (attachmentId: string) => {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error('sync photos: signed out');
    return `${data.session.user.id}/${attachmentId}.bin`;
  };

  return {
    async pull(since) {
      const out: Awaited<ReturnType<Remote['pull']>> = [];
      for (let from = 0; ; from += PAGE) {
        let query = sb
          .from('sync_records')
          .select(COLUMNS)
          .order('server_updated_at')
          .order('table_name')
          .order('id')
          .range(from, from + PAGE - 1);
        if (since) query = query.gt('server_updated_at', since);
        const { data, error } = await query.overrideTypes<Record[], { merge: false }>();
        if (error) throw new Error(`sync pull failed: ${error.code}`);
        for (const r of data)
          out.push({
            table: r.table_name,
            id: r.id,
            updatedAt: isoMs(r.updated_at),
            deletedAt: r.deleted_at && isoMs(r.deleted_at),
            ciphertext: fromByteaHex(r.ciphertext),
            nonce: fromByteaHex(r.nonce),
            keyVersion: r.key_version,
            serverUpdatedAt: r.server_updated_at,
          });
        if (data.length < PAGE) return out;
      }
    },

    async push(rows: SealedRow[]) {
      if (rows.length === 0) return;
      // user_id comes from the session on the server; the app can't set it.
      const { error } = await sb.from('sync_records').upsert(
        rows.map((r) => ({
          table_name: r.table,
          id: r.id,
          updated_at: r.updatedAt,
          deleted_at: r.deletedAt,
          ciphertext: toByteaHex(r.ciphertext),
          nonce: toByteaHex(r.nonce),
          key_version: r.keyVersion,
        })),
        { onConflict: 'user_id,table_name,id' },
      );
      if (error) throw new Error(`sync push failed: ${error.code}`);
    },

    async uploadPhoto(attachmentId, sealed) {
      // An ArrayBuffer: React Native can't send a Blob made from bytes.
      const body = sealed.slice().buffer;
      const { error } = await sb.storage.from(BUCKET).upload(await photoPath(attachmentId), body, {
        contentType: 'application/octet-stream',
        upsert: true,
      });
      if (error) throw new Error(`photo upload failed: ${storageStatus(error)}`);
    },

    async downloadPhoto(attachmentId) {
      const { data, error } = await sb.storage.from(BUCKET).download(await photoPath(attachmentId));
      if (error) {
        // Storage answers a missing object with 400 and "not_found" or a 404 status code.
        if (storageStatus(error) === '404') return null;
        throw new Error(`photo download failed: ${storageStatus(error)}`);
      }
      return blobBytes(data);
    },

    async removePhotos(attachmentIds) {
      if (attachmentIds.length === 0) return;
      const paths = await Promise.all(attachmentIds.map(photoPath));
      const { error } = await sb.storage.from(BUCKET).remove(paths);
      if (error) throw new Error(`photo removal failed: ${storageStatus(error)}`);
    },
  };
}

function storageStatus(error: unknown): string {
  const e = error as { statusCode?: unknown; status?: unknown };
  return String(e.statusCode ?? e.status ?? 'unknown');
}
