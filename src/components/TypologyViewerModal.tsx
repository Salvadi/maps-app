import React, { useState } from 'react';
import { X, Tag, Package, Plus, Pencil, Trash2, ChevronDown, Check as CheckIcon } from 'lucide-react';
import { Project, Typology, updateProject } from '../db';
import { useDropdownOptions, useBrandOptions } from '../hooks/useDropdownOptions';
import ProductSelector from './ProductSelector';

export interface TypologyViewerModalProps {
  project: Project;
  onClose: () => void;
  onTypologiesChanged?: (updatedTypologies: Typology[]) => void;
}

const TypologyViewerModal: React.FC<TypologyViewerModalProps> = ({ project, onClose, onTypologiesChanged }) => {
  const SUPPORTO_OPTIONS = useDropdownOptions('supporto');
  const TIPO_SUPPORTO_OPTIONS = useDropdownOptions('tipo_supporto');
  const ATTRAVERSAMENTO_OPTIONS = useDropdownOptions('attraversamento');
  const MARCA_PRODOTTO_OPTIONS = useBrandOptions();

  const [typologies, setTypologies] = useState<Typology[]>([...project.typologies]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasChanges = JSON.stringify(typologies) !== JSON.stringify(project.typologies);

  const getLabel = (options: { value: string; label: string }[], value: string) => {
    const option = options.find(opt => opt.value === value);
    return option?.label || value;
  };

  const handleAdd = () => {
    const maxNumber = Math.max(...typologies.map(t => t.number), 0);
    const newTyp: Typology = {
      id: Date.now().toString(),
      number: maxNumber + 1,
      supporto: '',
      tipoSupporto: '',
      attraversamento: '',
      marcaProdottoUtilizzato: '',
      prodottiSelezionati: [],
    };
    setTypologies([...typologies, newTyp]);
    setEditingId(newTyp.id);
  };

  const handleRemove = (id: string) => {
    setTypologies(typologies.filter(t => t.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const handleChange = (id: string, field: keyof Omit<Typology, 'id'>, value: string | number | string[]) => {
    setTypologies(typologies.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const sorted = [...typologies].sort((a, b) => a.number - b.number);
      await updateProject(project.id, { typologies: sorted });
      setTypologies(sorted);
      setEditingId(null);
      onTypologiesChanged?.(sorted);
    } catch (err) {
      console.error('Error saving typologies:', err);
      alert('Errore nel salvataggio dei tipologici');
    } finally {
      setSaving(false);
    }
  };

  const selectCls = 'w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-accent/30 outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal */}
      <div
        className="relative w-full max-w-lg max-h-[85vh] bg-white rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-brand-100">
          <h2 className="text-base font-bold text-brand-800">
            Tipologici del Progetto
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-brand-100 text-brand-700 hover:bg-brand-200 active:bg-brand-300"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {[...typologies].sort((a, b) => a.number - b.number).map((tip) => (
            <div key={tip.id} className="bg-brand-50 rounded-xl p-3.5">
              {editingId === tip.id ? (
                /* ---- Edit mode ---- */
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">N.</span>
                      <input
                        type="number"
                        value={tip.number}
                        onChange={e => handleChange(tip.id, 'number', parseInt(e.target.value) || 1)}
                        className="w-14 px-2 py-1.5 bg-white border border-brand-200 rounded-xl text-sm text-brand-800 text-center focus:outline-none focus:border-accent"
                        min="1" max="999"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingId(null)}
                        className="w-8 h-8 flex items-center justify-center text-success hover:bg-green-50 rounded-xl"
                      >
                        <CheckIcon size={16} />
                      </button>
                      <button
                        onClick={() => handleRemove(tip.id)}
                        className="w-8 h-8 flex items-center justify-center text-danger hover:bg-red-50 rounded-xl"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-medium text-brand-500 mb-1 block">Supporto</label>
                      <div className="relative">
                        <select value={tip.supporto} onChange={e => handleChange(tip.id, 'supporto', e.target.value)} className={selectCls}>
                          <option value="">Seleziona...</option>
                          {SUPPORTO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-brand-500 mb-1 block">Tipo Supporto</label>
                      <div className="relative">
                        <select value={tip.tipoSupporto} onChange={e => handleChange(tip.id, 'tipoSupporto', e.target.value)} className={selectCls}>
                          <option value="">Seleziona...</option>
                          {TIPO_SUPPORTO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-brand-500 mb-1 block">Attraversamento</label>
                    <div className="relative">
                      <select value={tip.attraversamento} onChange={e => handleChange(tip.id, 'attraversamento', e.target.value)} className={selectCls}>
                        <option value="">Seleziona...</option>
                        {ATTRAVERSAMENTO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                    </div>
                    {tip.attraversamento === 'Altro' && (
                      <input
                        type="text"
                        value={tip.attraversamentoCustom || ''}
                        onChange={e => handleChange(tip.id, 'attraversamentoCustom', e.target.value)}
                        placeholder="Specifica tipo..."
                        className={`${selectCls} mt-2`}
                      />
                    )}
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-brand-500 mb-1 block">Marca prodotto</label>
                    <div className="relative">
                      <select value={tip.marcaProdottoUtilizzato} onChange={e => handleChange(tip.id, 'marcaProdottoUtilizzato', e.target.value)} className={selectCls}>
                        <option value="">Seleziona...</option>
                        {MARCA_PRODOTTO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-brand-500 mb-1 block">Materiali</label>
                    <ProductSelector
                      marca={tip.marcaProdottoUtilizzato}
                      selectedProducts={tip.prodottiSelezionati}
                      onChange={products => handleChange(tip.id, 'prodottiSelezionati', products)}
                    />
                  </div>
                </div>
              ) : (
                /* ---- View mode ---- */
                <>
                  {/* Number badge + crossing type + edit button */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-white bg-accent px-2.5 py-1 rounded-full">
                      #{tip.number}
                    </span>
                    <span className="text-sm font-semibold text-brand-800 truncate flex-1">
                      {getLabel(ATTRAVERSAMENTO_OPTIONS, tip.attraversamento)}
                    </span>
                    <button
                      onClick={() => setEditingId(tip.id)}
                      className="w-8 h-8 flex items-center justify-center text-brand-500 hover:text-accent hover:bg-accent/10 rounded-xl flex-shrink-0"
                    >
                      <Pencil size={14} />
                    </button>
                  </div>

                  {/* Support info */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-2">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-brand-400 font-medium">Supporto</span>
                      <div className="text-xs text-brand-700">{getLabel(SUPPORTO_OPTIONS, tip.supporto)}</div>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-brand-400 font-medium">Tipo Supporto</span>
                      <div className="text-xs text-brand-700">{getLabel(TIPO_SUPPORTO_OPTIONS, tip.tipoSupporto)}</div>
                    </div>
                  </div>

                  {/* Brand */}
                  {tip.marcaProdottoUtilizzato && (
                    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-brand-200/60">
                      <Tag size={12} className="text-accent flex-shrink-0" />
                      <span className="text-xs font-medium text-brand-700">{tip.marcaProdottoUtilizzato}</span>
                    </div>
                  )}

                  {/* Products */}
                  {tip.prodottiSelezionati && tip.prodottiSelezionati.length > 0 && (
                    <div className="flex items-start gap-1.5 mt-1.5">
                      <Package size={12} className="text-accent flex-shrink-0 mt-0.5" />
                      <div className="flex flex-wrap gap-1">
                        {tip.prodottiSelezionati.map((prod, idx) => (
                          <span key={idx} className="text-[11px] bg-white text-brand-600 px-2 py-0.5 rounded-md border border-brand-200">
                            {prod}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {typologies.length === 0 && (
            <div className="text-center py-8 text-brand-400 text-sm">
              Nessun tipologico configurato
            </div>
          )}

          {/* Add button */}
          <button
            onClick={handleAdd}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-brand-300 rounded-xl text-sm font-medium text-brand-500 hover:border-accent hover:text-accent transition-colors"
          >
            <Plus size={16} /> Aggiungi tipologico
          </button>
        </div>

        {/* Footer with save button (only when changes exist) */}
        {hasChanges && (
          <div className="px-4 py-3 border-t border-brand-100 flex gap-3">
            <button
              onClick={() => {
                setTypologies([...project.typologies]);
                setEditingId(null);
              }}
              className="flex-1 py-2.5 rounded-xl border border-brand-200 text-brand-700 text-sm font-semibold"
            >
              Annulla
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-40"
            >
              {saving ? 'Salvataggio...' : 'Salva'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TypologyViewerModal;
