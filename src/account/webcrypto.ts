import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';

type Target = {
  crypto?: { getRandomValues?: Crypto['getRandomValues']; subtle?: SubtleCrypto };
};

/**
 * Hermes has no WebCrypto. Without it supabase-js makes the sign-in PKCE verifier with
 * Math.random and sends it unhashed ("plain"). This fills in only what it uses, the native
 * random source and SHA-256 from expo-crypto, so the sign-in gets the real S256 flow.
 * Anything already there (a future Hermes, Node in tests) is left alone.
 */
export function installWebCrypto(target: Target = globalThis as Target) {
  target.crypto ??= {};
  target.crypto.getRandomValues ??= getRandomValues as Crypto['getRandomValues'];
  target.crypto.subtle ??= {
    digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
      if (name !== 'SHA-256') throw new Error(`digest ${name} is not available`);
      return digest(CryptoDigestAlgorithm.SHA256, data);
    },
  } as SubtleCrypto;
}
