import React, { useState, useEffect, useCallback } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  Project, MappingEntry, Typology,
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
  tipologicoId: string;
  tipologicoLabel: string;
  supporto: string;
  tipoSupporto: string;
  attraversamento: string;
  quantity: number;
  pricePerUnit: number;
  unit: 'piece' | 'sqm';
  total: number;
  mappingEntryId: string;
}

const GROUP_LABELS: Record<GroupBy, string> = {
  floor: 'Piano',
  tipologico: 'Tipologico',
  supporto: 'Supporto',
  attraversamento: 'Attraversamento',
};

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

      // Initialize local price state
      const init: Record<string, { price: string; unit: 'piece' | 'sqm' }> = {};
      for (const lp of loadedPrices) {
        init[lp.tipologicoId] = { price: String(lp.pricePerUnit), unit: lp.unit };
      }
      setLocalPrices(init);
    };
    load();
  }, [project.id]);

  const typologyMap = React.useMemo(() => {
    const map: Record<string, Typology> = {};
    for (const t of project.typologies || []) {
      map[t.id] = t;
    }
    return map;
  }, [project.typologies]);

  const priceMap = React.useMemo(() => {
    const map: Record<string, TypologyPrice> = {};
    for (const p of prices) {
      map[p.tipologicoId] = p;
    }
    return map;
  }, [prices]);

  // Build flat list of all crossing rows
  const rows: AggregatedRow[] = React.useMemo(() => {
    const result: AggregatedRow[] = [];
    for (const entry of mappings) {
      for (const crossing of entry.crossings || []) {
        const tipologicoId = crossing.tipologicoId || '';
        const typology = tipologicoId ? typologyMap[tipologicoId] : undefined;
        const price = tipologicoId ? priceMap[tipologicoId] : undefined;
        const pricePerUnit = price?.pricePerUnit ?? 0;
        const unit = price?.unit ?? 'piece';
        const quantity = crossing.quantita ?? 1;
        result.push({
          floor: entry.floor,
          tipologicoId,
          tipologicoLabel: typology
            ? `#${typology.number} – ${typology.supporto} / ${typology.tipoSupporto}`
            : 'Senza tipologico',
          supporto: crossing.supporto || typology?.supporto || '',
          tipoSupporto: crossing.tipoSupporto || typology?.tipoSupporto || '',
          attraversamento: crossing.attraversamentoCustom || crossing.attraversamento || typology?.attraversamento || '',
          quantity,
          pricePerUnit,
          unit,
          total: pricePerUnit * quantity,
          mappingEntryId: entry.id,
        });
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
        case 'attraversamento': key = row.attraversamento || 'N/D'; break;
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return map;
  }, [rows, groupBy]);

  const formatCurrency = (n: number) =>
    n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

  const handlePriceChange = (tipologicoId: string, field: 'price' | 'unit', value: string) => {
    setLocalPrices(prev => ({
      ...prev,
      [tipologicoId]: {
        price: prev[tipologicoId]?.price ?? '0',
        unit: prev[tipologicoId]?.unit ?? 'piece',
        [field]: value,
      },
    }));
  };

  const handlePriceSave = useCallback(async (tipologicoId: string) => {
    const lp = localPrices[tipologicoId];
    if (!lp) return;
    const parsed = parseFloat(lp.price.replace(',', '.'));
    if (isNaN(parsed)) return;
    setSaving(prev => ({ ...prev, [tipologicoId]: true }));
    try {
      await upsertTypologyPrice(project.id, tipologicoId, parsed, lp.unit);
      const updated = await getTypologyPrices(project.id);
      setPrices(updated);
    } finally {
      setSaving(prev => ({ ...prev, [tipologicoId]: false }));
    }
  }, [localPrices, project.id]);

  const handleExport = () => {
    // Sheet 1: Riepilogo
    const summaryData: any[][] = [
      ['Piano', 'Tipologico', 'Supporto', 'Attraversamento', 'Quantità', 'Prezzo unit.', 'Totale'],
    ];
    for (const row of rows) {
      summaryData.push([
        row.floor,
        row.tipologicoLabel,
        row.supporto,
        row.attraversamento,
        row.quantity,
        row.pricePerUnit,
        row.total,
      ]);
    }
    summaryData.push(['', '', '', '', '', 'TOTALE', grandTotal]);

    // Sheet 2: Dettaglio (one row per mapping entry x crossing)
    const detailData: any[][] = [
      ['Progetto', 'Piano', 'Tipologico', 'ID Mappatura', 'Supporto', 'Tipo Supporto', 'Attraversamento', 'Quantità', 'Prezzo unit.', 'Unità', 'Totale'],
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
        row.quantity,
        row.pricePerUnit,
        row.unit === 'piece' ? 'al pezzo' : 'al mq',
        row.total,
      ]);
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Riepilogo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailData), 'Dettaglio');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    saveAs(blob, `costi_${project.title.replace(/\s+/g, '_')}.xlsx`);
  };

  const usedTypologyIds = Array.from(new Set(rows.map(r => r.tipologicoId).filter(Boolean)));
  const unmappedTypologies = (project.typologies || []).filter(t => !usedTypologyIds.includes(t.id));
  const allPriceTypologies = [
    ...(project.typologies || []).filter(t => usedTypologyIds.includes(t.id)),
    ...unmappedTypologies,
  ].sort((a, b) => a.number - b.number);

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
                      <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-brand-700 truncate">
                            {row.attraversamento || 'N/D'}
                          </div>
                          <div className="text-[11px] text-brand-400 truncate">
                            {row.tipologicoLabel} · ×{row.quantity}
                            {row.unit === 'sqm' ? ' mq' : ''}
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

      {/* Price management */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-100">
          <h3 className="text-sm font-bold text-brand-800">Gestione Prezzi</h3>
          <p className="text-xs text-brand-400 mt-0.5">Prezzo unitario per tipologico</p>
        </div>
        {allPriceTypologies.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-brand-500">
            Nessun tipologico configurato
          </div>
        ) : (
          <div className="divide-y divide-brand-50">
            {allPriceTypologies.map(typ => {
              const lp = localPrices[typ.id] ?? { price: '', unit: 'piece' as const };
              const isSavingNow = saving[typ.id];
              return (
                <div key={typ.id} className="px-4 py-3">
                  <div className="text-xs font-medium text-brand-700 mb-2">
                    <span className="text-accent font-bold">#{typ.number}</span>
                    {' '}{typ.supporto} / {typ.tipoSupporto}
                    <span className="text-brand-400"> · {typ.attraversamento}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center flex-1 bg-brand-50 border border-brand-200 rounded-xl overflow-hidden">
                      <span className="px-3 text-sm text-brand-500 select-none">€</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lp.price}
                        onChange={e => handlePriceChange(typ.id, 'price', e.target.value)}
                        onBlur={() => handlePriceSave(typ.id)}
                        className="flex-1 py-2 bg-transparent text-sm text-brand-800 focus:outline-none"
                        placeholder="0.00"
                      />
                    </div>
                    <select
                      value={lp.unit}
                      onChange={e => {
                        handlePriceChange(typ.id, 'unit', e.target.value);
                        // Auto-save on unit change
                        setTimeout(() => handlePriceSave(typ.id), 50);
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
