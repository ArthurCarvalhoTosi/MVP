// Receipt photos: re-encoded without metadata, then kept only as AES-256-GCM files in the app's
// documents folder. The plain JPEG lives in memory (base64) and never stays on disk.
import { AESEncryptionKey, AESKeySize, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as SecureStore from 'expo-secure-store';
import type { Db } from '@/db/client';
import { uuidv7 } from '@/db/id';
import { removedAttachmentsQuery, type NewAttachment } from '@/db/repo';

const KEY_NAME = 'garagem.attachments.key';
const DIR = 'attachments';
// Enough to read a receipt; keeps each file in the hundreds of KB.
const MAX_SIDE = 1600;
const QUALITY = 0.7;

/**
 * Shrinks and re-encodes a picked photo as JPEG, which drops EXIF and GPS, and returns it as base64.
 * Deletes the picker's copy and the manipulator's output either way: both are plain files in the cache.
 */
export async function preparePhoto(pickedUri: string): Promise<string> {
  let savedUri: string | undefined;
  try {
    const image = await ImageManipulator.manipulate(pickedUri, { maxWidth: MAX_SIDE, maxHeight: MAX_SIDE }).renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY, base64: true });
    savedUri = saved.uri;
    if (!saved.base64) throw new Error('Photo came back without data');
    return saved.base64;
  } finally {
    // The picker always hands over its own copy in the app cache (Android and iOS), never the gallery original.
    discard(new File(pickedUri));
    if (savedUri) discard(new File(savedUri));
  }
}

/** Encrypts a JPEG (base64) into a new file; the result goes into the attachments row. */
export async function writePhoto(base64: string): Promise<NewAttachment> {
  const sealed = await aesEncryptAsync(base64, await key());
  const bytes = await sealed.combined();
  const dir = new Directory(Paths.document, DIR);
  dir.create({ idempotent: true });
  const name = `${uuidv7()}.bin`;
  await new File(dir, name).write(bytes);
  // Relative: the app's folder path changes across iOS updates.
  return { filePath: `${DIR}/${name}`, mime: 'image/jpeg', sizeBytes: bytes.length };
}

/** The decrypted JPEG as base64, for memory only (e.g. a data URI with caching off). */
export async function readPhoto(filePath: string): Promise<string> {
  const bytes = await new File(Paths.document, filePath).bytes();
  return aesDecryptAsync(AESSealedData.fromCombined(bytes), await key(), { output: 'base64' });
}

/**
 * Writes the encrypted file before the database write that records it, and deletes it again if that
 * write fails. `photo` undefined or null passes straight through (keep or remove the current one).
 */
export async function saveWithPhoto(
  photo: string | null | undefined,
  save: (attachment: NewAttachment | null | undefined) => Promise<void>,
): Promise<void> {
  const attachment = photo == null ? photo : await writePhoto(photo);
  try {
    await save(attachment);
  } catch (e) {
    if (attachment) discard(new File(Paths.document, attachment.filePath));
    throw e;
  }
}

/**
 * Deletes the files of removed photos right away: there is no undo, and receipts carry CPF and
 * address. The soft-deleted rows stay for sync. Never throws: the removal itself already succeeded,
 * and a file left behind is retried on the next call.
 */
export function deleteRemovedPhotos(db: Db): void {
  try {
    for (const { filePath } of removedAttachmentsQuery(db).all()) discard(new File(Paths.document, filePath));
  } catch {
    // Best effort, see above.
  }
}

function discard(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // Nothing more to do: the caller's outcome must not depend on cleanup.
  }
}

// Once per process, like the database open: two first saves at once could each make a different key.
let keyPromise: Promise<AESEncryptionKey> | undefined;

function key(): Promise<AESEncryptionKey> {
  return (keyPromise ??= loadOrCreateKey().catch((e: unknown) => {
    keyPromise = undefined;
    throw e;
  }));
}

// Separate from the database key, and device-only like it.
async function loadOrCreateKey(): Promise<AESEncryptionKey> {
  const stored = await SecureStore.getItemAsync(KEY_NAME);
  if (stored) return AESEncryptionKey.import(stored, 'hex');
  const created = await AESEncryptionKey.generate(AESKeySize.AES256);
  await SecureStore.setItemAsync(KEY_NAME, await created.encoded('hex'), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return created;
}
