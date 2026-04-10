import { useState, useEffect } from 'react';

/**
 * Hook that safely manages a Blob URL lifecycle.
 * Creates a URL when the blob changes and revokes the previous one on cleanup.
 * Prevents memory leaks from orphaned Blob URLs.
 */
export function useBlobUrl(blob: Blob | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  return url;
}
