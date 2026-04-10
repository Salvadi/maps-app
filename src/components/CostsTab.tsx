import React, { useState, useEffect, useCallback } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  Project, MappingEntry, calcAsolaMq,
  getMappingEntriesForProject,
  getTypologyPrices, upsertTypologyPrice,
  TypologyPrice
} from '../db';

interface CostsTabProps {
  project: Project;
}

type GroupBy = 'floor' | 'tipologico' | 'supporto' | 'attraversamento';

interface AggregatedRow {
  floor: string;
  tipologicoLabel: string;
  supporto: string;
  tipoSupporto: string;
  attraversamento: string;      // display label
  attraversamentoKey: string;   // price lookup key
  quantity: number;
  pricePerUnit: number;
  unit: 'piece' | 'sqm';
  total: number;
  mappingEntryId: string;
  isAsola: boolean;
}

const GROUP_LABELS: Record<GroupBy, string> = {
  floor: 'Piano',
  tipologico: 'Tipologico',
  supporto: 'Supporto',
  attraversamento: 'Attraversamento',
};

const ASOLA_KEY = 'Asola';

/**
 * Tenta di estrarre un valore in mq dal campo dimensioni (testo libero).
 * Formati supportati: "0,2mq", "0,2 mq", "0.2", "0,2", "1", ".5", ecc.
 * Restituisce null se il testo non contiene un numero valido.
 */
function parseDimensioniMq(dimensioni?: string): number | null {
  if (!dimensioni) return null;
  // Remove "mq" (case-insensitive), trim whitespace, replace comma with dot
  const cleaned = dimensioni.replace(/mq/gi, '').trim().replace(',', '.');
  const val = parseFloat(cleaned);
  if (isNaN(val) || val <= 0) return null;
  return val;
}

const CostsTab: React.FC<CostsTabProps> = ({ project }) => {
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [prices, setPrices] = useState<TypologyPrice[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>('floor');
  const [localPrices, setLocalPrices] = useState<Record<string, { price: string; unit: 'piece' | 'sqm' }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = async () => {
      const [entries, loadedPrices] = await Promise.all([
        getMappingEntriesForProject(project.id),
        getTypologyPrices(project.id),
      ]);
      setMappings(entries);
      setPrices(loadedPrices);

      // Initialize local price state keyed by attraversamento string
      const init: Record<string, { price: string; unit: 'piece' | 'sqm' }> = {};
      for (const lp of loadedPrices) {
        init[lp.attraversamento] = { price: String(lp.pricePerUnit), unit: lp.unit };
      }
      setLocalPrices(init);
    };
    load();
  }, [project.id]);

  const typologyMap = React.useMemo(() => {
    const map: Record<string, { number: number; label: string }> = {};
    for (const t of project.typologies || []) {
      map[t.id] = { number: t.number, label: `#${t.number} – ${t.supporto} / ${t.tipoSupporto}` };
    }
    return map;
  }, [project.typologies]);

  // priceMap keyed by attraversamento string
  const priceMap = React.useMemo(() => {
    const map: Record<string, TypologyPrice> = {};
    for (const p of prices) {
      map[p.attraversamento] = p;
    }
    return map;
  }, [prices]);

  // Build flat list of all crossing rows
  const rows: AggregatedRow[] = React.useMemo(() => {
    const result: AggregatedRow[] = [];
    for (const entry of mappings) {
      for (const crossing of entry.crossings || []) {
        const attrDisplay = crossing.attraversamentoCustom || crossing.attraversamento || '';
        const attrKey = attrDisplay; // price key = display value

        // Detect if this crossing IS an asola type (old data: attraversamento = 'Asola',
        // no inAsola flag) vs a crossing that passes THROUGH an asola (inAsola = true)
        const isAsolaType = attrDisplay.toLowerCase().includes('asola') && !crossing.inAsola;

        const price = priceMap[isAsolaType ? ASOLA_KEY : attrKey];
        const pricePerUnit = price?.pricePerUnit ?? 0;

        let unit: 'piece' | 'sqm';
        let quantity: number;
        if (isAsolaType) {
          // Old-style asola crossing: try to parse mq from dimensioni field first,
          // then fall back to asolaB×asolaH, then 0.2 mq minimum.
          const parsedDim = parseDimensioniMq(crossing.dimensioni);
          const hasSize = crossing.asolaB && crossing.asolaH;
          quantity = parsedDim !== null
            ? parsedDim
            : hasSize ? calcAsolaMq(crossing.asolaB!, crossing.asolaH!) : 0.2;
          unit = 'sqm';
        } else {
          unit = price?.unit ?? 'piece';
          quantity = crossing.quantita ?? 1;
        }

        const tipObj = crossing.tipologicoId ? typologyMap[crossing.tipologicoId] : undefined;
        const tipologicoLabel = tipObj ? tipObj.label : 'Senza tipologico';

        result.push({
          floor: entry.floor,
          tipologicoLabel,
          supporto: crossing.supporto || '',
          tipoSupporto: crossing.tipoSupporto || '',
          attraversamento: attrDisplay,
          attraversamentoKey: isAsolaType ? ASOLA_KEY : attrKey,
          quantity,
          pricePerUnit,
          unit,
          total: pricePerUnit * quantity,
          mappingEntryId: entry.id,
          isAsola: isAsolaType,
        });

        // Separate asola row — only for NEW crossings with inAsola flag
        // (atraversamento is something else, e.g. a pipe passing through a slot)
        if (crossing.inAsola) {
          const hasSize = crossing.asolaB && crossing.asolaH;
          const asolaMq = hasSize
            ? calcAsolaMq(crossing.asolaB!, crossing.asolaH!)
            : 0.2;
          const asolaLabel = hasSize
            ? `Asola (${crossing.asolaB}×${crossing.asolaH} cm)`
            : 'Asola (dim. n.d.)';

          const asolaPrice = priceMap[ASOLA_KEY];
          const asolaPricePerUnit = asolaPrice?.pricePerUnit ?? 0;

          result.push({
            floor: entry.floor,
            tipologicoLabel: 'Asola',
            supporto: crossing.supporto || '',
            tipoSupporto: crossing.tipoSupporto || '',
            attraversamento: asolaLabel,
            attraversamentoKey: ASOLA_KEY,
            quantity: asolaMq,
            pricePerUnit: asolaPricePerUnit,
            unit: 'sqm',
            total: asolaPricePerUnit * asolaMq,
            mappingEntryId: entry.id,
            isAsola: true,
          });
        }
      }
    }
    return result;
  }, [mappings, typologyMap, priceMap]);

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  // Group rows by selected dimension
  const grouped = React.useMemo(() => {
    const map = new Map<string, AggregatedRow[]>();
    for (const row of rows) {
      let key: string;
      switch (groupBy) {
        case 'floor': key = row.floor; break;
        case 'tipologico': key = row.tipologicoLabel; break;
        case 'supporto': key = row.supporto || 'N/D'; break;
        case 'attraversamento': key = row.attraversamentoKey || 'N/D'; break;
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return map;
  }, [rows, groupBy]);

  const formatCurrency = (n: number) =>
    n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

  // Unique attraversamento keys across all crossings (for price management panel)
  const uniqueAttrKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const entry of mappings) {
      for (const crossing of entry.crossings || []) {
        const key = crossing.attraversamentoCustom || crossing.attraversamento || '';
        if (key) keys.add(key);
        if (crossing.inAsola) keys.add(ASOLA_KEY);
      }
    }
    return Array.from(keys).sort();
  }, [mappings]);

  const handlePriceChange = (key: string, field: 'price' | 'unit', value: string) => {
    setLocalPrices(prev => ({
      ...prev,
      [key]: {
        price: prev[key]?.price ?? '0',
        unit: prev[key]?.unit ?? 'piece',
        [field]: value,
      },
    }));
  };

  const handlePriceSave = useCallback(async (key: string) => {
    const lp = localPrices[key];
    if (!lp) return;
    const parsed = parseFloat(lp.price.replace(',', '.'));
    if (isNaN(parsed)) return;
    setSaving(prev => ({ ...prev, [key]: true }));
    try {
      await upsertTypologyPrice(project.id, key, parsed, lp.unit);
      const updated = await getTypologyPrices(project.id);
      setPrices(updated);
    } finally {
      setSaving(prev => ({ ...prev, [key]: false }));
    }
  }, [localPrices, project.id]);

  const handleExport = () => {
    // Sheet 1: Riepilogo
    const summaryData: any[][] = [
      ['Piano', 'Tipologico', 'Supporto', 'Attraversamento', 'Quantità', 'Unità', 'Prezzo unit.', 'Totale'],
    ];
    for (const row of rows) {
      summaryData.push([
        row.floor,
        row.tipologicoLabel,
        row.supporto,
        row.attraversamento,
        row.unit === 'sqm' ? row.quantity.toFixed(2) : row.quantity,
        row.unit === 'piece' ? 'pz' : 'mq',
        row.pricePerUnit,
        row.total,
      ]);
    }
    summaryData.push(['', '', '', '', '', '', 'TOTALE', grandTotal]);

    // Sheet 2: Dettaglio
    const detailData: any[][] = [
      ['Progetto', 'Piano', 'Tipologico', 'ID Mappatura', 'Supporto', 'Tipo Supporto', 'Attraversamento', 'Quantità', 'Unità', 'Prezzo unit.', 'Totale'],
    ];
    for (const row of rows) {
      detailData.push([
        project.title,
        row.floor,
        row.tipologicoLabel,
        row.mappingEntryId,
        row.supporto,
        row.tipoSupporto,
        row.attraversamento,
        row.unit === 'sqm' ? row.quantity.toFixed(2) : row.quantity,
        row.unit === 'piece' ? 'pz' : 'mq',
        row.pricePerUnit,
        row.total,
      ]);
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Riepilogo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailData), 'Dettaglio');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    saveAs(blob, `contabilita_${project.title.replace(/\s+/g, '_')}.xlsx`);
  };

  return (
    <div className="px-4 pt-4 pb-24 space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-brand-500 font-medium">Raggruppa per</span>
          <div className="relative">
            <select
              value={groupBy}
              onChange={e => setGroupBy(e.target.value as GroupBy)}
              className="appearance-none text-xs font-semibold text-accent bg-accent/10 pl-3 pr-7 py-1.5 rounded-full border-0 focus:outline-none"
            >
              {(Object.keys(GROUP_LABELS) as GroupBy[]).map(k => (
                <option key={k} value={k}>{GROUP_LABELS[k]}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
          </div>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 text-xs font-semibold text-accent bg-accent/10 px-3 py-1.5 rounded-full active:scale-95 transition-transform"
        >
          <Download size={13} />
          Esporta
        </button>
      </div>

      {/* Summary table */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-100">
          <h3 className="text-sm font-bold text-brand-800">Riepilogo Attraversamenti</h3>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-brand-500">
            Nessun attraversamento registrato
          </div>
        ) : (
          <>
            {Array.from(grouped.entries()).map(([groupKey, groupRows]) => {
              const groupTotal = groupRows.reduce((s, r) => s + r.total, 0);
              return (
                <div key={groupKey} className="border-b border-brand-50 last:border-0">
                  <div className="px-4 py-2 bg-brand-50">
                    <span className="text-xs font-bold text-brand-700 uppercase tracking-wide">
                      {GROUP_LABELS[groupBy]}: {groupKey}
                    </span>
                  </div>
                  <div className="divide-y divide-brand-50">
                    {groupRows.map((row, i) => (
                      <div key={i} className={`px-4 py-2.5 flex items-center justify-between gap-2 ${row.isAsola ? 'pl-8 bg-warning/5' : ''}`}>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-brand-700 truncate">
                            {row.isAsola ? <span className="text-warning">↳ </span> : null}
                            {row.attraversamento || 'N/D'}
                          </div>
                          <div className="text-[11px] text-brand-400 truncate">
                            {row.tipologicoLabel} · {row.unit === 'sqm' ? `${row.quantity.toFixed(2)} mq` : `×${row.quantity}`}
                          </div>
                        </div>
                        <div className="text-xs font-semibold text-brand-800 flex-shrink-0">
                          {row.pricePerUnit > 0 ? formatCurrency(row.total) : '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-2.5 bg-brand-50/50 flex justify-between">
                    <span className="text-xs font-bold text-brand-600">
                      TOTALE {GROUP_LABELS[groupBy].toUpperCase()}
                    </span>
                    <span className="text-xs font-bold text-brand-800">
                      {groupTotal > 0 ? formatCurrency(groupTotal) : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
            {/* Grand total */}
            <div className="px-4 py-3.5 flex justify-between bg-accent/5">
              <span className="text-sm font-bold text-brand-800">TOTALE PROGETTO</span>
              <span className="text-sm font-bold text-accent">
                {grandTotal > 0 ? formatCurrency(grandTotal) : '—'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Price management — per attraversamento type */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-100">
          <h3 className="text-sm font-bold text-brand-800">Gestione Prezzi</h3>
          <p className="text-xs text-brand-400 mt-0.5">Prezzo unitario per tipo di attraversamento</p>
        </div>
        {uniqueAttrKeys.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-brand-500">
            Nessun attraversamento registrato
          </div>
        ) : (
          <div className="divide-y divide-brand-50">
            {uniqueAttrKeys.map(key => {
              const lp = localPrices[key] ?? { price: '', unit: (key === ASOLA_KEY ? 'sqm' : 'piece') as 'piece' | 'sqm' };
              const isSavingNow = saving[key];
              return (
                <div key={key} className="px-4 py-3">
                  <div className="text-xs font-medium text-brand-700 mb-2">
                    {key === ASOLA_KEY
                      ? <span className="text-warning font-bold">Asola</span>
                      : key
                    }
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center flex-1 bg-brand-50 border border-brand-200 rounded-xl overflow-hidden">
                      <span className="px-3 text-sm text-brand-500 select-none">€</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lp.price}
                        onChange={e => handlePriceChange(key, 'price', e.target.value)}
                        onBlur={() => handlePriceSave(key)}
                        className="flex-1 py-2 bg-transparent text-sm text-brand-800 focus:outline-none"
                        placeholder="0.00"
                      />
                    </div>
                    <select
                      value={lp.unit}
                      onChange={e => {
                        handlePriceChange(key, 'unit', e.target.value);
                        setTimeout(() => handlePriceSave(key), 50);
                      }}
                      className="bg-brand-50 border border-brand-200 rounded-xl text-xs text-brand-700 px-2.5 py-2 focus:outline-none"
                    >
                      <option value="piece">al pezzo</option>
                      <option value="sqm">al mq</option>
                    </select>
                    {isSavingNow && (
                      <span className="text-[11px] text-brand-400">salvo...</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CostsTab;
