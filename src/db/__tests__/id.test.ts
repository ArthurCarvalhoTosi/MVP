import { uuidv7 } from '../id';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

const FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => jest.restoreAllMocks());

test('has UUIDv7 format, version 7 and variant 10xx', () => {
  for (let i = 0; i < 100; i++) expect(uuidv7()).toMatch(FORMAT);
});

test('encodes the ms timestamp in the first 48 bits', () => {
  const ms = 0x0192_3456_789a;
  jest.spyOn(Date, 'now').mockReturnValue(ms);
  expect(uuidv7().replace(/-/g, '').slice(0, 12)).toBe(ms.toString(16).padStart(12, '0'));
});

test('sorts by creation time across milliseconds', () => {
  const now = jest.spyOn(Date, 'now');
  const ids = [1_700_000_000_000, 1_700_000_000_001, 1_700_000_065_536, 1_800_000_000_000].map((ms) => {
    now.mockReturnValue(ms);
    return uuidv7();
  });
  expect([...ids].sort()).toEqual(ids);
});
