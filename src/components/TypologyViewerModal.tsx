import React from 'react';
import { X, Tag, Package } from 'lucide-react';
import { Project } from '../db';
import { useDropdownOptions } from '../hooks/useDropdownOptions';

export interface TypologyViewerModalProps {
  project: Project;
  onClose: () => void;
}

const TypologyViewerModal: React.FC<TypologyViewerModalProps> = ({ project, onClose }) => {
  const SUPPORTO_OPTIONS = useDropdownOptions('supporto');
  const TIPO_SUPPORTO_OPTIONS = useDropdownOptions('tipo_supporto');
  const ATTRAVERSAMENTO_OPTIONS = useDropdownOptions('attraversamento');

  const getLabel = (options: { value: string; label: string }[], value: string) => {
    const option = options.find(opt => opt.value === value);
    return option?.label || value;
  };

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
            className="w-8 h-8 rounded-full flex items-center justify-center text-brand-500 hover:bg-brand-100 active:bg-brand-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {[...project.typologies].sort((a, b) => a.number - b.number).map((tip) => (
            <div key={tip.id} className="bg-brand-50 rounded-xl p-3.5">
              {/* Number badge + crossing type */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-white bg-accent px-2.5 py-1 rounded-full">
                  #{tip.number}
                </span>
                <span className="text-sm font-semibold text-brand-800 truncate">
                  {getLabel(ATTRAVERSAMENTO_OPTIONS, tip.attraversamento)}
                </span>
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
            </div>
          ))}

          {project.typologies.length === 0 && (
            <div className="text-center py-8 text-brand-400 text-sm">
              Nessun tipologico configurato
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TypologyViewerModal;
