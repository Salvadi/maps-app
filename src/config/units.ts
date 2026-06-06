// Unità di misura assegnabili alle voci dropdown (Struttura / Attraversamento).
// L'unità guida i campi input nei wizard e i totali nel SAL.
// NB: i pezzi singoli mostrano SEMPRE "pz" nell'UI (mai "cad").

export type MeasureUnit = 'mq' | 'ml' | 'm' | 'pz';

export const MEASURE_UNITS: MeasureUnit[] = ['mq', 'ml', 'm', 'pz'];

// Etichetta mostrata all'utente (identica al valore: mq, ml, m, pz).
export function unitLabel(unit: MeasureUnit): string {
  return unit;
}

// Opzioni per i <select> di scelta unità.
export const UNIT_OPTIONS: { value: MeasureUnit; label: string }[] =
  MEASURE_UNITS.map(u => ({ value: u, label: unitLabel(u) }));

// Type guard: normalizza un valore sconosciuto (es. da DB) a MeasureUnit | undefined.
export function asMeasureUnit(value: unknown): MeasureUnit | undefined {
  return typeof value === 'string' && (MEASURE_UNITS as string[]).includes(value)
    ? (value as MeasureUnit)
    : undefined;
}

// Unità di default per categoria, per preservare il comportamento storico
// (struttura = superficie in mq; attraversamento = conteggio pezzi).
export function defaultUnitForCategory(category: string): MeasureUnit {
  return category === 'attraversamento' ? 'pz' : 'mq';
}

// Normalizza i valori unità legacy dei prezzi ('piece'->'pz', 'sqm'->'mq')
// verso MeasureUnit. Usato leggendo typology_prices storici.
export function legacyToUnit(value: string | undefined | null, fallback: MeasureUnit = 'pz'): MeasureUnit {
  if (value === 'piece') return 'pz';
  if (value === 'sqm') return 'mq';
  return asMeasureUnit(value) ?? fallback;
}
