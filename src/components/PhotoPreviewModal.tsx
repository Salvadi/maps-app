import React from 'react';
import { useModal } from '../hooks/useModal';
import './PhotoPreviewModal.css';

interface PhotoPreviewModalProps {
  imageUrl: string;
  altText?: string;
  onClose: () => void;
}

const PhotoPreviewModal: React.FC<PhotoPreviewModalProps> = ({ imageUrl, altText, onClose }) => {
  useModal(true, onClose);

  return (
    <div className="photo-preview-overlay" onClick={onClose}>
      <div className="photo-preview-container" onClick={(e) => e.stopPropagation()}>
        <button className="photo-preview-close" onClick={onClose} aria-label="Chiudi">
          ×
        </button>
        <img
          src={imageUrl}
          alt={altText || 'Anteprima foto'}
          className="photo-preview-image"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
};

export default PhotoPreviewModal;
