import { dossierFileName, dossierHtml, type DossierInput, type DossierLog } from '../dossier';

const log = (over: Partial<DossierLog> = {}): DossierLog => ({
  name: 'Troca de óleo e filtro',
  performedAt: '2026-03-10',
  km: 41500,
  costCents: 25000,
  brandSpec: 'Mobil 5W-30',
  registeredOn: '2026-03-10',
  hasReceipt: false,
  ...over,
});

const input = (over: Partial<DossierInput> = {}): DossierInput => ({
  nickname: 'Meu Onix',
  model: 'Chevrolet Onix 1.0 turbo, 2020 a 2025',
  lastReading: { km: 46250, readAt: '2026-10-01' },
  logs: [log()],
  generatedOn: '2026-10-17',
  ...over,
});

// Text content only, so assertions read like the PDF.
const text = (html: string) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

test('describes the car, the last reading and the totals', () => {
  const html = dossierHtml(
    input({
      logs: [
        log({ costCents: 15050 }),
        log({ name: 'Rodízio de pneus', costCents: null, hasReceipt: true }),
      ],
    }),
  );
  const t = text(html);
  expect(t).toContain('Meu Onix · Chevrolet Onix 1.0 turbo, 2020 a 2025');
  expect(t).toContain('Última leitura do hodômetro: 46.250 km em 1 de out. de 2026');
  expect(t).toContain('2 serviços registrados, total de R$ 150,50, 1 com comprovante.');
  expect(t).toContain('Gerado em 17 de out. de 2026');
});

test('lists each service with date, km, cost and brand, in the given order', () => {
  const t = text(
    dossierHtml(input({ logs: [log({ performedAt: '2026-08-01', km: 45000 }), log()] })),
  );
  expect(t.indexOf('1 de ago. de 2026 · 45.000 km')).toBeLessThan(
    t.indexOf('10 de mar. de 2026 · 41.500 km'),
  );
  expect(t).toContain('R$ 250,00');
  expect(t).toContain('Mobil 5W-30');
});

test('flags records created after the service date, and says when same-day ones were made', () => {
  const t = text(
    dossierHtml(
      input({
        logs: [
          log({ registeredOn: '2026-04-02' }),
          log({ performedAt: '2026-05-01', registeredOn: '2026-05-01' }),
        ],
      }),
    ),
  );
  expect(t).toContain('Registrado no app depois, em 2 de abr. de 2026');
  expect(t).toContain('Registrado depois do serviço');
  expect(t).toContain('Registrado no app no mesmo dia');
  expect(t).toContain('1 registro feito depois da data do serviço.');
});

test('marks receipts, embedding photos only when given', () => {
  const without = dossierHtml(input({ logs: [log({ hasReceipt: true })] }));
  expect(text(without)).toContain('Com comprovante');
  expect(without).not.toContain('<img');
  expect(text(without)).not.toContain('as fotos estão incluídas');

  const withPhoto = dossierHtml(input({ logs: [log({ hasReceipt: true, photo: 'QUJD' })] }));
  expect(withPhoto).toContain(
    '<img src="data:image/jpeg;base64,QUJD" alt="Comprovante de Troca de óleo e filtro">',
  );
  expect(text(withPhoto)).toContain('as fotos estão incluídas aqui');
});

test('escapes what the user typed', () => {
  const html = dossierHtml(
    input({ nickname: '<b>Carro & cia</b>', logs: [log({ brandSpec: '"5W-30" <script>' })] }),
  );
  expect(html).toContain('&lt;b&gt;Carro &amp; cia&lt;/b&gt;');
  expect(html).toContain('&quot;5W-30&quot; &lt;script&gt;');
  expect(html).not.toContain('<script>');
});

test('names the file after the car, without accents or symbols', () => {
  expect(dossierFileName('Meu Sandero 2018', '2026-10-17')).toBe(
    'Historico-Meu-Sandero-2018-2026-10-17',
  );
  expect(dossierFileName('  Carro da Ação / "SUV"! ', '2026-10-17')).toBe(
    'Historico-Carro-da-Acao-SUV-2026-10-17',
  );
  expect(dossierFileName('🚗', '2026-10-17')).toBe('Historico-2026-10-17');
});

test('works for a car outside the seed with no records or readings', () => {
  const t = text(dossierHtml(input({ model: null, lastReading: null, logs: [] })));
  expect(t).toContain('Meu Onix');
  expect(t).not.toContain('·');
  expect(t).not.toContain('Última leitura');
  expect(t).toContain('0 serviços registrados, total de R$ 0,00.');
  expect(t).toContain('Nenhum serviço registrado.');
});
