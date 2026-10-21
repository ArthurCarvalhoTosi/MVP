// Each synced row travels as AES-256-GCM ciphertext under the user's data key (DEK). The table
// and id ride along as associated data: the server can't pass one row off as another.
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { isSyncTable, sharedRow, SYNC_TABLES, type SyncRow, type SyncTable } from '@/db/sync';

/** A row as the server keeps it: only the envelope is readable there. */
export type SealedRow = {
  table: SyncTable;
  id: string;
  updatedAt: string;
  deletedAt: string | null;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  keyVersion: number;
  serverUpdatedAt?: string;
};

// Bumped if the DEK is ever rotated; rows say which key sealed them.
export const KEY_VERSION = 1;
const ENVELOPE_VERSION = 1;

// JSON with every non-ASCII character escaped, so a string is its own byte sequence and no
// TextEncoder/TextDecoder is needed (Hermes lacks a full TextDecoder).
function asciiBytes(s: string): Uint8Array {
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

const aad = (table: string, id: string) => asciiBytes(`garagem/row/v1:${table}:${id}`);

export function importDataKey(base64: string): Promise<AESEncryptionKey> {
  return AESEncryptionKey.import(base64, 'base64');
}

export async function sealRow(key: AESEncryptionKey, r: SyncRow): Promise<SealedRow> {
  const sealed = await aesEncryptAsync(
    asciiBytes(asciiJson({ v: ENVELOPE_VERSION, row: sharedRow(r.table, r.row) })),
    key,
    {
      additionalData: aad(r.table, r.id),
    },
  );
  return {
    table: r.table,
    id: r.id,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
    ciphertext: await sealed.ciphertext({ includeTag: true }),
    nonce: await sealed.iv(),
    keyVersion: KEY_VERSION,
  };
}

/**
 * Opens a row from the server, or null when it can't be trusted: wrong key, tampered bytes,
 * or contents that don't match the envelope (a row claiming another id or time).
 */
export async function openRow(
  key: AESEncryptionKey,
  s: Omit<SealedRow, 'table'> & { table: string },
): Promise<SyncRow | null> {
  if (!isSyncTable(s.table)) return null;
  let plain: Uint8Array;
  try {
    plain = await aesDecryptAsync(AESSealedData.fromParts(s.nonce, s.ciphertext), key, {
      additionalData: aad(s.table, s.id),
    });
  } catch {
    return null;
  }
  let envelope: unknown;
  try {
    let text = '';
    for (const b of plain) text += String.fromCharCode(b);
    envelope = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof envelope !== 'object' || envelope === null) return null;
  const { v, row } = envelope as { v?: unknown; row?: unknown };
  if (v !== ENVELOPE_VERSION || typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  if (r[SYNC_TABLES[s.table].keyName] !== s.id || r.updatedAt !== s.updatedAt) return null;
  return {
    table: s.table,
    id: s.id,
    updatedAt: s.updatedAt,
    deletedAt: (r.deletedAt as string | null) ?? null,
    row: r,
  };
}
