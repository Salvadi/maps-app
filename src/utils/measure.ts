// Misura unitaria di strutture e attraversamenti, per i totali per unità nel SAL.
// INVARIANTE ASOLE: il floor a 0,2 mq vive in `calcAsolaMq` (db) — qui NON va mai
// reimplementato inline. La logica asola replica 1:1 quella di CostsTab.

import { Structure, Crossing, calcAsolaMq } from '../db';
import { MeasureUnit } from '../config/units';

export interface UnitQty {
  unit: MeasureUnit;
  qty: number;
}

/**
 * Estrae un valore in mq dal campo dimensioni (testo libero).
 * Formati: "0,2mq", "0,2 mq", "0.2", ".5", "1", ecc. null se non valido.
 * (Stessa logica di CostsTab.parseDimensioniMq — fonte unica per SAL.)
 */
export function parseDimensioniMq(dimensioni?: string): number | null {
  if (!dimensioni) return null;
  const cleaned = dimensioni.replace(/mq/gi, '').trim().replace(',', '.');
  const val = parseFloat(cleaned);
  if (isNaN(val) || val <= 0) return null;
  return val;
}

/** Quantità di una struttura nella sua unità (default 'mq' = superficie totale). */
export function measureStructure(s: Structure): UnitQty {
  const unit: MeasureUnit = s.unit ?? 'mq';
  if (unit === 'ml' || unit === 'm') return { unit, qty: s.lunghezza ?? 0 };
  if (unit === 'pz') return { unit, qty: s.quantita ?? 0 };
  // mq: superficie persistita, altrimenti somma parti, altrimenti legacy base×altezza
  const mq = s.superficie
    ?? (s.parti && s.parti.length > 0
      ? s.parti.reduce((sum, p) => sum + ((p.base || 0) * (p.altezza || 0)), 0)
      : (s.base || 0) * (s.altezza || 0));
  return { unit: 'mq', qty: mq };
}

/**
 * Contributi di un attraversamento (può essere >1: riga base + eventuale asola).
 * Replica la logica di CostsTab (isAsolaType / inAsola) riusando `calcAsolaMq`.
 * NB: il campo `Crossing.unit` (Fase B) ha precedenza quando presente.
 */
export function measureCrossing(c: Crossing): UnitQty[] {
  const out: UnitQty[] = [];
  const attr = c.attraversamentoCustom || c.attraversamento || '';
  const isAsolaType = attr.toLowerCase().includes('asola') && !c.inAsola;

  if (c.unit === 'ml' || c.unit === 'm') {
    out.push({ unit: c.unit, qty: c.lunghezza ?? 0 });
  } else if (isAsolaType) {
    const parsed = parseDimensioniMq(c.dimensioni);
    const hasSize = c.asolaB && c.asolaH;
    const mq = parsed !== null ? parsed : hasSize ? calcAsolaMq(c.asolaB!, c.asolaH!) : 0.2;
    out.push({ unit: 'mq', qty: mq });
  } else {
    out.push({ unit: c.unit ?? 'pz', qty: c.quantita ?? 1 });
  }

  // L'asola aggiunge sempre una riga mq separata (floor 0,2 via calcAsolaMq).
  if (c.inAsola) {
    const hasSize = c.asolaB && c.asolaH;
    const mq = hasSize ? calcAsolaMq(c.asolaB!, c.asolaH!) : 0.2;
    out.push({ unit: 'mq', qty: mq });
  }

  return out;
}

/** Somma una lista di UnitQty raggruppando per unità, scartando i valori ≤ 0. */
export function sumByUnit(items: UnitQty[]): Partial<Record<MeasureUnit, number>> {
  const acc: Partial<Record<MeasureUnit, number>> = {};
  for (const { unit, qty } of items) {
    if (!qty || qty <= 0) continue;
    acc[unit] = (acc[unit] || 0) + qty;
  }
  return acc;
}

/** Formatta i totali per unità: "18 mq · 8 ml · 3 pz" (ordine fisso, salta zero). */
export function formatUnitTotals(totals: Partial<Record<MeasureUnit, number>>): string {
  const order: MeasureUnit[] = ['mq', 'ml', 'm', 'pz'];
  return order
    .filter(u => (totals[u] || 0) > 0)
    .map(u => `${(u === 'pz' ? Math.round(totals[u]!) : parseFloat(totals[u]!.toFixed(2)))} ${u}`)
    .join(' · ');
}
