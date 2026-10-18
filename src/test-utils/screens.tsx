// Mocks and seed shared by the screen tests in src/__tests__/app. Those tests can't live in
// src/app: expo-router loads every file there as a route. Wire mocks up per test file with
//   jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
import { act } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Alert, Text, type AlertButton } from 'react-native';
import type { Db } from '@/db/client';
import { createVehicle, itemsQuery, type NewAttachment } from '@/db/repo';
import { createTestDb } from '@/db/test-utils/testDb';
import { todayISO, type ISODate } from '@/domain';

export const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() };
export const redirect = jest.fn();
export const params: Record<string, string> = {};

export const expoRouterMock = {
  router,
  useLocalSearchParams: () => params,
  Redirect: ({ href }: { href: unknown }) => {
    redirect(href);
    return null;
  },
  // Renders the header title (or a custom headerTitle) so tests can assert it.
  Stack: {
    Screen: ({ options }: { options?: { title?: string; headerTitle?: () => ReactNode } }) =>
      options?.headerTitle ? (
        options.headerTitle()
      ) : options?.title ? (
        <Text accessibilityRole="header">{options.title}</Text>
      ) : null,
  },
};

// No expo-sqlite change listeners under jest: run the query on every render instead,
// so a rerender after a write shows fresh data.
export const liveQueryMock = {
  useLiveQuery: (query: { all: () => unknown }) => ({ data: query.all(), error: undefined, updatedAt: new Date() }),
};

// No native crypto or files under jest. A photo "PHOTO" is saved as attachments/PHOTO.bin; a saved
// one reads back as "SAVED". Wire up with
//   jest.mock('@/attachments', () => require('@/test-utils/screens').attachmentsMock);
export const attachmentsMock = {
  preparePhoto: jest.fn(async (_uri: string) => 'PHOTO'),
  readPhoto: jest.fn(async (_filePath: string) => 'SAVED'),
  deleteRemovedPhotos: jest.fn(),
  saveWithPhoto: jest.fn(
    async (photo: string | null | undefined, save: (a: NewAttachment | null | undefined) => Promise<void>) =>
      save(photo == null ? photo : { filePath: `attachments/${photo}.bin`, mime: 'image/jpeg', sizeBytes: 1 }),
  ),
};

let db: Db | undefined;
export const providerMock = { useDb: () => db };

/** Fresh in-memory DB (real migrations) behind useDb, and clean router mocks. */
export async function setupScreen(): Promise<Db> {
  jest.clearAllMocks();
  for (const k of Object.keys(params)) delete params[k];
  db = await createTestDb();
  return db;
}

/** Spies on Alert.alert and returns a way to press one of its buttons. */
export function spyAlert() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const press = async (text: string) => {
    const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[];
    await act(async () => buttons.find((b) => b.text === text)?.onPress?.());
  };
  return { alert, press };
}

export const OIL = { templateKey: 'oil', name: 'Troca de óleo e filtro', intervalKm: 10000, intervalMonths: 12 };

/** "Meu Sandero" at 40.000 km on `since`, ~1.000 km/month, tracking oil only. Selected, like a new car. */
export async function seedVehicle(
  target: Db,
  since: ISODate = todayISO(),
  over: { nickname?: string; odometerKm?: number } = {},
) {
  const vehicleId = await createVehicle(
    target,
    { nickname: 'Meu Sandero', odometerKm: 40000, monthlyKmEstimate: 1000, severeUse: false, items: [OIL], ...over },
    since,
  );
  return { vehicleId, oilId: itemsQuery(target, vehicleId).all()[0].id };
}
