/**
 * homeserver.ts — helper condiviso per le chiamate all'API homeserver.
 * Tutte le richieste usano credenziali SameSite=Lax (cookie __Host-opimappa-*).
 */

/**
 * Indica se il backend homeserver è disponibile.
 * // Sempre true: API homeserver è same-origin
 */
export function isHomeserverConfigured(): boolean {
  // Sempre true: API homeserver è same-origin
  return true;
}

/**
 * Wrapper fetch per le chiamate all'API homeserver.
 * Usa percorsi relativi: nessuna trasformazione di base URL necessaria (same-origin).
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  // cache: 'no-store' OBBLIGATORIO: senza, browser/edge (Cloudflare cacha /api,
  // vedi apiFetchJson) possono servire una GET /api/* stantia. Bug concreto:
  // /api/floor_plans cachato con un image_url ormai sostituito reintroduceva
  // l'url morto in Dexie via download handler -> editor planimetria 404 a
  // intermittenza. Override esplicito possibile passando init.cache.
  return fetch(path, { credentials: 'include', cache: 'no-store', ...init });
}

export class ApiResponseError extends Error {
  constructor(public status: number, public url: string, message: string) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

export class ApiNonJsonResponseError extends Error {
  constructor(
    public status: number,
    public contentType: string,
    public url: string,
    public bodySnippet: string
  ) {
    super(`Expected JSON response, got ${contentType || 'missing content-type'} from ${url}`);
    this.name = 'ApiNonJsonResponseError';
  }
}

// Retry transient su 502/503/504 — gestisce hiccup cloudflared/Caddy edge.
const RETRY_STATUS = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [200, 500, 1000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch JSON con guardia content-type + retry su 5xx transient.
 * Evita SyntaxError quando Cloudflare cache restituisce HTML per /api/me.
 * Retry esponenziale (200/500/1000ms) per 502/503/504 (cloudflared/edge instabile).
 */
export async function apiFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let lastRes: Response | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const res = await apiFetch(path, init);
    lastRes = res;

    if (res.ok) {
      const url = res.url || path;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const bodySnippet = (await res.text()).slice(0, 200);
        console.warn('⚠️ apiFetchJson: expected JSON got ', contentType, res.status, url, bodySnippet);
        throw new ApiNonJsonResponseError(res.status, contentType, url, bodySnippet);
      }
      return await res.json() as T;
    }

    if (!RETRY_STATUS.has(res.status) || attempt === RETRY_DELAYS_MS.length) {
      break;
    }

    const delay = RETRY_DELAYS_MS[attempt];
    console.warn(`⚠️ apiFetchJson ${res.status} su ${path}, retry ${attempt + 1}/${RETRY_DELAYS_MS.length} fra ${delay}ms`);
    await sleep(delay);
  }

  const finalRes = lastRes!;
  const url = finalRes.url || path;
  throw new ApiResponseError(finalRes.status, url, `API request failed with status ${finalRes.status}`);
}
