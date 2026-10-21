// The public side of the dossier link. The link is https://…/d#<secret>: browsers never send
// what follows the "#", so this function only ever sees the SHA-256 of the secret, and hands
// back the copy the phone sealed with a key derived from that secret. See "Fatia 5" in
// section 12 of decisoes_projeto_manutencao_veicular.md.

/** The sealed copy behind a live link, or null; throws RateLimited past the opens limit. */
export type OpenDossier = (tokenHash: Uint8Array, client: string) => Promise<Uint8Array | null>;

export class RateLimited extends Error {}

// Matches the window in public.open_dossier.
const RETRY_AFTER_SECONDS = '600';

// GET /dossier?h=<64 hex chars> -> the sealed bytes, 404 for an unknown, deleted or expired
// link, 429 past the limit.
export async function handleDossier(req: Request, open: OpenDossier): Promise<Response> {
  if (req.method !== 'GET') return error('method_not_allowed', 405);

  const h = new URL(req.url).searchParams.get('h') ?? '';
  if (!/^[0-9a-f]{64}$/.test(h)) return error('bad_request', 400);

  let sealed: Uint8Array | null;
  try {
    sealed = await open(fromHex(h), await clientKey(req));
  } catch (e) {
    if (!(e instanceof RateLimited)) throw e;
    return error('rate_limited', 429, { 'Retry-After': RETRY_AFTER_SECONDS });
  }
  if (!sealed) return error('not_found', 404);

  return new Response(sealed.slice().buffer, {
    headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
  });
}

// no-store everywhere: a deleted link must stop working at once, not when a cache expires.
function error(code: string, status: number, headers: Record<string, string> = {}) {
  return Response.json(
    { error: code },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );
}

// The rate-limit key: a SHA-256 of the caller's IP, so the IP itself is never stored.
// shortcut: trusts the first x-forwarded-for entry, which a caller could forge to dodge the
// limit; switch to the platform's own client-IP header if abuse shows up. The secret's 128 bits
// make guessing links pointless either way.
export async function clientKey(req: Request): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))));
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
