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
