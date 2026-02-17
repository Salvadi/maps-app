import { useEffect } from 'react';

/**
 * Hook to manage common modal behaviors:
 * - Close on Escape key
 * - Prevent body scroll when open
 * - Cleanup on unmount
 */
export function useModal(isOpen: boolean, onClose: () => void) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll
  useEffect(() => {
    if (!isOpen) return;

    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);
}
