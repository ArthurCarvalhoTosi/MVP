// Optional account (v1): Google sign-in through Supabase and the user's cloud data key (DEK).
// See section 8.3 of decisoes_projeto_manutencao_veicular.md.
//
// Sign-in runs in the browser with PKCE rather than the native Google sheet: the free native
// library still relies on Google's deprecated Android sign-in API. Only this app holds the
// PKCE verifier, so another app catching the garagem:// redirect can't finish the sign-in.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { AESEncryptionKey } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { Db } from '@/db/client';
import { readAuthItem, removeAuthItem, writeAuthItem } from '@/db/repo';
import { clearSyncState } from '@/db/sync';
import { ValidationError } from '@/domain';
import { importDataKey } from '@/sync/rows';
import { installWebCrypto } from './webcrypto';

// garagem-dev. Both are public by design: access is enforced by RLS and the Edge Functions.
// shortcut: hard-coded to the dev project; read them from the build environment when
// garagem-prod exists (slice 7).
const SUPABASE_URL = 'https://bphuqkvehtmmktuyuxyc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_vyR8YgOt___xjRtA-KvwQQ_3ShEzdlw';

export const AUTH_REDIRECT = 'garagem://auth-callback';
// resetDatabase (src/db/client.ts) deletes this same name.
const DEK_NAME = 'garagem.cloud.dek';

const SIGN_IN_FAILED = 'Não foi possível entrar. Confira a internet e tente de novo.';

// Before any client exists: the PKCE verifier and challenge come from it.
installWebCrypto();

let current: { db: Db; client: SupabaseClient } | undefined;

/** The Supabase client, with its session kept in this device's encrypted database. */
export function cloud(db: Db): SupabaseClient {
  // A reset reopens the database: a client bound to the old handle would write nowhere.
  if (current?.db !== db) {
    current = {
      db,
      client: createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          storage: {
            getItem: async (key) => readAuthItem(db, key),
            setItem: async (key, value) => writeAuthItem(db, key, value),
            removeItem: async (key) => removeAuthItem(db, key),
          },
          flowType: 'pkce',
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      }),
    };
  }
  return current.client;
}

/**
 * Reads the redirect the browser hands back. Returns the PKCE code, or null when the person
 * backed out on Google's page. Any other error from Google or Supabase throws.
 */
export function codeFromRedirect(url: string): string | null {
  const params = new URLSearchParams(url.split(/[?#]/).slice(1).join('&'));
  const error = params.get('error');
  if (error === 'access_denied') return null;
  if (error) throw new ValidationError(SIGN_IN_FAILED);
  const code = params.get('code');
  if (!code) throw new ValidationError(SIGN_IN_FAILED);
  return code;
}

/** A DEK as the user-key function sends it: base64 of exactly 32 bytes. */
export function isDataKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value);
}

export type SignInResult = 'signed-in' | 'cancelled';

/** Opens Google in the browser, then stores the session and this user's data key. */
export async function signInWithGoogle(db: Db): Promise<SignInResult> {
  const sb = cloud(db);
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new ValidationError(SIGN_IN_FAILED);

  const result = await WebBrowser.openAuthSessionAsync(data.url, AUTH_REDIRECT);
  if (result.type !== 'success') return 'cancelled';
  const code = codeFromRedirect(result.url);
  if (!code) return 'cancelled';

  const exchanged = await sb.auth.exchangeCodeForSession(code);
  if (exchanged.error) throw new ValidationError(SIGN_IN_FAILED);

  try {
    await fetchDataKey(sb);
  } catch (e) {
    // Signed in without a key would upload nothing and look broken: start over instead.
    await sb.auth.signOut({ scope: 'local' });
    throw e instanceof ValidationError ? e : new ValidationError(SIGN_IN_FAILED);
  }
  return 'signed-in';
}

async function fetchDataKey(sb: SupabaseClient): Promise<string> {
  const key = await sb.functions.invoke<{ dek?: unknown }>('user-key', { method: 'POST' });
  if (key.error || !isDataKey(key.data?.dek)) throw new ValidationError(SIGN_IN_FAILED);
  await SecureStore.setItemAsync(DEK_NAME, key.data.dek, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return key.data.dek;
}

/** The signed-in user's data key, fetched again if this phone lost it. */
export async function dataKey(db: Db): Promise<AESEncryptionKey> {
  const stored = await SecureStore.getItemAsync(DEK_NAME);
  return importDataKey(stored ?? (await fetchDataKey(cloud(db))));
}

/**
 * Signs this device out. Data on the phone stays; the data key and the sync bookkeeping leave
 * with the session, so another account signing in here starts from scratch.
 */
export async function signOut(db: Db): Promise<void> {
  await SecureStore.deleteItemAsync(DEK_NAME);
  clearSyncState(db);
  // Local scope: other phones signed in to the same account stay signed in.
  await cloud(db).auth.signOut({ scope: 'local' });
}

export type Account =
  { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; email: string };

const fromSession = (session: Session | null): Account =>
  session ? { status: 'signed-in', email: session.user.email ?? '' } : { status: 'signed-out' };

export function useAccount(db: Db): Account {
  const [account, setAccount] = useState<Account>({ status: 'loading' });
  useEffect(() => {
    // Fires INITIAL_SESSION right away with whatever is stored.
    const { data } = cloud(db).auth.onAuthStateChange((_event, session) =>
      setAccount(fromSession(session)),
    );
    return () => data.subscription.unsubscribe();
  }, [db]);
  return account;
}

/** Refreshes the session only while the app is on screen, as Supabase advises for React Native. */
export function useSessionRefresh(db: Db) {
  useEffect(() => {
    const auth = cloud(db).auth;
    const apply = (state: string | null | undefined) =>
      state === 'active' ? auth.startAutoRefresh() : auth.stopAutoRefresh();
    apply(AppState.currentState);
    const sub = AppState.addEventListener('change', apply);
    return () => {
      sub.remove();
      auth.stopAutoRefresh();
    };
  }, [db]);
}
