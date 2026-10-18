import type { ISODate } from './dates';
import { formatBRL, formatDate, formatKm } from './format';

export interface DossierLog {
  name: string;
  performedAt: ISODate;
  km: number;
  costCents: number | null;
  brandSpec: string | null;
  /** Local calendar day the record was created in the app. */
  registeredOn: ISODate;
  hasReceipt: boolean;
  /** Decrypted receipt JPEG (base64), only when the owner chose to include photos. */
  photo?: string | null;
}

export interface DossierInput {
  nickname: string;
  /** "Chevrolet Onix 1.0 turbo, 2020 em diante", or null for a car outside the seed. */
  model: string | null;
  lastReading: { km: number; readAt: ISODate } | null;
  /** Newest first, as in the history screen. */
  logs: DossierLog[];
  generatedOn: ISODate;
}

/** "Historico-Meu-Onix-2026-10-17": the name the recipient sees, safe on any file system. */
export function dossierFileName(nickname: string, generatedOn: ISODate): string {
  const name = nickname
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `Historico-${name ? `${name}-` : ''}${generatedOn}`;
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The resale dossier as a self-contained HTML page for expo-print. Leaves out notes, plate and VIN
 * (sensitive, section 8.1 of the decisions doc); receipt photos only come in when passed.
 */
export function dossierHtml(input: DossierInput): string {
  const total = input.logs.reduce((sum, l) => sum + (l.costCents ?? 0), 0);
  const count = input.logs.length;
  const late = input.logs.filter((l) => l.registeredOn > l.performedAt).length;
  const receipts = input.logs.filter((l) => l.hasReceipt).length;

  const summary = [
    count === 1 ? '1 serviço registrado' : `${count} serviços registrados`,
    `total de ${formatBRL(total)}`,
    receipts === 0 ? null : receipts === 1 ? '1 com comprovante' : `${receipts} com comprovante`,
  ]
    .filter(Boolean)
    .join(', ');

  const rows = input.logs.map((l) => {
    const registered =
      l.registeredOn === l.performedAt
        ? 'Registrado no app no mesmo dia'
        : l.registeredOn > l.performedAt
          ? `Registrado no app depois, em ${formatDate(l.registeredOn)}`
          : `Registrado no app em ${formatDate(l.registeredOn)}`;
    const tags = [
      l.hasReceipt ? '<span class="tag ok">Com comprovante</span>' : '',
      l.registeredOn > l.performedAt ? '<span class="tag">Registrado depois do serviço</span>' : '',
    ].join('');
    return `
      <section class="log">
        <div class="head">
          <h2>${escape(l.name)}</h2>
          ${l.costCents != null ? `<span class="cost">${formatBRL(l.costCents)}</span>` : ''}
        </div>
        <p>${formatDate(l.performedAt)} · ${formatKm(l.km)}</p>
        ${l.brandSpec ? `<p>${escape(l.brandSpec)}</p>` : ''}
        <p class="muted">${registered}</p>
        ${tags ? `<p>${tags}</p>` : ''}
        ${l.photo ? `<img src="data:image/jpeg;base64,${l.photo}" alt="Comprovante de ${escape(l.name)}">` : ''}
      </section>`;
  });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Histórico de manutenção: ${escape(input.nickname)}</title>
<style>
  body { font-family: sans-serif; color: #1a1a1a; margin: 32px; font-size: 13px; line-height: 1.4; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0; }
  p { margin: 2px 0; }
  .muted { color: #555; }
  .summary { margin: 16px 0 8px; padding: 12px 0; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; }
  .log { padding: 10px 0; border-bottom: 1px solid #ddd; page-break-inside: avoid; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .cost { font-weight: bold; white-space: nowrap; }
  .tag { display: inline-block; margin: 4px 6px 0 0; padding: 1px 6px; border: 1px solid #888; border-radius: 6px; font-size: 11px; }
  .tag.ok { border-color: #2d6a4f; color: #2d6a4f; }
  img { display: block; max-width: 100%; max-height: 520px; margin-top: 8px; border: 1px solid #ddd; }
  footer { margin-top: 24px; font-size: 11px; color: #555; }
</style>
</head>
<body>
  <h1>Histórico de manutenção</h1>
  <p><strong>${escape(input.nickname)}</strong>${input.model ? ` · ${escape(input.model)}` : ''}</p>
  ${input.lastReading ? `<p class="muted">Última leitura do hodômetro: ${formatKm(input.lastReading.km)} em ${formatDate(input.lastReading.readAt)}</p>` : ''}
  <p class="summary">${summary}${late > 0 ? `. ${late === 1 ? '1 registro feito' : `${late} registros feitos`} depois da data do serviço.` : '.'}</p>
  ${count === 0 ? '<p>Nenhum serviço registrado.</p>' : rows.join('')}
  <footer>
    <p>Gerado em ${formatDate(input.generatedOn)} pelo app Garagem, a partir dos registros feitos pelo dono do carro.</p>
    <p>"Registrado no app" é a data em que cada registro foi criado. Registros criados depois da data do serviço estão sinalizados. "Com comprovante" indica que há foto da nota fiscal ou etiqueta guardada no aparelho do dono${input.logs.some((l) => l.photo) ? ', e as fotos estão incluídas aqui' : ''}.</p>
  </footer>
</body>
</html>`;
}
