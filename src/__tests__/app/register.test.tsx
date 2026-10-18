import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { eq, isNull } from 'drizzle-orm';
import * as ImagePicker from 'expo-image-picker';
import Register from '@/app/register';
import type { Db } from '@/db/client';
import { logsQuery, readingsQuery, registerMaintenance } from '@/db/repo';
import { attachments, maintenanceItems } from '@/db/schema';
import { addDays, projectOdometer, todayISO } from '@/domain';
import { attachmentsMock, params, redirect, router, seedVehicle, setupScreen } from '@/test-utils/screens';

jest.mock('expo-router', () => require('@/test-utils/screens').expoRouterMock);
jest.mock('drizzle-orm/expo-sqlite', () => require('@/test-utils/screens').liveQueryMock);
jest.mock('@/db/provider', () => require('@/test-utils/screens').providerMock);
jest.mock('@/attachments', () => require('@/test-utils/screens').attachmentsMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)) }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///cache/ImagePicker/camera.jpg' }] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///cache/ImagePicker/pick.jpg' }] })),
}));

let db: Db;
let vehicleId: string;
let oilId: string;
const since = addDays(todayISO(), -400);

beforeEach(async () => {
  db = await setupScreen();
  ({ vehicleId, oilId } = await seedVehicle(db, since));
  params.itemId = oilId;
});

const kmField = () => screen.getByLabelText('KM no momento da troca, km');

test('saves the log, moves the item baseline to it and closes', async () => {
  const projected = projectOdometer([{ km: 40000, readAt: since }], 1000, todayISO());
  await render(<Register />);
  const user = userEvent.setup();

  expect(screen.getByRole('header', { name: 'Troca de óleo e filtro' })).toBeOnTheScreen();
  expect(kmField()).toHaveDisplayValue(String(projected));
  expect(screen.getByText('Valor estimado. Confira no painel do carro.')).toBeOnTheScreen();
  expect(screen.getByText('Data da troca')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Hoje' })).toBeChecked();

  await user.type(screen.getByLabelText('Custo (opcional), R$'), '1.234,5');
  await user.type(screen.getByLabelText('Marca ou especificação (opcional)'), 'Mobil 5W-30');
  await user.press(screen.getByRole('button', { name: 'Registrar troca' }));

  expect(router.back).toHaveBeenCalled();
  expect(logsQuery(db, vehicleId).all()).toEqual([
    expect.objectContaining({
      itemId: oilId,
      itemName: 'Troca de óleo e filtro',
      performedAt: todayISO(),
      km: projected,
      costCents: 123450,
      brandSpec: 'Mobil 5W-30',
    }),
  ]);
  const item = db.select().from(maintenanceItems).where(eq(maintenanceItems.id, oilId)).get();
  expect(item).toEqual(expect.objectContaining({ baselineKm: projected, baselineDate: todayISO() }));
});

test('rejects a KM below an earlier reading', async () => {
  await render(<Register />);
  const user = userEvent.setup();

  await user.clear(kmField());
  await user.type(kmField(), '39000');
  await user.press(screen.getByRole('button', { name: 'Registrar troca' }));

  // Correcting an earlier reading lives in Ajustar KM, behind a confirmation.
  expect(
    screen.getByText(
      'Esse KM é menor que uma leitura anterior. Confira o valor. Se o KM salvo antes estava errado, corrija em Ajustar KM.',
    ),
  ).toBeOnTheScreen();
  expect(logsQuery(db, vehicleId).all()).toEqual([]);
  expect(router.back).not.toHaveBeenCalled();
});

test('rejects a KM too high to be real', async () => {
  await render(<Register />);
  const user = userEvent.setup();

  await user.clear(kmField());
  await user.type(kmField(), '2.000.001');
  await user.press(screen.getByRole('button', { name: 'Registrar troca' }));

  expect(screen.getByText('Confira o KM: o valor parece alto demais.')).toBeOnTheScreen();
  expect(logsQuery(db, vehicleId).all()).toEqual([]);
});

test('saves once when the button is tapped twice in a row', async () => {
  await render(<Register />);
  const button = screen.getByRole('button', { name: 'Registrar troca' });

  // Raw presses, without userEvent's press-and-release delays; the sheet stays open (router is mocked).
  await fireEvent.press(button);
  await fireEvent.press(button);

  expect(logsQuery(db, vehicleId).all()).toHaveLength(1);
  expect(button).toBeBusy();
});

test('asks for a valid past date and a readable cost', async () => {
  await render(<Register />);
  const user = userEvent.setup();

  await user.press(screen.getByRole('radio', { name: 'Outra data' }));
  await user.type(screen.getByLabelText('Data (DD/MM/AAAA)'), '31/02/2026');
  await user.type(screen.getByLabelText('Custo (opcional), R$'), 'abc');
  await user.press(screen.getByRole('button', { name: 'Registrar troca' }));

  expect(screen.getByText('Use uma data até hoje, no formato DD/MM/AAAA.')).toBeOnTheScreen();
  expect(screen.getByText('Digite o valor em reais, por exemplo 150,00.')).toBeOnTheScreen();
  expect(logsQuery(db, vehicleId).all()).toEqual([]);
});

test('leaves for the garage when the item does not exist', async () => {
  params.itemId = 'missing';
  await render(<Register />);
  expect(redirect).toHaveBeenCalledWith('/');
});

test("logs on the item's own car, not the first one", async () => {
  const gol = await seedVehicle(db, todayISO(), { nickname: 'Meu Gol', odometerKm: 80000 });
  params.itemId = gol.oilId;
  await render(<Register />);

  expect(kmField()).toHaveDisplayValue('80000');
  await userEvent.setup().press(screen.getByRole('button', { name: 'Registrar troca' }));

  expect(logsQuery(db, gol.vehicleId).all()).toEqual([expect.objectContaining({ itemId: gol.oilId, km: 80000 })]);
  expect(logsQuery(db, vehicleId).all()).toEqual([]);
});

describe('receipt photo', () => {
  const liveAttachments = () => db.select().from(attachments).where(isNull(attachments.deletedAt)).all();

  test('takes a photo, previews it and saves it with the log', async () => {
    await render(<Register />);
    const user = userEvent.setup();

    expect(screen.getByText('Foto do comprovante (opcional)')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Tirar foto' }));

    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith({ mediaTypes: 'images', quality: 1 });
    expect(attachmentsMock.preparePhoto).toHaveBeenCalledWith('file:///cache/ImagePicker/camera.jpg');
    expect(screen.getByRole('image', { name: 'Foto do comprovante' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Tirar foto' })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Registrar troca' }));
    expect(logsQuery(db, vehicleId).all()).toEqual([expect.objectContaining({ photo: 'attachments/PHOTO.bin' })]);
    expect(router.back).toHaveBeenCalled();
  });

  test('can drop the photo again before saving', async () => {
    await render(<Register />);
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Escolher da galeria' }));
    expect(attachmentsMock.preparePhoto).toHaveBeenCalledWith('file:///cache/ImagePicker/pick.jpg');
    await user.press(screen.getByRole('button', { name: 'Remover foto' }));
    expect(screen.queryByRole('image', { name: 'Foto do comprovante' })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Registrar troca' }));
    expect(logsQuery(db, vehicleId).all()).toEqual([expect.objectContaining({ photo: null })]);
  });

  test('says how to allow the camera when it is denied, and keeps a cancelled pick out', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: true, assets: null });
    await render(<Register />);
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Tirar foto' }));
    expect(
      screen.getByText('Para fotografar o comprovante, permita o uso da câmera nas configurações do aparelho.'),
    ).toBeOnTheScreen();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: 'Escolher da galeria' }));
    expect(attachmentsMock.preparePhoto).not.toHaveBeenCalled();
    expect(screen.queryByRole('image')).not.toBeOnTheScreen();
  });

  test('explains a photo that could not be used, and still saves the log', async () => {
    attachmentsMock.preparePhoto.mockRejectedValueOnce(new Error('decode failed'));
    await render(<Register />);
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Escolher da galeria' }));
    expect(screen.getByText('Não foi possível usar essa foto. Tente de novo.')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Registrar troca' }));
    expect(logsQuery(db, vehicleId).all()).toEqual([expect.objectContaining({ photo: null })]);
    expect(liveAttachments()).toEqual([]);
  });
});

describe('editing a log', () => {
  const tenDaysAgo = addDays(todayISO(), -10);

  async function seedLog(attachment?: { filePath: string; mime: string; sizeBytes: number }) {
    await registerMaintenance(db, {
      vehicleId,
      itemId: oilId,
      performedAt: tenDaysAgo,
      km: 52000,
      costCents: 15000,
      brandSpec: 'Mobil 5W-30',
      notes: 'Oficina do bairro',
      attachment,
    });
    const [log] = logsQuery(db, vehicleId).all();
    delete params.itemId;
    params.vehicleId = vehicleId;
    params.logId = log.id;
    return log;
  }

  test('starts from what was saved and saves the changes', async () => {
    const log = await seedLog();
    await render(<Register />);
    const user = userEvent.setup();

    expect(screen.getByRole('header', { name: 'Troca de óleo e filtro' })).toBeOnTheScreen();
    expect(kmField()).toHaveDisplayValue('52000');
    expect(screen.queryByText('Valor estimado. Confira no painel do carro.')).not.toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Outra data' })).toBeChecked();
    expect(screen.getByLabelText('Data (DD/MM/AAAA)')).toHaveDisplayValue(tenDaysAgo.split('-').reverse().join('/'));
    expect(screen.getByLabelText('Custo (opcional), R$')).toHaveDisplayValue('150,00');
    expect(screen.getByLabelText('Marca ou especificação (opcional)')).toHaveDisplayValue('Mobil 5W-30');
    expect(screen.getByLabelText('Observações (opcional)')).toHaveDisplayValue('Oficina do bairro');

    await user.clear(kmField());
    await user.type(kmField(), '51500');
    await user.press(screen.getByRole('radio', { name: 'Ontem' }));
    await user.clear(screen.getByLabelText('Custo (opcional), R$'));
    await user.press(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(router.back).toHaveBeenCalled();
    expect(logsQuery(db, vehicleId).all()).toEqual([
      expect.objectContaining({ id: log.id, km: 51500, performedAt: addDays(todayISO(), -1), costCents: null }),
    ]);
    // Its reading moved with it; the item's baseline too.
    expect(readingsQuery(db, vehicleId).all()).toEqual([
      { km: 40000, readAt: since },
      { km: 51500, readAt: addDays(todayISO(), -1) },
    ]);
    const item = db.select().from(maintenanceItems).where(eq(maintenanceItems.id, oilId)).get();
    expect(item).toEqual(expect.objectContaining({ baselineKm: 51500, baselineDate: addDays(todayISO(), -1) }));
  });

  test('shows the saved photo and removes it on save', async () => {
    await seedLog({ filePath: 'attachments/old.bin', mime: 'image/jpeg', sizeBytes: 1 });
    await render(<Register />);
    const user = userEvent.setup();

    expect(attachmentsMock.readPhoto).toHaveBeenCalledWith('attachments/old.bin');
    expect(await screen.findByRole('image', { name: 'Foto do comprovante' })).toHaveProp('source', [
      { uri: 'data:image/jpeg;base64,SAVED' },
    ]);

    await user.press(screen.getByRole('button', { name: 'Remover foto' }));
    await user.press(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(logsQuery(db, vehicleId).all()).toEqual([expect.objectContaining({ photo: null })]);
    expect(attachmentsMock.deleteRemovedPhotos).toHaveBeenCalled();
  });

  test('keeps the saved photo when only the text changes, even if it could not be opened', async () => {
    attachmentsMock.readPhoto.mockRejectedValueOnce(new Error('bad tag'));
    await seedLog({ filePath: 'attachments/old.bin', mime: 'image/jpeg', sizeBytes: 1 });
    await render(<Register />);
    const user = userEvent.setup();

    expect(await screen.findByText('Não foi possível abrir a foto salva.')).toBeOnTheScreen();
    await user.type(screen.getByLabelText('Observações (opcional)'), '!');
    await user.press(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(logsQuery(db, vehicleId).all()).toEqual([
      expect.objectContaining({ notes: 'Oficina do bairro!', photo: 'attachments/old.bin' }),
    ]);
  });

  test('rejects a km out of order with the other readings', async () => {
    await seedLog();
    await render(<Register />);
    const user = userEvent.setup();

    await user.clear(kmField());
    await user.type(kmField(), '39000');
    await user.press(screen.getByRole('button', { name: 'Salvar alterações' }));

    expect(screen.getByText(/^Esse KM é menor que uma leitura anterior/)).toBeOnTheScreen();
    expect(logsQuery(db, vehicleId).all()).toEqual([expect.objectContaining({ km: 52000 })]);
    expect(router.back).not.toHaveBeenCalled();
  });

  test('leaves for the garage when the log is gone', async () => {
    params.vehicleId = vehicleId;
    params.logId = 'missing';
    delete params.itemId;
    await render(<Register />);
    expect(redirect).toHaveBeenCalledWith('/');
  });
});
