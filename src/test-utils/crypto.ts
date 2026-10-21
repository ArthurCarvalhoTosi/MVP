// expo-crypto's AES-GCM API backed by Node's crypto, for tests: real encryption, so tampering and
// wrong keys fail like on the phone. Wire up with
//   jest.mock('expo-crypto', () => require('@/test-utils/crypto').expoCryptoMock());
export function expoCryptoMock() {
  const nodeCrypto = require('crypto');
  const B = require('buffer').Buffer; // no @types/node here

  class AESEncryptionKey {
    constructor(readonly raw: Uint8Array) {}
    static async generate() {
      return new AESEncryptionKey(nodeCrypto.randomBytes(32));
    }
    static async import(input: string | Uint8Array, encoding?: 'hex' | 'base64') {
      return new AESEncryptionKey(
        typeof input === 'string' ? B.from(input, encoding ?? 'hex') : B.from(input),
      );
    }
  }

  class AESSealedData {
    constructor(
      readonly ivBytes: Uint8Array,
      readonly ct: Uint8Array,
      readonly tagBytes: Uint8Array,
    ) {}
    static fromParts(iv: Uint8Array, ciphertextWithTag: Uint8Array) {
      const all = B.from(ciphertextWithTag);
      return new AESSealedData(B.from(iv), all.subarray(0, -16), all.subarray(-16));
    }
    static fromCombined(bytes: Uint8Array) {
      const all = B.from(bytes);
      return new AESSealedData(all.subarray(0, 12), all.subarray(12, -16), all.subarray(-16));
    }
    async iv() {
      return new Uint8Array(this.ivBytes);
    }
    async ciphertext(options?: { includeTag?: boolean }) {
      return new Uint8Array(options?.includeTag ? B.concat([this.ct, this.tagBytes]) : this.ct);
    }
    async combined() {
      return new Uint8Array(B.concat([this.ivBytes, this.ct, this.tagBytes]));
    }
  }

  const bytes = (input: string | Uint8Array) =>
    typeof input === 'string' ? B.from(input, 'base64') : B.from(input);

  return {
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    AESKeySize: { AES256: 256 },
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync: async (
      plaintext: string | Uint8Array,
      key: AESEncryptionKey,
      options?: { additionalData?: Uint8Array },
    ) => {
      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key.raw, iv);
      if (options?.additionalData) cipher.setAAD(B.from(options.additionalData));
      const ct = B.concat([cipher.update(bytes(plaintext)), cipher.final()]);
      return new AESSealedData(iv, ct, cipher.getAuthTag());
    },
    aesDecryptAsync: async (
      sealed: AESSealedData,
      key: AESEncryptionKey,
      options?: { additionalData?: Uint8Array; output?: 'bytes' | 'base64' },
    ) => {
      const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key.raw, sealed.ivBytes);
      if (options?.additionalData) decipher.setAAD(B.from(options.additionalData));
      decipher.setAuthTag(sealed.tagBytes);
      const plain = B.concat([decipher.update(sealed.ct), decipher.final()]);
      return options?.output === 'base64' ? plain.toString('base64') : new Uint8Array(plain);
    },
  };
}
