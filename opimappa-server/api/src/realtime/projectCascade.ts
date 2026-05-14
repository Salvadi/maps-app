// api/src/realtime/projectCascade.ts
// Fix H4: cascade delete progetto lato server
// Nota: la cascade vera è gestita dai FK constraint Postgres.
// Questa funzione è lo stub server-side referenziato dai test.
// La cascade Dexie client-side è in src/realtime/ del PWA frontend.

import pino from 'pino';

const logger = pino();

/**
 * Gestisce l'eliminazione di un progetto lato server.
 * La cascade effettiva (righe figlie) è gestita dai FK constraint Postgres.
 * Questo export è referenziato dai test e documentato come punto di estensione.
 */
export async function handleProjectDeleteLocal(projectId: string): Promise<void> {
  // Server-side: cascade gestita da FK Postgres.
  // Questa export è referenziata dai test; la cascade Dexie reale è nel PWA src/realtime/.
  logger.info({ projectId }, '[projectCascade] progetto eliminato, FK cascade gestisce DB server');
}
