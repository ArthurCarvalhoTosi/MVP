import { redirectSystemPath } from '@/app/+native-intent';

test.each([
  'garagem:///auth-callback?code=1e0b4843-1214',
  'garagem://auth-callback?code=abc',
  '/auth-callback?code=abc',
  'auth-callback?error=access_denied',
])('the sign-in redirect %s opens the account sheet, not an unknown screen', (path) => {
  expect(redirectSystemPath({ path, initial: false })).toBe('/account');
  // Cold start: the sign-in that asked for it is gone, so just open the app.
  expect(redirectSystemPath({ path, initial: true })).toBe('/');
});

test.each(['/', '/history', 'garagem:///checkup', '/auth-callbacks', '/x/auth-callback'])(
  'other links pass through: %s',
  (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
  },
);
