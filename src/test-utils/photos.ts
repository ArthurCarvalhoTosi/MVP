import type { Db } from '@/db/client';
import { removedAttachmentsQuery } from '@/db/repo';
import type { LocalPhotos } from '@/sync';

/** A phone's photo files, in memory, for sync tests. The real files and their key: src/attachments. */
export function memoryPhotos(): LocalPhotos & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(filePath) {
      const jpeg = files.get(filePath);
      if (jpeg === undefined) throw new Error('missing');
      return jpeg;
    },
    async write(filePath, jpeg) {
      files.set(filePath, jpeg);
    },
    exists: (filePath) => files.has(filePath),
    deleteRemoved(db: Db) {
      for (const { filePath } of removedAttachmentsQuery(db).all()) files.delete(filePath);
    },
  };
}
