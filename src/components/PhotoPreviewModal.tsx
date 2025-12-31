import React, { useEffect } from 'react';
import './PhotoPreviewModal.css';

interface PhotoPreviewModalProps {
  imageUrl: string;
  altText?: string;
  onClose: () => void;
}

const PhotoPreviewModal: React.FC<PhotoPreviewModalProps> = ({ imageUrl, altText, onClose }) => {
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

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
