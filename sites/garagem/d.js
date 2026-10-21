// The dossier link page: /d#<secret>. The secret never leaves this browser (nothing after "#"
// is sent anywhere). Its SHA-256 asks the dossier Edge Function for the sealed copy, and a key
// derived from it opens the copy here. Mirrors src/dossier-link/index.ts in the app; see
// "Fatia 5" in section 12 of decisoes_projeto_manutencao_veicular.md.

const FUNCTION_URL = 'https://bphuqkvehtmmktuyuxyc.supabase.co/functions/v1/dossier';
// Same as the app: changing either breaks every link already sent.
const FORMAT = 1;
const KEY_INFO = 'garagem/dossier/key/v1';

const MESSAGES = {
  incomplete: 'Este link está incompleto. Peça a quem enviou para mandar de novo.',
  gone: 'Este link foi desativado ou venceu. Peça um link novo a quem enviou.',
  busy: 'Muitas aberturas em pouco tempo. Tente de novo daqui a alguns minutos.',
  failed: 'Não foi possível abrir o histórico agora. Confira a internet e tente de novo.',
};

export class LinkError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function decodeSecret(fragment) {
  // 16 bytes in base64url, no padding.
  if (!/^[A-Za-z0-9_-]{22}$/.test(fragment)) throw new LinkError('incomplete');
  const b64 = fragment.replace(/-/g, '+').replace(/_/g, '/') + '==';
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The dossier page's HTML, given the part after "#" and a function that fetches the sealed copy
 * by the secret's hash (hex). Throws LinkError for a bad link and whatever the fetch throws.
 */
export async function openDossier(fragment, fetchSealed) {
  const secret = decodeSecret(fragment);
  const sealed = await fetchSealed(
    hex(new Uint8Array(await crypto.subtle.digest('SHA-256', secret))),
  );
  if (sealed[0] !== FORMAT || sealed.length <= 1 + 12 + 16) throw new LinkError('incomplete');

  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: new TextEncoder().encode(KEY_INFO),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.subarray(1, 13) },
      key,
      sealed.subarray(13),
    );
  } catch {
    // Wrong secret (a mistyped link) or tampered bytes.
    throw new LinkError('incomplete');
  }
  return new TextDecoder().decode(plain);
}

async function fetchSealed(hashHex) {
  const res = await fetch(`${FUNCTION_URL}?h=${hashHex}`, { cache: 'no-store' });
  if (res.status === 404) throw new LinkError('gone');
  if (res.status === 429) throw new LinkError('busy');
  if (!res.ok) throw new LinkError('failed');
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  try {
    const html = await openDossier(location.hash.slice(1), fetchSealed);
    // DOMParser never runs scripts, whatever the copy contains; the page CSP blocks them too.
    const page = new DOMParser().parseFromString(html, 'text/html');
    document.replaceChild(document.adoptNode(page.documentElement), document.documentElement);
  } catch (e) {
    document.getElementById('status').textContent = MESSAGES[e.code] ?? MESSAGES.failed;
  }
}

if (typeof document !== 'undefined') main();
