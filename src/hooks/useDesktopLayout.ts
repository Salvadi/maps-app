import { useState, useEffect } from 'react';

const DESKTOP_BREAKPOINT = 1024;

export function useDesktopLayout(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= DESKTOP_BREAKPOINT);

  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return isDesktop;
}
