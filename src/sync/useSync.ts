import { addDatabaseChangeListener } from 'expo-sqlite';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { cloud, dataKey } from '@/account';
import type { Db } from '@/db/client';
import { isSyncTable, readSyncPref } from '@/db/sync';
import { createSyncRunner, syncOnce } from '.';
import { supabaseRemote } from './remote';

export type SyncStatus = { state: 'idle' | 'syncing' | 'failed'; lastSyncAt: string | null };

// Wait for a pause in edits (a log saves several rows) before uploading.
const EDIT_PAUSE_MS = 3000;

let status: SyncStatus = { state: 'idle', lastSyncAt: null };
const listeners = new Set<() => void>();
let requestSync: (() => void) | undefined;

function setStatus(next: SyncStatus) {
  status = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, () => status);
}

/** "Sincronizar agora". */
export function syncNow() {
  requestSync?.();
}

/**
 * Keeps this phone and the cloud in step while signed in: on opening, on coming back to the
 * app, right after signing in, and shortly after local edits. Mount once, under the database.
 */
export function useSync(db: Db) {
  useEffect(() => {
    const sb = cloud(db);
    setStatus({ state: 'idle', lastSyncAt: readSyncPref(db, 'lastSyncAt') });

    const runner = createSyncRunner(async () => {
      const { data } = await sb.auth.getSession();
      if (!data.session) return;
      setStatus({ ...status, state: 'syncing' });
      try {
        await syncOnce(db, supabaseRemote(sb), await dataKey(db));
        setStatus({ state: 'idle', lastSyncAt: readSyncPref(db, 'lastSyncAt') });
      } catch (e) {
        // Offline is routine; the next trigger retries. Never the payload or the key in logs.
        console.warn('sync failed:', e instanceof Error ? e.message : 'unknown');
        setStatus({ ...status, state: 'failed' });
      }
    }, EDIT_PAUSE_MS);
    const run = () => void runner.now().catch(() => {});
    requestSync = run;

    // Supabase warns against awaiting its own calls inside this callback: defer the run.
    const auth = sb.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') setTimeout(run, 0);
      if (event === 'SIGNED_OUT') setStatus({ state: 'idle', lastSyncAt: null });
    });
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    // Landing remote rows fires this too; the follow-up run finds nothing new and stops there.
    const changes = addDatabaseChangeListener((e) => {
      if (isSyncTable(e.tableName)) runner.soon();
    });

    return () => {
      auth.data.subscription.unsubscribe();
      app.remove();
      changes.remove();
      runner.cancel();
      requestSync = undefined;
    };
  }, [db]);
}
