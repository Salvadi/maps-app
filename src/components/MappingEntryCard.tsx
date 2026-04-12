/**
 * @file MappingEntryCard
 * @description Card riutilizzabile per visualizzare una singola mapping entry.
 * Mostra header con titolo, badge e azioni (modifica/elimina), e un pannello
 * espandibile con le sigillature e la galleria foto.
 * Usata in MappingView nelle modalità flat e gerarchica.
 */

import React from 'react';
import { MappingEntry, Photo } from '../db';
import { EditIcon, DeleteIcon, ImageIcon } from './icons/MappingViewIcons';

export interface MappingEntryCardProps {
  mapping: MappingEntry;
  photos: Photo[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onPhotoPreview: (url: string, alt: string) => void;
  getTipologicoNumber: (tipologicoId: string) => string | number;
}

const MappingEntryCard: React.FC<MappingEntryCardProps> = ({
  mapping,
  photos,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onPhotoPreview,
  getTipologicoNumber,
}) => {
  return (
    <div
      className={`mapping-card ${isExpanded ? 'expanded' : ''}`}
      onClick={onToggleExpand}
    >
      <div className="mapping-header">
        <div>
          <h3 className="mapping-title">
            Piano {mapping.floor}
            {mapping.room && ` - Stanza ${mapping.room}`}
            {mapping.intervention && ` - foto n. ${mapping.intervention}`}
            {mapping.toComplete && (
              <span className="to-complete-badge" title="Da Completare">
                ⚠️
              </span>
            )}
            {mapping.hasRemotePhotos && (
              <span className="remote-photos-badge" title="Foto disponibili sul server (non scaricate)">
                📷
              </span>
            )}
          </h3>
          <p className="mapping-meta">
            {new Date(mapping.timestamp).toLocaleDateString()} • {photos.length} foto
          </p>
        </div>
        <div className="mapping-header-actions">
          <button
            className="mapping-action-btn"
            onClick={onEdit}
            aria-label="Modifica mappatura"
          >
            <EditIcon className="icon" />
          </button>
          <button
            className="mapping-action-btn delete"
            onClick={onDelete}
            aria-label="Elimina mappatura"
          >
            <DeleteIcon className="icon" />
          </button>
          <div className="photo-count">
            <ImageIcon className="icon" />
            {photos.length}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="mapping-details" onClick={(e) => e.stopPropagation()}>
          {/* Sigillature */}
          {mapping.crossings.length > 0 && (
            <div className="crossings-section">
              <h4>Sigillature:</h4>
              <ul>
                {mapping.crossings.map((sig, idx) => (
                  <li key={idx} style={{ marginBottom: '8px' }}>
                    <strong>Supporto:</strong> {sig.supporto || 'N/A'}<br />
                    <strong>Tipo Supporto:</strong> {sig.tipoSupporto || 'N/A'}<br />
                    <strong>Attraversamento:</strong> {
                      sig.attraversamento === 'Altro' && sig.attraversamentoCustom
                        ? sig.attraversamentoCustom
                        : sig.attraversamento || 'N/A'
                    }<br />
                    {sig.tipologicoId && (
                      <><strong>Tipologico:</strong> {getTipologicoNumber(sig.tipologicoId)}<br /></>
                    )}
                    {sig.quantita && (
                      <><strong>Quantità:</strong> {sig.quantita}<br /></>
                    )}
                    {sig.diametro && (
                      <><strong>Diametro:</strong> {sig.diametro}<br /></>
                    )}
                    {sig.dimensioni && (
                      <><strong>Dimensioni:</strong> {sig.dimensioni}<br /></>
                    )}
                    {sig.notes && (
                      <><strong>Note:</strong> {sig.notes}<br /></>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Photo Gallery */}
          {photos.length > 0 && (
            <div className="photo-gallery">
              {photos.map((photo, idx) => {
                const photoUrl = URL.createObjectURL(photo.blob);
                const photoAlt = `Floor ${mapping.floor} ${mapping.room ? `Room ${mapping.room}` : ''} ${mapping.intervention ? `Int ${mapping.intervention}` : ''} - ${idx + 1}`;
                return (
                  <div key={photo.id} className="photo-item">
                    <img
                      src={photoUrl}
                      alt={photoAlt}
                      loading="lazy"
                      onClick={() => onPhotoPreview(photoUrl, photoAlt)}
                      style={{ cursor: 'pointer' }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MappingEntryCard;
