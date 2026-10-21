import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';
import { installWebCrypto } from '../webcrypto';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(async () => new ArrayBuffer(32)),
  getRandomValues: jest.fn((a: Uint32Array) => a.fill(7)),
}));

test('fills in a missing crypto with the native random source and SHA-256', async () => {
  const target: Parameters<typeof installWebCrypto>[0] = {};
  installWebCrypto(target);

  const values = target.crypto!.getRandomValues!(new Uint32Array(2));
  expect(getRandomValues).toHaveBeenCalled();
  expect(values).toEqual(Uint32Array.of(7, 7));

  const data = new Uint8Array([1, 2, 3]);
  await target.crypto!.subtle!.digest('SHA-256', data);
  await target.crypto!.subtle!.digest({ name: 'SHA-256' }, data);
  expect(digest).toHaveBeenCalledWith(CryptoDigestAlgorithm.SHA256, data);
  await expect(target.crypto!.subtle!.digest('SHA-1', data)).rejects.toThrow('SHA-1');
});

test('leaves a crypto that already exists alone', () => {
  const own = { getRandomValues: jest.fn(), subtle: {} as SubtleCrypto };
  const target = { crypto: own as never };
  installWebCrypto(target);
  expect(target.crypto).toBe(own);
  expect((target.crypto as typeof own).getRandomValues).toBe(own.getRandomValues);
  expect((target.crypto as typeof own).subtle).toBe(own.subtle);
});
