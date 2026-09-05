// Changelog app. Voce più recente in cima.
// Regola versione: major = cambio strutturale grosso; minor = feature (reset patch a 0); patch = bug fix.
// Aggiungere una voce ad ogni push in produzione (feature o fix).
export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  description: string;
}

export const APP_CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-09-05', description: 'Ora puoi vedere la versione dell\'app e cosa è cambiato nelle ultime versioni.' },
];

export const APP_VERSION = APP_CHANGELOG[0].version;

export function getRecentChangelog(count: number = 3): ChangelogEntry[] {
  return APP_CHANGELOG.slice(0, count);
}
