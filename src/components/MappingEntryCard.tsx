/**
 * @file MappingEntryCard
 * @description Card riutilizzabile per visualizzare una singola mapping entry.
 * Mostra header con titolo, badge e azioni (modifica/elimina), e un pannello
 * espandibile con le sigillature e la galleria foto.
 * Usata in MappingView nelle modalità flat e gerarchica.
 */

import React, { useEffect, useState } from 'react';
import { MappingEntry, Photo, calcAsolaMq } from '../db';
import { EditIcon, DeleteIcon, ImageIcon } from './icons/MappingViewIcons';
import { useBlobUrl } from '../hooks/useBlobUrl';
import { apiStorageFrom } from '../lib/storageShim';

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
  const hasRemoteOnlyPhotos = photos.some(photo => !photo.blob && (photo.remoteUrl || photo.storagePath));
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
            {(mapping.hasRemotePhotos || hasRemoteOnlyPhotos) && (
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
                    {sig.inAsola && sig.asolaB && sig.asolaH && (
                      <div style={{ marginTop: '4px', paddingLeft: '8px', borderLeft: '2px solid #d4cdc0', color: '#9c9385', fontSize: '0.8em' }}>
                        ↳ <strong>Asola</strong> B×H: {sig.asolaB}×{sig.asolaH} cm → {calcAsolaMq(sig.asolaB, sig.asolaH).toFixed(2)} mq
                        {(sig.asolaB * sig.asolaH) / 10000 < 0.2 && (
                          <span style={{ marginLeft: '4px', color: '#FF9500' }}>(min applicato)</span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Photo Gallery */}
          {photos.length > 0 && (
            <div className="photo-gallery">
              {photos.map((photo, idx) => (
                <PhotoItem
                  key={photo.id}
                  photo={photo}
                  alt={`Floor ${mapping.floor} ${mapping.room ? `Room ${mapping.room}` : ''} ${mapping.intervention ? `Int ${mapping.intervention}` : ''} - ${idx + 1}`}
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

/** Sub-component that manages Blob URL lifecycle for a single photo */
const PhotoItem: React.FC<{
  photo: Photo;
  alt: string;
  onPhotoPreview: (url: string, alt: string) => void;
}> = ({ photo, alt, onPhotoPreview }) => {
  const thumbnailUrl = useBlobUrl(photo.thumbnailBlob);
  const photoUrl = useBlobUrl(photo.blob);
  const [signedUrls, setSignedUrls] = useState<{ imageUrl?: string; previewUrl?: string }>({});
  const hasFullLocalBlob = Boolean(photo.blob);
  const hasFullRemoteUrl = Boolean(photo.remoteUrl);
  const hasThumbnailLocalBlob = Boolean(photo.thumbnailBlob);
  const hasThumbnailRemoteUrl = Boolean(photo.thumbnailRemoteUrl);

  useEffect(() => {
    let cancelled = false;
    setSignedUrls({});

    // firma full e thumbnail separatamente se entrambi mancanti
    const needsFullSignedUrl = !hasFullLocalBlob && !hasFullRemoteUrl && Boolean(photo.storagePath);
    const needsThumbnailSignedUrl = !hasThumbnailLocalBlob && !hasThumbnailRemoteUrl && Boolean(photo.thumbnailStoragePath);
    if (!needsFullSignedUrl && !needsThumbnailSignedUrl) {
      return () => {
        cancelled = true;
      };
    }

    const paths = Array.from(new Set([
      needsThumbnailSignedUrl ? photo.thumbnailStoragePath : undefined,
      needsFullSignedUrl ? photo.storagePath : undefined,
    ].filter(Boolean) as string[]));
    apiStorageFrom('photos').createSignedUrls(paths, 60 * 60)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const signedByPath = new globalThis.Map((data || [])
          .filter(item => item.path && item.signedUrl)
          .map(item => [item.path, item.signedUrl]));
        const signedImageUrl = (photo.thumbnailStoragePath && signedByPath.get(photo.thumbnailStoragePath))
          || (photo.storagePath && signedByPath.get(photo.storagePath))
          || undefined;
        const signedPreviewUrl = (photo.storagePath && signedByPath.get(photo.storagePath)) || signedImageUrl;
        setSignedUrls({ imageUrl: signedImageUrl, previewUrl: signedPreviewUrl });
      });

    return () => {
      cancelled = true;
    };
  }, [
    hasFullLocalBlob,
    hasFullRemoteUrl,
    hasThumbnailLocalBlob,
    hasThumbnailRemoteUrl,
    photo.storagePath,
    photo.thumbnailStoragePath,
  ]);

  const imageUrl = thumbnailUrl || photoUrl || photo.thumbnailRemoteUrl || photo.remoteUrl || signedUrls.imageUrl;
  if (!imageUrl) return null;
  const previewUrl = photoUrl || photo.remoteUrl || signedUrls.previewUrl || imageUrl;
  return (
    <div className="photo-item">
      <img
        src={imageUrl}
        alt={alt}
        loading="lazy"
        onClick={() => onPhotoPreview(previewUrl, alt)}
        style={{ cursor: 'pointer' }}
      />
    </div>
  );
};

export default MappingEntryCard;
