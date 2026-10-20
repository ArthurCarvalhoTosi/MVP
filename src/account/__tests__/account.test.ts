import * as WebBrowser from 'expo-web-browser';
import type { Db } from '@/db/client';
import { readAuthItem } from '@/db/repo';
import { createTestDb } from '@/db/test-utils/testDb';
import { ValidationError } from '@/domain';
import { AUTH_REDIRECT, cloud, codeFromRedirect, isDataKey, signInWithGoogle, signOut } from '..';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

// A stand-in Supabase client: each test sets what the server answers.
const mockAuth = {
  signInWithOAuth: jest.fn(),
  exchangeCodeForSession: jest.fn(),
  signOut: jest.fn(async () => ({ error: null })),
};
const mockFunctions = { invoke: jest.fn() };
const mockCreateClient = jest.fn((..._args: unknown[]) => ({
  auth: mockAuth,
  functions: mockFunctions,
}));
jest.mock('@supabase/supabase-js', () => ({
  processLock: 'processLock',
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const NodeBuffer = require('buffer').Buffer;
const DEK = NodeBuffer.alloc(32, 7).toString('base64');
const openAuth = WebBrowser.openAuthSessionAsync as jest.Mock;
let db: Db;

beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
  db = await createTestDb();
  mockAuth.signInWithOAuth.mockResolvedValue({
    data: { url: 'https://example.supabase.co/auth/v1/authorize?provider=google' },
    error: null,
  });
  openAuth.mockResolvedValue({ type: 'success', url: `${AUTH_REDIRECT}?code=abc` });
  mockAuth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  mockFunctions.invoke.mockResolvedValue({ data: { dek: DEK }, error: null });
});

describe('codeFromRedirect', () => {
  test('reads the PKCE code', () => {
    expect(codeFromRedirect('garagem://auth-callback?code=abc-123')).toBe('abc-123');
    expect(codeFromRedirect('garagem://auth-callback#code=x&state=y')).toBe('x');
  });

  test('a person backing out on Google is not an error', () => {
    expect(
      codeFromRedirect('garagem://auth-callback?error=access_denied&error_description=no'),
    ).toBeNull();
  });

  test('any other error or a missing code fails with a plain message', () => {
    expect(() => codeFromRedirect('garagem://auth-callback?error=server_error')).toThrow(
      ValidationError,
    );
    expect(() => codeFromRedirect('garagem://auth-callback')).toThrow(
      'Não foi possível entrar. Confira a internet e tente de novo.',
    );
  });
});

test('isDataKey accepts only base64 of 32 bytes', () => {
  expect(isDataKey(DEK)).toBe(true);
  expect(isDataKey(NodeBuffer.alloc(31).toString('base64'))).toBe(false);
  expect(isDataKey(NodeBuffer.alloc(33).toString('base64'))).toBe(false);
  expect(isDataKey(DEK.replace('B', '-'))).toBe(false);
  expect(isDataKey(undefined)).toBe(false);
  expect(isDataKey(42)).toBe(false);
});

describe('cloud', () => {
  test('keeps the session in the encrypted database, with PKCE and no URL sniffing', async () => {
    cloud(db);
    const [, , options] = mockCreateClient.mock.calls[0] as [string, string, any];
    expect(options.auth).toMatchObject({
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
    });

    await options.auth.storage.setItem('sb-session', 'S');
    expect(readAuthItem(db, 'sb-session')).toBe('S');
    expect(await options.auth.storage.getItem('sb-session')).toBe('S');
    await options.auth.storage.removeItem('sb-session');
    expect(readAuthItem(db, 'sb-session')).toBeNull();
  });

  test('one client per database handle', async () => {
    const first = cloud(db);
    expect(cloud(db)).toBe(first);
    const reopened = await createTestDb();
    cloud(reopened);
    expect(mockCreateClient).toHaveBeenCalledTimes(2);
  });
});

describe('signInWithGoogle', () => {
  test('opens Google in the browser, keeps the session and stores the data key', async () => {
    await expect(signInWithGoogle(db)).resolves.toBe('signed-in');

    expect(mockAuth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
    });
    expect(openAuth).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/authorize?provider=google',
      AUTH_REDIRECT,
    );
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(mockFunctions.invoke).toHaveBeenCalledWith('user-key', { method: 'POST' });
    expect(mockStore.get('garagem.cloud.dek')).toBe(DEK);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  test.each([
    ['closes the browser', { type: 'cancel' }],
    ['backs out on Google', { type: 'success', url: `${AUTH_REDIRECT}?error=access_denied` }],
  ])('nothing changes when the person %s', async (_case, result) => {
    openAuth.mockResolvedValue(result);
    await expect(signInWithGoogle(db)).resolves.toBe('cancelled');
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockStore.size).toBe(0);
  });

  test('fails plainly when Supabase cannot start or finish the sign-in', async () => {
    mockAuth.signInWithOAuth.mockResolvedValueOnce({ data: { url: null }, error: new Error('x') });
    await expect(signInWithGoogle(db)).rejects.toThrow(ValidationError);
    expect(openAuth).not.toHaveBeenCalled();

    mockAuth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: new Error('pkce') });
    await expect(signInWithGoogle(db)).rejects.toThrow(ValidationError);
    expect(mockFunctions.invoke).not.toHaveBeenCalled();
  });

  test.each([
    ['the key function fails', { data: null, error: new Error('500') }],
    ['the key is malformed', { data: { dek: 'short' }, error: null }],
  ])('signs back out when %s', async (_case, answer) => {
    mockFunctions.invoke.mockResolvedValue(answer);
    await expect(signInWithGoogle(db)).rejects.toThrow(
      'Não foi possível entrar. Confira a internet e tente de novo.',
    );
    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mockStore.size).toBe(0);
  });

  test('signs back out when the network drops while fetching the key', async () => {
    mockFunctions.invoke.mockRejectedValue(new TypeError('Network request failed'));
    await expect(signInWithGoogle(db)).rejects.toThrow(ValidationError);
    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

test('signOut drops the data key and signs out only this device', async () => {
  mockStore.set('garagem.cloud.dek', DEK);
  await signOut(db);
  expect(mockStore.has('garagem.cloud.dek')).toBe(false);
  expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});
