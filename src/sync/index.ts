// Cloud sync (v1): pull what changed on the server, land it locally, push what changed here.
// Every row is sealed with the user's data key before it leaves the phone. See the "Plano da
// v1" in section 12 of decisoes_projeto_manutencao_veicular.md.
import type { AESEncryptionKey } from 'expo-crypto';
import type { Db } from '@/db/client';
import {
  applyRemote,
  forgetPhotos,
  isPhotoUploaded,
  livePhotos,
  markPhotoUploaded,
  markSynced,
  pendingRows,
  readSyncPref,
  writeSyncPref,
  type SyncRow,
} from '@/db/sync';
import { openPhoto, sealPhoto } from './photos';
import { openRow, sealRow, type SealedRow } from './rows';

export { importDataKey } from './rows';
export type { SealedRow } from './rows';

export interface Remote {
  /** Every row the server changed after `since` (server clock), or all rows when null. */
  pull(since: string | null): Promise<(Omit<SealedRow, 'table'> & { table: string })[]>;
  /** Upserts rows; the server keeps the newer copy of each. */
  push(rows: SealedRow[]): Promise<void>;
  /** Stores a sealed photo file, replacing an earlier copy. */
  uploadPhoto(attachmentId: string, sealed: Uint8Array): Promise<void>;
  /** A sealed photo file, or null when the cloud has none under this id. */
  downloadPhoto(attachmentId: string): Promise<Uint8Array | null>;
  /** Deletes photo files; ids without one are fine. */
  removePhotos(attachmentIds: string[]): Promise<void>;
}

/** This phone's photo files (@/attachments), sealed with this phone's own key. */
export interface LocalPhotos {
  /** The JPEG as base64; throws when the file is missing or unreadable. */
  read(filePath: string): Promise<string>;
  write(filePath: string, jpegBase64: string): Promise<void>;
  exists(filePath: string): boolean;
  /** Deletes the files of removed photos, whichever phone removed them. */
  deleteRemoved(db: Db): void;
}

// The server stamps rows when the statement runs, not at commit: a pull re-reads this window
// before its cursor so a slow commit isn't skipped. Landing a row twice changes nothing.
export const PULL_OVERLAP_MS = 60_000;
const PUSH_BATCH = 200;
const REMOVE_BATCH = 100;

export type SyncResult = { pulled: number; pushed: number; skipped: number };

export async function syncOnce(
  db: Db,
  remote: Remote,
  key: AESEncryptionKey,
  photos: LocalPhotos,
): Promise<SyncResult> {
  const cursor = readSyncPref(db, 'pullCursor');
  const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;

  const sealed = await remote.pull(since);
  const opened = await Promise.all(sealed.map((s) => openRow(key, s)));
  const rows = opened.filter((r) => r !== null);
  const { applied, skipped } = applyRemote(db, rows);
  // A photo removed on another phone leaves this one right away too: receipts carry CPF.
  photos.deleteRemoved(db);

  let newest = cursor;
  for (const s of sealed)
    if (s.serverUpdatedAt && (!newest || Date.parse(s.serverUpdatedAt) > Date.parse(newest)))
      newest = s.serverUpdatedAt;
  if (newest && newest !== cursor) writeSyncPref(db, 'pullCursor', newest);

  // Read after landing: a row the server just replaced locally is no longer pending.
  const pending = await sendPhotos(db, remote, key, photos, pendingRows(db));
  for (let i = 0; i < pending.length; i += PUSH_BATCH) {
    const batch = pending.slice(i, i + PUSH_BATCH);
    await remote.push(await Promise.all(batch.map((r) => sealRow(key, r))));
    markSynced(db, batch);
  }

  const badPhotos = await fetchPhotos(db, remote, key, photos);

  writeSyncPref(db, 'lastSyncAt', new Date().toISOString());
  return {
    pulled: applied,
    pushed: pending.length,
    skipped: skipped + (sealed.length - rows.length) + badPhotos,
  };
}

/**
 * A photo row in the cloud promises its file is there too: the file goes up before the row,
 * and a removed photo leaves the cloud before the row saying so. Returns the rows ready to
 * push; a photo this phone can't read keeps its row here.
 */
async function sendPhotos(
  db: Db,
  remote: Remote,
  key: AESEncryptionKey,
  photos: LocalPhotos,
  pending: SyncRow[],
): Promise<SyncRow[]> {
  const removed = pending.filter((r) => r.table === 'attachments' && r.deletedAt).map((r) => r.id);
  for (let i = 0; i < removed.length; i += REMOVE_BATCH) {
    const batch = removed.slice(i, i + REMOVE_BATCH);
    await remote.removePhotos(batch);
    forgetPhotos(db, batch);
  }

  const ready: SyncRow[] = [];
  for (const r of pending) {
    if (r.table === 'attachments' && !r.deletedAt && !isPhotoUploaded(db, r.id)) {
      let jpeg: string;
      try {
        jpeg = await photos.read(String(r.row.filePath));
      } catch {
        continue;
      }
      await remote.uploadPhoto(r.id, await sealPhoto(key, r.id, jpeg));
      markPhotoUploaded(db, r.id);
    }
    ready.push(r);
  }
  return ready;
}

/**
 * Brings photos this phone doesn't have yet, sealed again with this phone's key under the
 * name their row got here. One the cloud doesn't have yet waits for the next sync. Returns
 * how many couldn't be opened.
 */
async function fetchPhotos(
  db: Db,
  remote: Remote,
  key: AESEncryptionKey,
  photos: LocalPhotos,
): Promise<number> {
  let bad = 0;
  for (const p of livePhotos(db)) {
    if (photos.exists(p.filePath)) continue;
    const sealed = await remote.downloadPhoto(p.id);
    if (!sealed) continue;
    const jpeg = await openPhoto(key, p.id, sealed);
    if (jpeg === null) {
      bad++;
      continue;
    }
    await photos.write(p.filePath, jpeg);
    markPhotoUploaded(db, p.id);
  }
  // The person may have removed one of them while it downloaded.
  photos.deleteRemoved(db);
  return bad;
}

/**
 * Runs sync one at a time. A request while a run is in flight queues exactly one more run, so
 * an edit made mid-sync still uploads; `soon` waits for a pause in edits first.
 */
export function createSyncRunner(run: () => Promise<void>, debounceMs: number) {
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const now = async (): Promise<void> => {
    clearTimeout(timer);
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await run();
      } while (again);
    } finally {
      running = false;
    }
  };

  return {
    now,
    soon() {
      clearTimeout(timer);
      timer = setTimeout(now, debounceMs);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}
