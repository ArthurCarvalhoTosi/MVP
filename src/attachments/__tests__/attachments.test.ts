import { isNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import {
  createVehicle,
  itemsQuery,
  logsQuery,
  OdometerError,
  registerMaintenance,
  removeMaintenance,
  type NewAttachment,
} from '@/db/repo';
import { attachments } from '@/db/schema';
import { createTestDb } from '@/db/test-utils/testDb';

// Native pieces replaced by in-memory stand-ins. AES-GCM runs for real on node's crypto, so a
// round trip proves the bytes on disk are ciphertext that only the stored key opens.
const mockFiles = new Map<string, Uint8Array>();
const mockStore = new Map<string, string>();
const mockManipulate = jest.fn();
const mockSave = jest.fn();

jest.mock('expo-file-system', () => {
  const join = (parts: (string | { uri: string })[]) =>
    parts.map((p) => (typeof p === 'string' ? p : p.uri).replace(/\/$/, '')).join('/');
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    create() {}
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    delete() {
      if (!mockFiles.delete(this.uri)) throw new Error('missing');
    }
    async write(bytes: Uint8Array) {
      mockFiles.set(this.uri, bytes);
    }
    async bytes() {
      const b = mockFiles.get(this.uri);
      if (!b) throw new Error('missing');
      return b;
    }
  }
  return {
    Directory,
    File,
    Paths: { document: new Directory('file:///docs'), cache: new Directory('file:///cache') },
  };
});

jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  const B = require('buffer').Buffer; // no @types/node here
  class AESEncryptionKey {
    raw: Uint8Array;
    constructor(raw: Uint8Array) {
      this.raw = raw;
    }
    static async generate(size: number) {
      return new AESEncryptionKey(nodeCrypto.randomBytes(size / 8));
    }
    static async import(hex: string) {
      return new AESEncryptionKey(B.from(hex, 'hex'));
    }
    async encoded() {
      return B.from(this.raw).toString('hex');
    }
  }
  class AESSealedData {
    bytes: Uint8Array;
    constructor(bytes: Uint8Array) {
      this.bytes = bytes;
    }
    static fromCombined(bytes: Uint8Array) {
      return new AESSealedData(bytes);
    }
    async combined() {
      return this.bytes;
    }
  }
  return {
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    AESKeySize: { AES256: 256 },
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync: async (base64: string, key: AESEncryptionKey) => {
      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key.raw, iv);
      const ct = B.concat([cipher.update(B.from(base64, 'base64')), cipher.final()]);
      return new AESSealedData(new Uint8Array(B.concat([iv, ct, cipher.getAuthTag()])));
    },
    aesDecryptAsync: async (sealed: AESSealedData, key: AESEncryptionKey) => {
      const b = B.from(sealed.bytes);
      const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key.raw, b.subarray(0, 12));
      decipher.setAuthTag(b.subarray(b.length - 16));
      return B.concat([decipher.update(b.subarray(12, b.length - 16)), decipher.final()]).toString(
        'base64',
      );
    },
  };
});

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (...args: unknown[]) => {
      mockManipulate(...args);
      return { renderAsync: async () => ({ saveAsync: mockSave }) };
    },
  },
}));

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
}));

const NodeBuffer = require('buffer').Buffer;
const JPEG = NodeBuffer.from('a receipt, as JPEG bytes').toString('base64');
const PICKED = 'file:///cache/ImagePicker/picked.jpeg';
const MANIPULATED = 'file:///cache/ImageManipulator/out.jpg';

let attachmentsModule: typeof import('@/attachments');
let SecureStore: typeof import('expo-secure-store');

beforeEach(() => {
  mockFiles.clear();
  mockStore.clear();
  jest.clearAllMocks();
  // Fresh module per test: the key is cached per process.
  jest.isolateModules(() => {
    attachmentsModule = require('@/attachments');
    SecureStore = require('expo-secure-store');
  });
  mockFiles.set(PICKED, new Uint8Array([1, 2, 3]));
  mockSave.mockImplementation(async () => {
    mockFiles.set(MANIPULATED, new Uint8Array([4, 5, 6]));
    return { uri: MANIPULATED, width: 1200, height: 1600, base64: JPEG };
  });
});

const encryptedFiles = () =>
  [...mockFiles.keys()].filter((k) => k.startsWith('file:///docs/attachments/'));

describe('preparePhoto', () => {
  test('shrinks to 1600 px, re-encodes as JPEG and leaves no plain file behind', async () => {
    await expect(attachmentsModule.preparePhoto(PICKED)).resolves.toBe(JPEG);

    expect(mockManipulate).toHaveBeenCalledWith(PICKED, { maxWidth: 1600, maxHeight: 1600 });
    expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.7, base64: true });
    expect([...mockFiles.keys()]).toEqual([]);
  });

  test('still deletes the plain files when processing fails', async () => {
    mockSave.mockImplementationOnce(async () => {
      mockFiles.set(MANIPULATED, new Uint8Array([4]));
      return { uri: MANIPULATED, width: 1, height: 1 }; // no base64
    });
    await expect(attachmentsModule.preparePhoto(PICKED)).rejects.toThrow();
    expect([...mockFiles.keys()]).toEqual([]);

    mockFiles.set(PICKED, new Uint8Array([1]));
    mockSave.mockRejectedValueOnce(new Error('decode failed'));
    await expect(attachmentsModule.preparePhoto(PICKED)).rejects.toThrow('decode failed');
    expect([...mockFiles.keys()]).toEqual([]);
  });
});

describe('writePhoto and readPhoto', () => {
  test('store ciphertext in the documents folder that only reads back with the stored key', async () => {
    const saved = await attachmentsModule.writePhoto(JPEG);

    expect(saved).toEqual({
      filePath: expect.stringMatching(/^attachments\/[0-9a-f-]{36}\.bin$/),
      mime: 'image/jpeg',
      sizeBytes: expect.any(Number),
    });
    const onDisk = mockFiles.get(`file:///docs/${saved.filePath}`)!;
    expect(saved.sizeBytes).toBe(onDisk.length);
    expect(NodeBuffer.from(onDisk).includes(NodeBuffer.from(JPEG, 'base64'))).toBe(false);
    await expect(attachmentsModule.readPhoto(saved.filePath)).resolves.toBe(JPEG);
  });

  test('create the key once, device-only and apart from the database key', async () => {
    await attachmentsModule.writePhoto(JPEG);
    await attachmentsModule.writePhoto(JPEG);

    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'garagem.attachments.key',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      {
        keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
      },
    );
  });

  test('refuse a file changed on disk', async () => {
    const saved = await attachmentsModule.writePhoto(JPEG);
    const onDisk = mockFiles.get(`file:///docs/${saved.filePath}`)!;
    onDisk[20] ^= 1;

    await expect(attachmentsModule.readPhoto(saved.filePath)).rejects.toThrow();
  });
});

describe('localPhotos', () => {
  test('writes a photo from the cloud at the name its row got, sealed with this phone key', async () => {
    const { localPhotos } = attachmentsModule;
    const filePath = 'attachments/0190a1b2-0000-7000-8000-000000000001.bin';
    expect(localPhotos.exists(filePath)).toBe(false);

    await localPhotos.write(filePath, JPEG);

    expect(localPhotos.exists(filePath)).toBe(true);
    const onDisk = mockFiles.get(`file:///docs/${filePath}`)!;
    expect(NodeBuffer.from(onDisk).includes(NodeBuffer.from(JPEG, 'base64'))).toBe(false);
    await expect(localPhotos.read(filePath)).resolves.toBe(JPEG);
  });
});

describe('saveWithPhoto', () => {
  test('writes the file first and hands it to the save', async () => {
    const save = jest.fn(async (a: NewAttachment | null | undefined) => {
      expect(encryptedFiles()).toEqual([`file:///docs/${a!.filePath}`]);
    });
    await attachmentsModule.saveWithPhoto(JPEG, save);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ mime: 'image/jpeg' }));
    expect(encryptedFiles()).toHaveLength(1);
  });

  test('passes keep (undefined) and remove (null) through without writing', async () => {
    const save = jest.fn(async () => {});
    await attachmentsModule.saveWithPhoto(undefined, save);
    await attachmentsModule.saveWithPhoto(null, save);
    expect(save.mock.calls).toEqual([[undefined], [null]]);
    expect(encryptedFiles()).toEqual([]);
  });

  describe('with the real database', () => {
    let db: Db;
    let vehicleId: string;
    let oilId: string;
    beforeEach(async () => {
      db = await createTestDb();
      vehicleId = await createVehicle(
        db,
        {
          nickname: 'Carro',
          odometerKm: 50000,
          monthlyKmEstimate: 1000,
          severeUse: false,
          items: [{ templateKey: 'oil', name: 'Óleo', intervalKm: 10000, intervalMonths: 12 }],
        },
        '2026-10-01',
      );
      oilId = itemsQuery(db, vehicleId).all()[0].id;
    });

    test('records the photo with the log', async () => {
      await attachmentsModule.saveWithPhoto(JPEG, (attachment) =>
        registerMaintenance(db, {
          vehicleId,
          itemId: oilId,
          performedAt: '2026-11-01',
          km: 51000,
          attachment,
        }),
      );
      const [log] = logsQuery(db, vehicleId).all();
      expect(log.photo).toEqual(expect.stringMatching(/^attachments\//));
      await expect(attachmentsModule.readPhoto(log.photo!)).resolves.toBe(JPEG);
    });

    test('deletes the new file when the database refuses the log', async () => {
      const failed = attachmentsModule.saveWithPhoto(JPEG, (attachment) =>
        registerMaintenance(db, {
          vehicleId,
          itemId: oilId,
          performedAt: '2026-11-01',
          km: 40000,
          attachment,
        }),
      );
      await expect(failed).rejects.toBeInstanceOf(OdometerError);
      expect(encryptedFiles()).toEqual([]);
      expect(db.select().from(attachments).all()).toEqual([]);
    });

    test('deleteRemovedPhotos deletes only the files of removed photos, and never throws', async () => {
      for (const [performedAt, km] of [
        ['2026-11-01', 51000],
        ['2026-12-01', 52000],
      ] as const) {
        await attachmentsModule.saveWithPhoto(JPEG, (attachment) =>
          registerMaintenance(db, { vehicleId, itemId: oilId, performedAt, km, attachment }),
        );
      }
      const [newer, older] = logsQuery(db, vehicleId).all();
      await removeMaintenance(db, newer.id);

      attachmentsModule.deleteRemovedPhotos(db);
      expect(encryptedFiles()).toEqual([`file:///docs/${older.photo}`]);
      // Already gone: nothing to do, no error.
      expect(() => attachmentsModule.deleteRemovedPhotos(db)).not.toThrow();
      expect(db.select().from(attachments).where(isNull(attachments.deletedAt)).all()).toHaveLength(
        1,
      );
    });
  });
});
