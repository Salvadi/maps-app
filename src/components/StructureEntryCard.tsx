import React from 'react';
import { StructureEntry, Photo } from '../db';
import { EditIcon, DeleteIcon, ImageIcon } from './icons/MappingViewIcons';
import { useBlobUrl } from '../hooks/useBlobUrl';

export interface StructureEntryCardProps {
  entry: StructureEntry;
  photos: Photo[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onPhotoPreview: (url: string, alt: string) => void;
  getTipologicoLabel: (tipologicoId: string) => string;
}

const StructureEntryCard: React.FC<StructureEntryCardProps> = ({
  entry,
  photos,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onPhotoPreview,
  getTipologicoLabel,
}) => {
  const hasRemoteOnlyPhotos = photos.some(photo => !photo.blob && (photo.remoteUrl || photo.storagePath));

  return (
    <div
      className={`mapping-card ${isExpanded ? 'expanded' : ''}`}
      onClick={onToggleExpand}
    >
      <div className="mapping-header">
        <div>
          <h3 className="mapping-title">
            Piano {entry.floor}
            {entry.room && ` - ${entry.room}`}
            {entry.intervention && ` - Int. ${entry.intervention}`}
            {entry.toComplete && (
              <span className="to-complete-badge" title="Da Completare">⚠️</span>
            )}
            {(entry.hasRemotePhotos || hasRemoteOnlyPhotos) && (
              <span className="remote-photos-badge" title="Foto disponibili sul server">📷</span>
            )}
          </h3>
          <p className="mapping-meta">
            {new Date(entry.timestamp).toLocaleDateString()} • {photos.length} foto • {entry.structures.length} struttur{entry.structures.length === 1 ? 'a' : 'e'}
          </p>
        </div>
        <div className="mapping-header-actions">
          <button className="mapping-action-btn" onClick={onEdit} aria-label="Modifica">
            <EditIcon className="icon" />
          </button>
          <button className="mapping-action-btn delete" onClick={onDelete} aria-label="Elimina">
            <DeleteIcon className="icon" />
          </button>
          <div className="photo-count">
            <ImageIcon className="icon" />
            {photos.length}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="mapping-details" onClick={e => e.stopPropagation()}>
          {entry.structures.length > 0 && (
            <div className="crossings-section">
              <h4>Strutture:</h4>
              <ul>
                {entry.structures.map((s, idx) => (
                  <li key={idx} style={{ marginBottom: '8px' }}>
                    <strong>Struttura:</strong> {
                      s.struttura === 'Altro' && s.strutturaCustom
                        ? s.strutturaCustom
                        : s.struttura || 'N/A'
                    }<br />
                    {s.tipoStruttura && (
                      <><strong>Tipo:</strong> {s.tipoStruttura}<br /></>
                    )}
                    {s.tipologicoId && (
                      <><strong>Tipologico:</strong> {getTipologicoLabel(s.tipologicoId)}<br /></>
                    )}
                    {s.superficie !== undefined && (
                      <><strong>Superficie:</strong> {s.superficie} mq<br /></>
                    )}
                    {s.lunghezza !== undefined && (
                      <><strong>Lunghezza:</strong> {s.lunghezza} ml<br /></>
                    )}
                    {s.salId && (
                      <><strong>SAL:</strong> assegnato<br /></>
                    )}
                    {s.notes && (
                      <><strong>Note:</strong> {s.notes}<br /></>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {photos.length > 0 && (
            <div className="photo-gallery">
              {photos.map((photo, idx) => (
                <StructurePhotoItem
                  key={photo.id}
                  photo={photo}
                  alt={`Struttura Piano ${entry.floor} - ${idx + 1}`}
                  onPhotoPreview={onPhotoPreview}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const StructurePhotoItem: React.FC<{
  photo: Photo;
  alt: string;
  onPhotoPreview: (url: string, alt: string) => void;
}> = ({ photo, alt, onPhotoPreview }) => {
  const photoUrl = useBlobUrl(photo.blob);
  const imageUrl = photoUrl || photo.thumbnailRemoteUrl || photo.remoteUrl;
  if (!imageUrl) return null;
  return (
    <div className="photo-item">
      <img
        src={imageUrl}
        alt={alt}
        loading="lazy"
        onClick={() => onPhotoPreview(photo.remoteUrl || imageUrl, alt)}
        style={{ cursor: 'pointer' }}
      />
    </div>
  );
};

export default StructureEntryCard;
