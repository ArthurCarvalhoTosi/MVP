// Receipt photos as the cloud keeps them: the JPEG sealed with the user's data key (AES-256-GCM),
// the attachment id as associated data so the server can't swap one photo for another.
// Layout: one format byte, then nonce + ciphertext + tag.
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';

const FORMAT = 1;
const NONCE_AND_TAG = 12 + 16;

const aad = (attachmentId: string) =>
  Uint8Array.from(`garagem/photo/v1:${attachmentId}`, (ch) => ch.charCodeAt(0));

export async function sealPhoto(
  key: AESEncryptionKey,
  attachmentId: string,
  jpegBase64: string,
): Promise<Uint8Array> {
  const sealed = await aesEncryptAsync(jpegBase64, key, { additionalData: aad(attachmentId) });
  const body = await sealed.combined();
  const out = new Uint8Array(1 + body.length);
  out[0] = FORMAT;
  out.set(body, 1);
  return out;
}

/** The JPEG as base64, or null when the file can't be trusted (wrong key, tampered, another photo). */
export async function openPhoto(
  key: AESEncryptionKey,
  attachmentId: string,
  bytes: Uint8Array,
): Promise<string | null> {
  if (bytes[0] !== FORMAT || bytes.length <= 1 + NONCE_AND_TAG) return null;
  try {
    return await aesDecryptAsync(AESSealedData.fromCombined(bytes.subarray(1)), key, {
      additionalData: aad(attachmentId),
      output: 'base64',
    });
  } catch {
    return null;
  }
}
