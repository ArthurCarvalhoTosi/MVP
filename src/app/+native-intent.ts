// Rewrites links the system hands to expo-router before it picks a screen.
//
// garagem://auth-callback?code=… is the sign-in redirect: openAuthSessionAsync (src/account)
// reads it and finishes the sign-in. expo-router sees the same link and would open it as an
// unknown screen, so it shows the account sheet instead, which reflects the result. On a cold
// start nobody is waiting for the code (the app was closed mid sign-in): just open the app.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (/^(garagem:\/*)?\/?auth-callback\b/.test(path)) return initial ? '/' : '/account';
  return path;
}
