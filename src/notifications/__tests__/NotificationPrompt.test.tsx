import { act, render, screen, userEvent } from '@testing-library/react-native';
import type { Db } from '@/db/client';
import { notificationPromptQuery } from '@/db/repo';
import { deniedPermission, notificationsMock as N } from '@/test-utils/notifications';
import { setupScreen } from '@/test-utils/screens';
import { NotificationPrompt } from '../NotificationPrompt';
import { rescheduleDigest } from '../scheduler';

jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('expo-notifications', () => require('@/test-utils/notifications').notificationsMock);
jest.mock('../scheduler', () => ({
  setupNotifications: jest.fn(async () => {}),
  rescheduleDigest: jest.fn(async () => {}),
}));

const GRANTED = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
const QUESTION = 'Quer um lembrete aos sábados?';

let db: Db;
beforeEach(async () => {
  db = await setupScreen();
  N.getPermissionsAsync.mockResolvedValue(deniedPermission(true));
  N.requestPermissionsAsync.mockResolvedValue(GRANTED);
});
afterAll(() => N.getPermissionsAsync.mockResolvedValue(GRANTED));

test('explains the reminder before asking, then asks and schedules once granted', async () => {
  await render(<NotificationPrompt />);
  expect(await screen.findByText(QUESTION)).toBeOnTheScreen();
  expect(
    screen.getByText(/Aos sábados, às 9h, o Garagem avisa quais trocas estão chegando nos seus carros/),
  ).toBeOnTheScreen();
  expect(N.requestPermissionsAsync).not.toHaveBeenCalled();

  await userEvent.setup().press(screen.getByRole('button', { name: 'Ativar lembretes' }));

  expect(N.requestPermissionsAsync).toHaveBeenCalledWith({ ios: { allowAlert: true, allowSound: true } });
  expect(rescheduleDigest).toHaveBeenCalled();
  expect(screen.queryByText(QUESTION)).not.toBeOnTheScreen();
  expect(notificationPromptQuery(db).all()).toHaveLength(1);
});

test('a refusal just closes the card', async () => {
  N.requestPermissionsAsync.mockResolvedValue(deniedPermission(false));
  await render(<NotificationPrompt />);

  await userEvent.setup().press(await screen.findByRole('button', { name: 'Ativar lembretes' }));

  expect(rescheduleDigest).not.toHaveBeenCalled();
  expect(screen.queryByText(QUESTION)).not.toBeOnTheScreen();
  expect(notificationPromptQuery(db).all()).toHaveLength(1);
});

test('a failing request closes the card without an error', async () => {
  N.requestPermissionsAsync.mockRejectedValue(new Error('native'));
  await render(<NotificationPrompt />);

  await userEvent.setup().press(await screen.findByRole('button', { name: 'Ativar lembretes' }));

  expect(screen.queryByText(QUESTION)).not.toBeOnTheScreen();
});

test('"Agora não" closes it for good without asking', async () => {
  await render(<NotificationPrompt />);

  await userEvent.setup().press(await screen.findByRole('button', { name: 'Agora não' }));

  expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(screen.queryByText(QUESTION)).not.toBeOnTheScreen();
  await screen.rerender(<></>);
  await render(<NotificationPrompt />);
  await act(async () => {});
  expect(screen.queryByText(QUESTION)).not.toBeOnTheScreen();
});

test.each([
  ['already granted', GRANTED],
  ['refused for good', deniedPermission(false)],
])('stays hidden when the permission is %s', async (_, permission) => {
  N.getPermissionsAsync.mockResolvedValue(permission);
  await render(<NotificationPrompt />);
  await act(async () => {});

  expect(screen.queryByText(QUESTION)).not.toBeOnTheScreen();
});
