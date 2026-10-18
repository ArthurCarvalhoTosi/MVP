import { parseBRDate, parseBRL, parseIntBR } from '../parse';

describe('parseIntBR', () => {
  it('accepts plain digits and pt-BR thousands separators', () => {
    expect(parseIntBR('46250')).toBe(46250);
    expect(parseIntBR(' 46.250 ')).toBe(46250);
    expect(parseIntBR('1.234.567')).toBe(1234567);
    expect(parseIntBR('0')).toBe(0);
  });

  it('rejects empty, negative, decimal and garbage input', () => {
    for (const s of [
      '',
      '  ',
      '-5',
      '46,5',
      '46.25',
      '4.6250',
      '12a',
      'abc',
      '1 000',
      '99999999999999999999',
    ]) {
      expect(parseIntBR(s)).toBeNull();
    }
  });
});

describe('parseBRL', () => {
  it('reads pt-BR amounts as cents', () => {
    expect(parseBRL('1.234,56')).toBe(123456);
    expect(parseBRL('1234,56')).toBe(123456);
    expect(parseBRL('150')).toBe(15000);
    expect(parseBRL('150,5')).toBe(15050);
    expect(parseBRL('150,05')).toBe(15005);
    expect(parseBRL(' 0,99 ')).toBe(99);
    expect(parseBRL('0')).toBe(0);
  });

  it('treats a dot as thousands when 3 digits follow, as decimal mark otherwise', () => {
    expect(parseBRL('1.234')).toBe(123400);
    expect(parseBRL('150.5')).toBe(15050);
    expect(parseBRL('150.50')).toBe(15050);
  });

  it('rejects garbage', () => {
    for (const s of [
      '',
      'abc',
      '-5',
      '1,2,3',
      '12,345',
      '1.23,4',
      '1.234.5',
      'R$ 150',
      '150,',
      ',50',
      '1e3',
    ]) {
      expect(parseBRL(s)).toBeNull();
    }
  });
});

describe('parseBRDate', () => {
  const today = '2026-10-15';

  it('reads DD/MM/AAAA, with or without leading zeros', () => {
    expect(parseBRDate('01/02/2026', today)).toBe('2026-02-01');
    expect(parseBRDate(' 1/2/2026 ', today)).toBe('2026-02-01');
    expect(parseBRDate('15/10/2026', today)).toBe(today);
  });

  it('rejects dates that do not exist', () => {
    for (const s of [
      '31/02/2026',
      '29/02/2025',
      '00/01/2026',
      '32/01/2026',
      '15/13/2026',
      '15/00/2026',
      '01/01/0099',
    ]) {
      expect(parseBRDate(s, today)).toBeNull();
    }
  });

  it('accepts 29 February only in leap years', () => {
    expect(parseBRDate('29/02/2024', today)).toBe('2024-02-29');
    expect(parseBRDate('29/02/2023', today)).toBeNull();
  });

  it('rejects future dates', () => {
    expect(parseBRDate('16/10/2026', today)).toBeNull();
    expect(parseBRDate('01/01/2027', today)).toBeNull();
  });

  it('rejects other shapes', () => {
    for (const s of ['', '2026-10-01', '01/10/26', '01-10-2026', '1/10/2026x', 'ontem']) {
      expect(parseBRDate(s, today)).toBeNull();
    }
  });
});
