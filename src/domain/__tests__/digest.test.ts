import { buildDigest, isSnoozed, pendingByVehicle, type DigestItem } from '../digest';

// Rate 0 keeps km-based items still, so each test controls urgency through dates or km left.
const SANDERO = { id: 'sandero', nickname: 'Meu Sandero', monthlyKmEstimate: 0 };
const GOL = { id: 'gol', nickname: 'Meu Gol', monthlyKmEstimate: 0 };
const readings = [
  { vehicleId: 'sandero', km: 40000, readAt: '2026-10-14' },
  { vehicleId: 'gol', km: 80000, readAt: '2026-10-14' },
];

const item = (id: string, vehicleId: string, over: Partial<DigestItem> = {}): DigestItem => ({
  id,
  vehicleId,
  name: id,
  intervalKm: null,
  intervalMonths: null,
  baselineKm: vehicleId === 'gol' ? 80000 : 40000,
  baselineDate: '2026-01-01',
  snoozedUntil: null,
  ...over,
});
// Due 2026-09-01: overdue, so critical on every upcoming Saturday.
const overdue = (id: string, vehicleId = 'sandero', over: Partial<DigestItem> = {}) =>
  item(id, vehicleId, { baselineDate: '2025-09-01', intervalMonths: 12, ...over });
// 1.000 km left and no km/day trend: attention on every Saturday.
const attention = (id: string, vehicleId = 'sandero') =>
  item(id, vehicleId, { baselineKm: vehicleId === 'gol' ? 71000 : 31000, intervalKm: 10000 });
// 9.000 km left: ok.
const ok = (id: string) => item(id, 'sandero', { baselineKm: 39000, intervalKm: 10000 });

const WEDNESDAY = new Date(2026, 9, 14, 10, 0);
const dates = (now: Date, items: DigestItem[] = [overdue('Óleo')]) =>
  buildDigest([SANDERO], items, readings, now).map((n) => n.date);

describe('buildDigest: Saturdays', () => {
  it('plans the next 8 Saturdays, across a month end', () => {
    expect(dates(WEDNESDAY)).toEqual([
      '2026-10-17',
      '2026-10-24',
      '2026-10-31',
      '2026-11-07',
      '2026-11-14',
      '2026-11-21',
      '2026-11-28',
      '2026-12-05',
    ]);
  });

  it('includes today, a Saturday, only before 09h', () => {
    expect(dates(new Date(2026, 9, 17, 8, 59))[0]).toBe('2026-10-17');
    expect(dates(new Date(2026, 9, 17, 9, 0))[0]).toBe('2026-10-24');
    expect(dates(new Date(2026, 9, 17, 21, 0))[0]).toBe('2026-10-24');
  });

  it('starts on the coming Saturday from a Sunday', () => {
    expect(dates(new Date(2026, 9, 18, 7, 0))[0]).toBe('2026-10-24');
  });

  it('crosses the year end', () => {
    expect(dates(new Date(2026, 11, 28, 12, 0)).slice(0, 3)).toEqual(['2027-01-02', '2027-01-09', '2027-01-16']);
  });

  it('has nothing on Saturdays with nothing pending', () => {
    expect(buildDigest([SANDERO], [ok('Pneus')], readings, WEDNESDAY)).toEqual([]);
    expect(buildDigest([SANDERO], [], readings, WEDNESDAY)).toEqual([]);
    expect(buildDigest([], [], [], WEDNESDAY)).toEqual([]);
  });

  it('starts notifying on the Saturday an item turns pending', () => {
    // Due Dec 15 by date: attention from 45 days before (Oct 31), critical from 15 days before.
    const brakes = item('Freios', 'sandero', { baselineDate: '2025-12-15', intervalMonths: 12 });
    const plan = buildDigest([SANDERO], [brakes], readings, WEDNESDAY);
    expect(plan.map((n) => [n.date, n.kind])).toEqual([
      ['2026-10-31', 'summary'],
      ['2026-11-07', 'summary'],
      ['2026-11-14', 'summary'],
      ['2026-11-21', 'summary'],
      ['2026-11-28', 'summary'],
      ['2026-12-05', 'critical'],
    ]);
  });
});

describe('buildDigest: one critical item', () => {
  it('gets its own notification with the ids its actions need', () => {
    const [first] = buildDigest([SANDERO], [overdue('Troca de óleo')], readings, WEDNESDAY);
    expect(first).toEqual({
      kind: 'critical',
      date: '2026-10-17',
      itemId: 'Troca de óleo',
      vehicleId: 'sandero',
      title: 'Troca de óleo',
      body: 'Meu Sandero: vencido há 46 dias.',
    });
  });

  it('mentions the attention items that come along', () => {
    const one = buildDigest([SANDERO], [overdue('Óleo'), attention('Freios')], readings, WEDNESDAY)[0];
    expect(one).toMatchObject({ kind: 'critical', itemId: 'Óleo', body: 'Meu Sandero: vencido há 46 dias. Mais 1 em atenção.' });

    const two = buildDigest([SANDERO, GOL], [overdue('Óleo'), attention('Freios'), attention('Pneus', 'gol')], readings, WEDNESDAY)[0];
    expect(two).toMatchObject({ kind: 'critical', body: 'Meu Sandero: vencido há 46 dias. Mais 2 em atenção.' });
  });

  it('covers an item overdue by km, in the right car', () => {
    // 52.000 km against a 50.000 km limit, no km/day trend.
    const timing = item('Correia', 'gol', { baselineKm: 40000, intervalKm: 50000 });
    const gol = [{ vehicleId: 'gol', km: 92000, readAt: '2026-10-14' }];
    const [first] = buildDigest([SANDERO, GOL], [timing], gol, WEDNESDAY);
    expect(first).toMatchObject({ kind: 'critical', itemId: 'Correia', vehicleId: 'gol', title: 'Correia' });
    expect(first.body).toMatch(/^Meu Gol: /);
    expect(first.body).toContain('passou 2.000 km');
  });
});

describe('buildDigest: summary', () => {
  it('lists the items of one car, critical first, with singular and plural', () => {
    const two = buildDigest([SANDERO], [attention('Freios'), overdue('Óleo'), overdue('Filtro de ar')], readings, WEDNESDAY)[0];
    expect(two).toEqual({
      kind: 'summary',
      date: '2026-10-17',
      title: 'Check-up da semana',
      body: '3 trocas precisam de atenção: Filtro de ar, Óleo, Freios.',
    });

    const one = buildDigest([SANDERO], [attention('Freios')], readings, WEDNESDAY)[0];
    expect(one).toMatchObject({ kind: 'summary', body: '1 troca precisa de atenção: Freios.' });
  });

  it('groups every car, naming the car of each item', () => {
    const [first] = buildDigest(
      [SANDERO, GOL],
      [attention('Freios'), overdue('Óleo', 'gol'), overdue('Correia')],
      readings,
      WEDNESDAY,
    );
    expect(first).toMatchObject({
      kind: 'summary',
      body: '3 trocas precisam de atenção em 2 carros: Correia (Meu Sandero), Óleo (Meu Gol), Freios (Meu Sandero).',
    });
  });

  it('cuts a long list', () => {
    const items = ['A', 'B', 'C', 'D', 'E'].map((id) => attention(id));
    expect(buildDigest([SANDERO], items, readings, WEDNESDAY)[0].body).toBe(
      '5 trocas precisam de atenção: A, B, C e mais 2.',
    );
  });

  it('leaves out items whose car is not in the list (e.g. removed)', () => {
    expect(buildDigest([SANDERO], [overdue('Óleo', 'gol')], readings, WEDNESDAY)).toEqual([]);
  });
});

describe('buildDigest: snooze', () => {
  it('keeps a snoozed item out until the snooze date, then brings it back', () => {
    // Snoozed on Saturday Oct 17 for 15 days: until Sunday Nov 1.
    const snoozed = overdue('Óleo', 'sandero', { snoozedUntil: '2026-11-01' });
    expect(dates(WEDNESDAY, [snoozed]).slice(0, 2)).toEqual(['2026-11-07', '2026-11-14']);

    // Snoozed until a Saturday: back on that Saturday.
    const untilSaturday = overdue('Óleo', 'sandero', { snoozedUntil: '2026-10-31' });
    expect(dates(WEDNESDAY, [untilSaturday])[0]).toBe('2026-10-31');
  });

  it('turns a summary into a single-item notification when the other critical is snoozed', () => {
    const plan = buildDigest(
      [SANDERO],
      [overdue('Óleo'), overdue('Correia', 'sandero', { snoozedUntil: '2026-10-20' })],
      readings,
      WEDNESDAY,
    );
    expect(plan[0]).toMatchObject({ date: '2026-10-17', kind: 'critical', itemId: 'Óleo' });
    expect(plan[1]).toMatchObject({ date: '2026-10-24', kind: 'summary' });
  });
});

describe('isSnoozed', () => {
  it('is true only before the snooze date', () => {
    expect(isSnoozed({ snoozedUntil: null }, '2026-10-17')).toBe(false);
    expect(isSnoozed({ snoozedUntil: '2026-11-01' }, '2026-10-31')).toBe(true);
    expect(isSnoozed({ snoozedUntil: '2026-11-01' }, '2026-11-01')).toBe(false);
  });
});

describe('pendingByVehicle', () => {
  it('lists critical then attention items per car, skipping cars with nothing pending and snoozed items', () => {
    const groups = pendingByVehicle(
      [SANDERO, GOL, { ...GOL, id: 'empty', nickname: 'Vazio' }],
      [
        attention('Freios'),
        overdue('Óleo'),
        ok('Pneus'),
        overdue('Correia', 'sandero', { snoozedUntil: '2026-10-20' }),
        attention('Filtro', 'gol'),
      ],
      readings,
      '2026-10-17',
    );
    expect(groups.map((g) => [g.vehicle.nickname, g.entries.map((e) => [e.item.name, e.due.urgency])])).toEqual([
      ['Meu Sandero', [['Óleo', 'critical'], ['Freios', 'attention']]],
      ['Meu Gol', [['Filtro', 'attention']]],
    ]);
  });
});
