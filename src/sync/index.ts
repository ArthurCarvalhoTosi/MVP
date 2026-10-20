// Cloud sync (v1): pull what changed on the server, land it locally, push what changed here.
// Every row is sealed with the user's data key before it leaves the phone. See the "Plano da
// v1" in section 12 of decisoes_projeto_manutencao_veicular.md.
import type { AESEncryptionKey } from 'expo-crypto';
import type { Db } from '@/db/client';
import { applyRemote, markSynced, pendingRows, readSyncPref, writeSyncPref } from '@/db/sync';
import { openRow, sealRow, type SealedRow } from './rows';

export { importDataKey } from './rows';
export type { SealedRow } from './rows';

export interface Remote {
  /** Every row the server changed after `since` (server clock), or all rows when null. */
  pull(since: string | null): Promise<(Omit<SealedRow, 'table'> & { table: string })[]>;
  /** Upserts rows; the server keeps the newer copy of each. */
  push(rows: SealedRow[]): Promise<void>;
}

// The server stamps rows when the statement runs, not at commit: a pull re-reads this window
// before its cursor so a slow commit isn't skipped. Landing a row twice changes nothing.
export const PULL_OVERLAP_MS = 60_000;
const PUSH_BATCH = 200;

export type SyncResult = { pulled: number; pushed: number; skipped: number };

export async function syncOnce(db: Db, remote: Remote, key: AESEncryptionKey): Promise<SyncResult> {
  const cursor = readSyncPref(db, 'pullCursor');
  const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;

  const sealed = await remote.pull(since);
  const opened = await Promise.all(sealed.map((s) => openRow(key, s)));
  const rows = opened.filter((r) => r !== null);
  const { applied, skipped } = applyRemote(db, rows);

  let newest = cursor;
  for (const s of sealed)
    if (s.serverUpdatedAt && (!newest || Date.parse(s.serverUpdatedAt) > Date.parse(newest)))
      newest = s.serverUpdatedAt;
  if (newest && newest !== cursor) writeSyncPref(db, 'pullCursor', newest);

  // Read after landing: a row the server just replaced locally is no longer pending.
  const pending = pendingRows(db);
  for (let i = 0; i < pending.length; i += PUSH_BATCH) {
    const batch = pending.slice(i, i + PUSH_BATCH);
    await remote.push(await Promise.all(batch.map((r) => sealRow(key, r))));
    markSynced(db, batch);
  }

  writeSyncPref(db, 'lastSyncAt', new Date().toISOString());
  return {
    pulled: applied,
    pushed: pending.length,
    skipped: skipped + (sealed.length - rows.length),
  };
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
