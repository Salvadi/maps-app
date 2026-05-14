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
  return fetch(path, { credentials: 'include', ...init });
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

/**
 * Fetch JSON con guardia content-type: evita SyntaxError quando Cloudflare cache
 * restituisce HTML per /api/me invece di JSON.
 */
export async function apiFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  const url = res.url || path;

  if (!res.ok) {
    throw new ApiResponseError(res.status, url, `API request failed with status ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const bodySnippet = (await res.text()).slice(0, 200);
    console.warn('⚠️ apiFetchJson: expected JSON got ', contentType, res.status, url, bodySnippet);
    throw new ApiNonJsonResponseError(res.status, contentType, url, bodySnippet);
  }

  return await res.json() as T;
}
