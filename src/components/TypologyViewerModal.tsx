/**
 * @file TypologyViewerModal
 * @description Modale di sola lettura che mostra tutti i tipologici di un progetto.
 * Per ogni tipologico visualizza supporto, tipo supporto, attraversamento, marca prodotto
 * e lista prodotti selezionati, traducendo i valori tramite le opzioni dropdown.
 */

import React from 'react';
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

  // Helper function to get label from options
  const getLabel = (options: { value: string; label: string }[], value: string) => {
    const option = options.find(opt => opt.value === value);
    return option?.label || value;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content typology-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Tipologici del Progetto</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="Chiudi">×</button>
        </div>
        <div className="modal-body">
          {[...project.typologies].sort((a, b) => a.number - b.number).map((tip) => (
            <div key={tip.id} className="typology-card">
              <h3 className="typology-card-title">Tipologico {tip.number}</h3>
              <div className="typology-card-fields">
                <div className="typology-card-field">
                  <span className="typology-card-label">Supporto:</span>
                  <span className="typology-card-value">{getLabel(SUPPORTO_OPTIONS, tip.supporto)}</span>
                </div>
                <div className="typology-card-field">
                  <span className="typology-card-label">Tipo Supporto:</span>
                  <span className="typology-card-value">{getLabel(TIPO_SUPPORTO_OPTIONS, tip.tipoSupporto)}</span>
                </div>
                <div className="typology-card-field">
                  <span className="typology-card-label">Attraversamento:</span>
                  <span className="typology-card-value">{getLabel(ATTRAVERSAMENTO_OPTIONS, tip.attraversamento)}</span>
                </div>
                <div className="typology-card-field">
                  <span className="typology-card-label">Marca Prodotto:</span>
                  <span className="typology-card-value">{tip.marcaProdottoUtilizzato}</span>
                </div>
                {tip.prodottiSelezionati.length > 0 && (
                  <div className="typology-card-field">
                    <span className="typology-card-label">Prodotti:</span>
                    <ul className="typology-card-products">
                      {tip.prodottiSelezionati.map((prod, idx) => (
                        <li key={idx}>{prod}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TypologyViewerModal;
