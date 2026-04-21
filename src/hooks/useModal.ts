import { useEffect, useRef } from 'react';

/**
 * Hook to manage common modal behaviors:
 * - Close on Escape key
 * - Prevent body scroll when open
 * - Integrate with browser back button (Android hardware back / browser back)
 */
export function useModal(isOpen: boolean, onClose: () => void) {
  const closedByBackRef = useRef(false);

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

  // Browser / hardware back button integration
  useEffect(() => {
    if (!isOpen) return;

    const savedState = window.history.state ? { ...window.history.state } : {};
    const savedDepth: number = savedState.__modalDepth ?? 0;

    window.history.pushState(
      { ...savedState, __modalDepth: savedDepth + 1 },
      ''
    );

    closedByBackRef.current = false;

    const handlePopState = () => {
      closedByBackRef.current = true;
      onClose();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      // Modal closed programmatically — remove the extra history entry without triggering popstate
      if (!closedByBackRef.current) {
        const currentDepth: number = window.history.state?.__modalDepth ?? 0;
        if (currentDepth > savedDepth) {
          window.history.replaceState(savedState, '');
        }
      }
    };
  }, [isOpen, onClose]);
}
