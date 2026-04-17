import React, { useState, useEffect, useCallback } from 'react';
import { Download, ChevronDown, Plus, Trash2, X, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  Project, MappingEntry, User, Sal, calcAsolaMq,
  getMappingEntriesForProject,
  getTypologyPrices, upsertTypologyPrice,
  TypologyPrice,
  getSalsForProject, createSal, assignCrossingsToSal, deleteSal,
} from '../db';

interface CostsTabProps {
  project: Project;
  currentUser: User;
}

type GroupBy = 'floor' | 'tipologico' | 'supporto' | 'attraversamento';

interface AggregatedRow {
  floor: string;
  tipologicoId?: string;
  tipologicoLabel: string;
  supporto: string;
  tipoSupporto: string;
  attraversamento: string;      // display label
  attraversamentoKey: string;   // grouping key
  priceConfigKey: string;       // form/save key
  quantity: number;
  pricePerUnit: number;
  unit: 'piece' | 'sqm';
  total: number;
  mappingEntryId: string;
  crossingId: string;
  salId?: string;
  isAsola: boolean;
  toComplete: boolean;
}

const GROUP_LABELS: Record<GroupBy, string> = {
  floor: 'Piano',
  tipologico: 'Tipologico',
  supporto: 'Supporto',
  attraversamento: 'Attraversamento',
};

const ASOLA_KEY = 'Asola';
const NO_TIPOLOGICO_KEY = '__none__';

function buildPriceConfigKey(attraversamento: string, tipologicoId?: string): string {
  return `${attraversamento}::${tipologicoId ?? NO_TIPOLOGICO_KEY}`;
}

function joinLabelParts(parts: Array<string | undefined>): string {
  return parts.map(part => part?.trim()).filter(Boolean).join(' · ');
}

function formatTypologyMaterials(brand?: string, products?: string[]): string {
  const items = [
    brand?.trim(),
    ...(products ?? []).map(product => product.trim()).filter(Boolean),
  ];

  return items.join(', ');
}

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

const MONTH_NAMES = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

const CostsTab: React.FC<CostsTabProps> = ({ project, currentUser }) => {
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [prices, setPrices] = useState<TypologyPrice[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>('floor');
  const [localPrices, setLocalPrices] = useState<Record<string, { price: string; unit: 'piece' | 'sqm' }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // SAL state
  const [sals, setSals] = useState<Sal[]>([]);
  const [selectedSalId, setSelectedSalId] = useState<string>('all');
  const [showCreateSalModal, setShowCreateSalModal] = useState(false);
  const [isCreatingSal, setIsCreatingSal] = useState(false);
  const [salName, setSalName] = useState('');
  const [salDate, setSalDate] = useState('');
  const [salNotes, setSalNotes] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const loadData = useCallback(async () => {
    const [entries, loadedPrices, loadedSals] = await Promise.all([
      getMappingEntriesForProject(project.id),
      getTypologyPrices(project.id),
      getSalsForProject(project.id),
    ]);
    setMappings(entries);
    setPrices(loadedPrices);
    setSals(loadedSals);

    // Initialize local price state keyed by form row (attraversamento + tipologico).
    const init: Record<string, { price: string; unit: 'piece' | 'sqm' }> = {};
    for (const lp of loadedPrices) {
      const priceKey = lp.tipologicoId
        ? buildPriceConfigKey(lp.attraversamento, lp.tipologicoId)
        : lp.attraversamento === ASOLA_KEY
          ? ASOLA_KEY
          : buildPriceConfigKey(lp.attraversamento);
      init[priceKey] = { price: String(lp.pricePerUnit), unit: lp.unit };
    }
    setLocalPrices(init);
  }, [project.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const typologyMap = React.useMemo(() => {
    const map: Record<string, {
      number: number;
      supporto: string;
      materialsLabel: string;
      listLabel: string;
      priceFormLabel: string;
    }> = {};
    for (const t of project.typologies || []) {
      const materialsLabel = formatTypologyMaterials(t.marcaProdottoUtilizzato, t.prodottiSelezionati);
      map[t.id] = {
        number: t.number,
        supporto: t.supporto,
        materialsLabel,
        listLabel: joinLabelParts([`Tip. ${t.number}`, t.supporto, materialsLabel]) || `Tip. ${t.number}`,
        priceFormLabel: joinLabelParts([
          t.attraversamentoCustom || t.attraversamento,
          t.supporto,
          materialsLabel,
        ]) || (t.attraversamentoCustom || t.attraversamento),
      };
    }
    return map;
  }, [project.typologies]);

  const { genericPriceMap, specificPriceMap } = React.useMemo(() => {
    const generic: Record<string, TypologyPrice> = {};
    const specific: Record<string, TypologyPrice> = {};
    for (const p of prices) {
      if (p.tipologicoId) {
        specific[buildPriceConfigKey(p.attraversamento, p.tipologicoId)] = p;
      } else {
        generic[p.attraversamento] = p;
      }
    }
    return {
      genericPriceMap: generic,
      specificPriceMap: specific,
    };
  }, [prices]);

  // Build flat list of all crossing rows (with salId + crossingId)
  const rows: AggregatedRow[] = React.useMemo(() => {
    const result: AggregatedRow[] = [];
    for (const entry of mappings) {
      for (const crossing of entry.crossings || []) {
        const attrDisplay = crossing.attraversamentoCustom || crossing.attraversamento || '';
        const attrKey = attrDisplay; // price key = display value

        const isAsolaType = attrDisplay.toLowerCase().includes('asola') && !crossing.inAsola;
        const priceConfigKey = isAsolaType
          ? ASOLA_KEY
          : buildPriceConfigKey(attrKey, crossing.tipologicoId);

        const price = isAsolaType
          ? genericPriceMap[ASOLA_KEY]
          : specificPriceMap[priceConfigKey] ?? genericPriceMap[attrKey];
        const pricePerUnit = price?.pricePerUnit ?? 0;

        let unit: 'piece' | 'sqm';
        let quantity: number;
        if (isAsolaType) {
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
        const tipologicoLabel = tipObj ? tipObj.listLabel : 'Senza tipologico';

        result.push({
          floor: entry.floor,
          tipologicoId: crossing.tipologicoId,
          tipologicoLabel,
          supporto: crossing.supporto || '',
          tipoSupporto: crossing.tipoSupporto || '',
          attraversamento: attrDisplay,
          attraversamentoKey: isAsolaType ? ASOLA_KEY : attrKey,
          priceConfigKey,
          quantity,
          pricePerUnit,
          unit,
          total: pricePerUnit * quantity,
          mappingEntryId: entry.id,
          crossingId: crossing.id,
          salId: crossing.salId,
          isAsola: isAsolaType,
          toComplete: entry.toComplete || false,
        });

        if (crossing.inAsola) {
          const hasSize = crossing.asolaB && crossing.asolaH;
          const asolaMq = hasSize
            ? calcAsolaMq(crossing.asolaB!, crossing.asolaH!)
            : 0.2;
          const asolaLabel = hasSize
            ? `Asola (${crossing.asolaB}×${crossing.asolaH} cm)`
            : 'Asola (dim. n.d.)';

          const asolaPrice = genericPriceMap[ASOLA_KEY];
          const asolaPricePerUnit = asolaPrice?.pricePerUnit ?? 0;

          result.push({
            floor: entry.floor,
            tipologicoLabel: 'Asola',
            supporto: crossing.supporto || '',
            tipoSupporto: crossing.tipoSupporto || '',
            attraversamento: asolaLabel,
            attraversamentoKey: ASOLA_KEY,
            priceConfigKey: ASOLA_KEY,
            quantity: asolaMq,
            pricePerUnit: asolaPricePerUnit,
            unit: 'sqm',
            total: asolaPricePerUnit * asolaMq,
            mappingEntryId: entry.id,
            crossingId: crossing.id + '_asola',
            salId: crossing.salId,
            isAsola: true,
            toComplete: entry.toComplete || false,
          });
        }
      }
    }
    return result;
  }, [genericPriceMap, mappings, specificPriceMap, typologyMap]);

  // Filtered rows based on SAL selection
  const filteredRows = React.useMemo(() => {
    if (selectedSalId === 'all') return rows;
    if (selectedSalId === 'unassigned') return rows.filter(r => !r.salId);
    return rows.filter(r => r.salId === selectedSalId);
  }, [rows, selectedSalId]);

  const grandTotal = filteredRows.reduce((s, r) => s + r.total, 0);

  // Cumulative total from prior SALs (only when viewing a specific SAL)
  const selectedSal = React.useMemo(
    () => sals.find(s => s.id === selectedSalId),
    [sals, selectedSalId]
  );

  const cumulativePriorTotal = React.useMemo(() => {
    if (!selectedSal) return 0;
    const priorSalIds = new Set(sals.filter(s => s.number < selectedSal.number).map(s => s.id));
    return rows.filter(r => r.salId && priorSalIds.has(r.salId)).reduce((s, r) => s + r.total, 0);
  }, [selectedSal, sals, rows]);

  // Unassigned rows count/total for create SAL preview
  const unassignedRows = React.useMemo(() => rows.filter(r => !r.salId), [rows]);
  const unassignedTotal = unassignedRows.reduce((s, r) => s + r.total, 0);

  // Group rows by selected dimension
  const grouped = React.useMemo(() => {
    const map = new Map<string, AggregatedRow[]>();
    for (const row of filteredRows) {
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
  }, [filteredRows, groupBy]);

  const formatCurrency = (n: number) =>
    n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

  const priceFormRows = React.useMemo(() => {
    const uniqueRows = new Map<string, {
      key: string;
      attraversamento: string;
      tipologicoId?: string;
      tipologicoLabel: string;
      isAsola: boolean;
      defaultUnit: 'piece' | 'sqm';
    }>();

    for (const entry of mappings) {
      for (const crossing of entry.crossings || []) {
        const attraversamento = crossing.attraversamentoCustom || crossing.attraversamento || '';
        if (attraversamento) {
          const tipObj = crossing.tipologicoId ? typologyMap[crossing.tipologicoId] : undefined;
          const key = buildPriceConfigKey(attraversamento, crossing.tipologicoId);
          if (!uniqueRows.has(key)) {
            uniqueRows.set(key, {
              key,
              attraversamento,
              tipologicoId: crossing.tipologicoId,
              tipologicoLabel: tipObj?.priceFormLabel || joinLabelParts([attraversamento, crossing.supporto]) || attraversamento,
              isAsola: false,
              defaultUnit: 'piece',
            });
          }
        }

        if (crossing.inAsola && !uniqueRows.has(ASOLA_KEY)) {
          uniqueRows.set(ASOLA_KEY, {
            key: ASOLA_KEY,
            attraversamento: ASOLA_KEY,
            tipologicoLabel: 'Prezzo generale asola',
            isAsola: true,
            defaultUnit: 'sqm',
          });
        }
      }
    }

    return Array.from(uniqueRows.values()).sort((a, b) => {
      if (a.isAsola !== b.isAsola) return a.isAsola ? 1 : -1;
      return a.attraversamento.localeCompare(b.attraversamento, 'it');
    });
  }, [mappings, typologyMap]);

  const priceFormMap = React.useMemo(() => {
    const map = new Map<string, typeof priceFormRows[number]>();
    for (const row of priceFormRows) {
      map.set(row.key, row);
    }
    return map;
  }, [priceFormRows]);

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
    const priceRow = priceFormMap.get(key);
    if (!lp || !priceRow) return;
    const parsed = parseFloat(lp.price.replace(',', '.'));
    if (isNaN(parsed)) return;
    setSaving(prev => ({ ...prev, [key]: true }));
    try {
      await upsertTypologyPrice(
        project.id,
        priceRow.attraversamento,
        parsed,
        lp.unit,
        priceRow.isAsola ? undefined : priceRow.tipologicoId
      );
      const updated = await getTypologyPrices(project.id);
      setPrices(updated);
    } finally {
      setSaving(prev => ({ ...prev, [key]: false }));
    }
  }, [localPrices, priceFormMap, project.id]);

  const handleExport = () => {
    const exportRows = filteredRows;
    const exportTotal = grandTotal;

    // Sheet 1: Riepilogo
    const summaryData: any[][] = [];

    // Se stiamo esportando un SAL specifico, aggiungi header
    if (selectedSal) {
      summaryData.push(['Progetto', project.title]);
      summaryData.push(['SAL', `SAL ${selectedSal.number}${selectedSal.name ? ' — ' + selectedSal.name : ''}`]);
      summaryData.push(['Data', new Date(selectedSal.date).toLocaleDateString('it-IT')]);
      summaryData.push([]);
    }

    summaryData.push(
      ['Piano', 'Tipologico', 'Supporto', 'Attraversamento', 'Quantità', 'Unità', 'Prezzo unit.', 'Totale'],
    );
    for (const row of exportRows) {
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
    summaryData.push(['', '', '', '', '', '', 'TOTALE', exportTotal]);

    if (selectedSal) {
      summaryData.push([]);
      summaryData.push(['', '', '', '', '', '', 'Cumulativo precedenti', cumulativePriorTotal]);
      summaryData.push(['', '', '', '', '', '', 'TOTALE PROGETTO', cumulativePriorTotal + exportTotal]);
    }

    // Sheet 2: Dettaglio
    const detailData: any[][] = [
      ['Progetto', 'Piano', 'Tipologico', 'ID Mappatura', 'Supporto', 'Tipo Supporto', 'Attraversamento', 'Quantità', 'Unità', 'Prezzo unit.', 'Totale'],
    ];
    for (const row of exportRows) {
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

    const filename = selectedSal
      ? `SAL_${selectedSal.number}_${project.title.replace(/\s+/g, '_')}.xlsx`
      : `contabilita_${project.title.replace(/\s+/g, '_')}.xlsx`;
    saveAs(blob, filename);
  };

  // ---- SAL handlers ----

  const openCreateSalModal = () => {
    const nextNumber = sals.length > 0 ? Math.max(...sals.map(s => s.number)) + 1 : 1;
    const now = new Date();
    const monthName = MONTH_NAMES[now.getMonth()];
    setSalName(`SAL ${nextNumber} — ${monthName} ${now.getFullYear()}`);
    setSalDate(now.toISOString().split('T')[0]);
    setSalNotes('');
    setShowCreateSalModal(true);
  };

  const handleCreateSal = async () => {
    if (isCreatingSal) return;
    setIsCreatingSal(true);
    try {
      const dateTs = new Date(salDate).getTime();
      const newSal = await createSal(project.id, salName || undefined, dateTs, salNotes || undefined);
      await assignCrossingsToSal(project.id, newSal.id, currentUser.id);
      await loadData();
      setSelectedSalId(newSal.id);
      setShowCreateSalModal(false);
    } finally {
      setIsCreatingSal(false);
    }
  };

  const handleDeleteSal = async () => {
    if (!selectedSal) return;
    await deleteSal(selectedSal.id, project.id, currentUser.id);
    setSelectedSalId('all');
    setShowDeleteConfirm(false);
    await loadData();
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

      {/* SAL selector row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-brand-500 font-medium">Vista SAL</span>
        <div className="relative">
          <select
            value={selectedSalId}
            onChange={e => setSelectedSalId(e.target.value)}
            className="appearance-none text-xs font-semibold text-accent bg-accent/10 pl-3 pr-7 py-1.5 rounded-full border-0 focus:outline-none"
          >
            <option value="all">Tutto</option>
            <option value="unassigned">Non contabilizzato</option>
            {sals.map(s => (
              <option key={s.id} value={s.id}>
                SAL {s.number}{s.name ? ` — ${s.name}` : ''}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
        </div>

        <button
          onClick={openCreateSalModal}
          disabled={unassignedRows.length === 0}
          className="flex items-center gap-1 text-xs font-semibold text-white bg-accent px-3 py-1.5 rounded-full active:scale-95 transition-transform disabled:opacity-40 disabled:pointer-events-none"
        >
          <Plus size={13} />
          Crea SAL
        </button>

        {selectedSal && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1 text-xs font-semibold text-danger bg-danger/10 px-3 py-1.5 rounded-full active:scale-95 transition-transform"
          >
            <Trash2 size={13} />
            Elimina
          </button>
        )}
      </div>

      {/* Summary table */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-100">
          <h3 className="text-sm font-bold text-brand-800">
            {selectedSal
              ? `SAL ${selectedSal.number}${selectedSal.name ? ` — ${selectedSal.name}` : ''}`
              : 'Riepilogo Attraversamenti'
            }
          </h3>
          {selectedSal && (
            <p className="text-xs text-brand-400 mt-0.5">
              {new Date(selectedSal.date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
        {filteredRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-brand-500">
            {selectedSalId === 'unassigned'
              ? 'Tutti gli attraversamenti sono già contabilizzati in un SAL'
              : 'Nessun attraversamento registrato'
            }
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
                          <div className="flex items-center gap-1.5 text-xs font-medium text-brand-700">
                            {row.isAsola ? <span className="text-warning flex-shrink-0">↳ </span> : null}
                            <span className="truncate">{row.attraversamento || 'N/D'}</span>
                            {row.toComplete && (
                              <span className="flex-shrink-0 flex items-center gap-0.5 text-[10px] font-semibold text-warning bg-warning/10 px-1.5 py-0.5 rounded-full">
                                <AlertTriangle size={9} />
                                da completare
                              </span>
                            )}
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
              <span className="text-sm font-bold text-brand-800">
                {selectedSal ? `TOTALE SAL ${selectedSal.number}` : 'TOTALE PROGETTO'}
              </span>
              <span className="text-sm font-bold text-accent">
                {grandTotal > 0 ? formatCurrency(grandTotal) : '—'}
              </span>
            </div>

            {/* Cumulative totals (only for specific SAL view) */}
            {selectedSal && (
              <>
                <div className="px-4 py-2.5 flex justify-between border-t border-brand-100">
                  <span className="text-xs text-brand-500">
                    Cumulativo SAL precedenti
                  </span>
                  <span className="text-xs font-semibold text-brand-600">
                    {cumulativePriorTotal > 0 ? formatCurrency(cumulativePriorTotal) : '—'}
                  </span>
                </div>
                <div className="px-4 py-2.5 flex justify-between bg-accent/10">
                  <span className="text-xs font-bold text-brand-800">
                    TOTALE COMPLESSIVO
                  </span>
                  <span className="text-xs font-bold text-accent">
                    {(grandTotal + cumulativePriorTotal) > 0 ? formatCurrency(grandTotal + cumulativePriorTotal) : '—'}
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Price management — per attraversamento + tipologico */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-100">
          <h3 className="text-sm font-bold text-brand-800">Gestione Prezzi</h3>
          <p className="text-xs text-brand-400 mt-0.5">Prezzo unitario per attraversamento e tipologico di sigillatura</p>
        </div>
        {priceFormRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-brand-500">
            Nessun attraversamento registrato
          </div>
        ) : (
          <div className="divide-y divide-brand-50">
            {priceFormRows.map(row => {
              const effectivePrice = row.isAsola
                ? genericPriceMap[ASOLA_KEY]
                : specificPriceMap[row.key] ?? genericPriceMap[row.attraversamento];
              const lp = localPrices[row.key] ?? {
                price: effectivePrice ? String(effectivePrice.pricePerUnit) : '',
                unit: effectivePrice?.unit ?? row.defaultUnit,
              };
              const isSavingNow = saving[row.key];
              return (
                <div key={row.key} className="px-4 py-3">
                  <div className="text-xs font-medium text-brand-700 mb-2">
                    {row.isAsola
                      ? <span className="text-warning font-bold">Asola</span>
                      : row.attraversamento
                    }
                  </div>
                  {!row.isAsola && (
                    <div className="text-[11px] text-brand-400 mb-2">
                      Sigillato con: {row.tipologicoLabel}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center flex-1 bg-brand-50 border border-brand-200 rounded-xl overflow-hidden">
                      <span className="px-3 text-sm text-brand-500 select-none">€</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={lp.price}
                        onChange={e => handlePriceChange(row.key, 'price', e.target.value)}
                        onBlur={() => handlePriceSave(row.key)}
                        className="flex-1 py-2 bg-transparent text-sm text-brand-800 focus:outline-none"
                        placeholder="0.00"
                      />
                    </div>
                    <select
                      value={lp.unit}
                      onChange={e => {
                        handlePriceChange(row.key, 'unit', e.target.value);
                        setTimeout(() => handlePriceSave(row.key), 50);
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

      {/* ---- Create SAL Modal ---- */}
      {showCreateSalModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setShowCreateSalModal(false)}>
          <div
            className="bg-white w-full max-w-lg rounded-t-2xl p-5 space-y-4 animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-brand-800">Crea SAL</h3>
              <button onClick={() => setShowCreateSalModal(false)} className="p-1 text-brand-400">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-brand-600 mb-1 block">Nome</label>
                <input
                  type="text"
                  value={salName}
                  onChange={e => setSalName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-brand-200 rounded-xl focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-brand-600 mb-1 block">Data</label>
                <input
                  type="date"
                  value={salDate}
                  onChange={e => setSalDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-brand-200 rounded-xl focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-brand-600 mb-1 block">Note (opzionale)</label>
                <textarea
                  value={salNotes}
                  onChange={e => setSalNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-brand-200 rounded-xl focus:outline-none focus:border-accent resize-none"
                />
              </div>
            </div>

            {/* Preview */}
            <div className="bg-accent/5 rounded-xl px-4 py-3">
              <p className="text-xs text-brand-600">
                Verranno contabilizzati <span className="font-bold text-accent">{unassignedRows.length}</span> attraversamenti
                per un totale di <span className="font-bold text-accent">{formatCurrency(unassignedTotal)}</span>
              </p>
            </div>

            <button
              onClick={handleCreateSal}
              disabled={isCreatingSal || unassignedRows.length === 0}
              className="w-full py-3 bg-accent text-white text-sm font-bold rounded-xl active:scale-[0.98] transition-transform disabled:opacity-40"
            >
              {isCreatingSal ? 'Creazione...' : 'Conferma'}
            </button>
          </div>
        </div>
      )}

      {/* ---- Delete SAL Confirm Dialog ---- */}
      {showDeleteConfirm && selectedSal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowDeleteConfirm(false)}>
          <div
            className="bg-white mx-4 max-w-sm w-full rounded-2xl p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-brand-800">Elimina SAL {selectedSal.number}?</h3>
            <p className="text-sm text-brand-600">
              Gli attraversamenti contenuti torneranno nello stato &quot;non contabilizzato&quot; e potranno essere assegnati a un nuovo SAL.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 text-sm font-semibold text-brand-600 bg-brand-100 rounded-xl"
              >
                Annulla
              </button>
              <button
                onClick={handleDeleteSal}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-danger rounded-xl"
              >
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CostsTab;
