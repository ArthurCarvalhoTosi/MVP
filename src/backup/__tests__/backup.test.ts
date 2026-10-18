import {
  backupRows,
  createVehicle,
  registerMaintenance,
  removeMaintenance,
  selectedVehicleIdQuery,
  vehiclesQuery,
} from '@/db/repo';
import type { Db } from '@/db/client';
import { createTestDb } from '@/db/test-utils/testDb';
import { ValidationError } from '@/domain';

// Files and photos in memory. AES-GCM and Argon2id run for real, so a round trip proves the file
// only opens with the password and that its header is authenticated.
const mockFiles = new Map<string, Uint8Array>();
let mockPhotoCount = 0;

jest.mock('expo-file-system', () => {
  const join = (parts: (string | { uri: string })[]) =>
    parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    delete() {
      mockFiles.delete(this.uri);
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
  return { File, Paths: { document: { uri: 'file:///docs' }, cache: { uri: 'file:///cache' } } };
});

// Photos are stored as their own base64 text; a "file" per photo under file:///docs.
jest.mock('@/attachments', () => ({
  readPhoto: jest.fn(async (filePath: string) => {
    const b = mockFiles.get(`file:///docs/${filePath}`);
    if (!b) throw new Error('missing');
    return String.fromCharCode(...b);
  }),
  writePhoto: jest.fn(async (base64: string) => {
    const filePath = `attachments/restored-${++mockPhotoCount}.bin`;
    mockFiles.set(
      `file:///docs/${filePath}`,
      Uint8Array.from(base64, (c) => c.charCodeAt(0)),
    );
    return { filePath, mime: 'image/jpeg', sizeBytes: base64.length };
  }),
}));

jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  const B = require('buffer').Buffer;
  class AESEncryptionKey {
    raw: Uint8Array;
    constructor(key: Uint8Array) {
      this.raw = key;
    }
    static async import(key: Uint8Array) {
      return new AESEncryptionKey(key);
    }
  }
  class AESSealedData {
    bytes: Uint8Array;
    constructor(data: Uint8Array) {
      this.bytes = data;
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
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync: async (
      plain: Uint8Array,
      key: AESEncryptionKey,
      opts: { additionalData: Uint8Array },
    ) => {
      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key.raw, iv);
      cipher.setAAD(opts.additionalData);
      const ct = B.concat([cipher.update(plain), cipher.final()]);
      return new AESSealedData(new Uint8Array(B.concat([iv, ct, cipher.getAuthTag()])));
    },
    aesDecryptAsync: async (
      sealed: AESSealedData,
      key: AESEncryptionKey,
      opts: { additionalData: Uint8Array },
    ) => {
      const b = B.from(sealed.bytes);
      const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key.raw, b.subarray(0, 12));
      decipher.setAAD(opts.additionalData);
      decipher.setAuthTag(b.subarray(b.length - 16));
      return new Uint8Array(
        B.concat([decipher.update(b.subarray(12, b.length - 16)), decipher.final()]),
      );
    },
  };
});

// Real Argon2id, but with little memory: jest's vm context makes the production cost (19 MiB) take
// seconds per call. The parameters the app asks for are checked in their own test.
const mockArgon = jest.fn();
jest.mock('@noble/hashes/argon2', () => {
  const real = jest.requireActual('@noble/hashes/argon2');
  return {
    argon2idAsync: async (
      password: string,
      salt: Uint8Array,
      opts: { m: number; t: number; p: number; dkLen: number },
    ) => {
      mockArgon(password, opts);
      return real.argon2id(password, salt, { ...opts, m: 64 });
    },
  };
});

const { BACKUP_ERRORS, createBackupFile, readBackupFile, restoreBackup } =
  require('@/backup') as typeof import('@/backup');
const PASSWORD = 'Garagem é 10!';
const TODAY = '2026-10-17';
const OIL = {
  templateKey: 'oil',
  name: 'Troca de óleo e filtro',
  intervalKm: 10000,
  intervalMonths: 12,
};
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

async function seed(db: Db, nickname: string) {
  const vehicleId = await createVehicle(
    db,
    {
      nickname,
      odometerKm: 40000,
      monthlyKmEstimate: 1000,
      severeUse: true,
      modelRef: 'vw-polo-1.0-2018',
      items: [OIL],
    },
    '2026-01-10',
  );
  return vehicleId;
}

let db: Db;
let file: string;

beforeEach(async () => {
  mockFiles.clear();
  mockPhotoCount = 0;
  db = await createTestDb();
  const vehicleId = await seed(db, 'Meu Polo Ação');
  const [oil] = db.query.maintenanceItems.findMany().sync();
  mockFiles.set('file:///docs/attachments/nota.bin', ascii('JPEG-DA-NOTA'));
  await registerMaintenance(db, {
    vehicleId,
    itemId: oil.id,
    performedAt: '2026-03-01',
    km: 42000,
    costCents: 25000,
    notes: 'Oficina do Zé',
    attachment: { filePath: 'attachments/nota.bin', mime: 'image/jpeg', sizeBytes: 12 },
  });
  await registerMaintenance(db, {
    vehicleId,
    itemId: oil.id,
    performedAt: '2026-02-01',
    km: 41000,
  });
  const removed = db.query.maintenanceLogs
    .findMany()
    .sync()
    .find((l) => l.km === 41000)!;
  await removeMaintenance(db, removed.id);
  file = (await createBackupFile(db, PASSWORD, TODAY)).uri;
});

test('derives the key with Argon2id at OWASP minimum cost, from the password in one Unicode form', async () => {
  expect(mockArgon).toHaveBeenLastCalledWith(PASSWORD.normalize('NFC'), {
    m: 19456,
    t: 2,
    p: 1,
    dkLen: 32,
  });
  // "é" typed as e + combining accent opens a file made with the precomposed "é".
  await expect(readBackupFile(file, PASSWORD.normalize('NFD'))).resolves.toBeDefined();
});

test('writes a dated file that shows nothing of the data', () => {
  expect(file).toBe('file:///cache/Garagem-backup-2026-10-17.bkp');
  const text = String.fromCharCode(...mockFiles.get(file)!);
  expect(text.startsWith('{"format":"garagem-backup","version":1,"kdf":{"name":"argon2id"')).toBe(
    true,
  );
  for (const secret of ['Polo', 'Oficina', 'JPEG-DA-NOTA', '42000'])
    expect(text).not.toContain(secret);
});

test('restores everything onto another phone, photos re-encrypted, replacing what was there', async () => {
  const original = backupRows(db);
  const other = await createTestDb();
  const oldCar = await seed(other, 'Carro que estava aqui');
  mockFiles.set('file:///docs/attachments/old.bin', ascii('OLD'));
  await registerMaintenance(other, {
    vehicleId: oldCar,
    itemId: null,
    performedAt: '2026-02-01',
    km: 40500,
    attachment: { filePath: 'attachments/old.bin', mime: 'image/jpeg', sizeBytes: 3 },
  });

  await restoreBackup(other, await readBackupFile(file, PASSWORD));

  const restored = backupRows(other);
  expect(
    vehiclesQuery(other)
      .all()
      .map((v) => v.nickname),
  ).toEqual(['Meu Polo Ação']);
  expect(selectedVehicleIdQuery(other).all()).toEqual([]);
  // Same rows, soft-deleted ones included; only the photo moved to a file of this phone.
  const {
    attachments: [photo],
    ...rest
  } = restored;
  const {
    attachments: [originalPhoto],
    ...originalRest
  } = original;
  expect(rest).toEqual(originalRest);
  expect(rest.maintenanceLogs).toHaveLength(2);
  expect(photo).toEqual({
    ...originalPhoto,
    filePath: 'attachments/restored-1.bin',
    sizeBytes: 12,
  });
  expect(String.fromCharCode(...mockFiles.get('file:///docs/attachments/restored-1.bin')!)).toBe(
    'JPEG-DA-NOTA',
  );
  expect(mockFiles.has('file:///docs/attachments/old.bin')).toBe(false);
});

test('a wrong password or a tampered header does not open it', async () => {
  await expect(readBackupFile(file, 'senha errada')).rejects.toThrow(
    new ValidationError(BACKUP_ERRORS.wrongPassword),
  );

  const bytes = mockFiles.get(file)!;
  const tampered = String.fromCharCode(...bytes).replace('"t":2', '"t":1');
  mockFiles.set(file, ascii(tampered));
  await expect(readBackupFile(file, PASSWORD)).rejects.toThrow(
    new ValidationError(BACKUP_ERRORS.wrongPassword),
  );
});

test('tells apart files that are not backups and backups from a newer app', async () => {
  mockFiles.set('file:///cache/foto.jpg', ascii('\xff\xd8\xff\xe0 not a backup'));
  await expect(readBackupFile('file:///cache/foto.jpg', PASSWORD)).rejects.toThrow(
    new ValidationError(BACKUP_ERRORS.notBackup),
  );

  const newer = String.fromCharCode(...mockFiles.get(file)!).replace('"version":1', '"version":2');
  mockFiles.set(file, ascii(newer));
  await expect(readBackupFile(file, PASSWORD)).rejects.toThrow(
    new ValidationError(BACKUP_ERRORS.newer),
  );
});

test('a restore that fails keeps the current data and drops the photos it wrote', async () => {
  const backup = await readBackupFile(file, PASSWORD);
  const other = await createTestDb();
  await seed(other, 'Carro que estava aqui');
  const broken = { ...backup, rows: { ...backup.rows, vehicleSpecs: 'nope' as never } };

  await expect(restoreBackup(other, broken)).rejects.toThrow(
    new ValidationError(BACKUP_ERRORS.notBackup),
  );

  expect(
    vehiclesQuery(other)
      .all()
      .map((v) => v.nickname),
  ).toEqual(['Carro que estava aqui']);
  expect(mockFiles.has('file:///docs/attachments/restored-1.bin')).toBe(false);
});
