// Gestione tema chiaro/scuro/sistema.
// La preferenza è persistita in localStorage e applicata come attributo
// data-theme su <html>. Lo script inline in public/index.html applica il tema
// prima del primo paint; questo modulo gestisce i cambi a runtime.

import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'opimappa-theme';
const META_LIGHT = '#f1f4f8';
const META_DARK = '#0d131b';

const mediaQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch { /* localStorage non disponibile */ }
  return 'system';
}

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') {
    return mediaQuery()?.matches ? 'dark' : 'light';
  }
  return pref;
}

function applyResolvedTheme(theme: 'light' | 'dark'): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? META_DARK : META_LIGHT);
}

type Listener = (pref: ThemePreference) => void;
const listeners = new Set<Listener>();

export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch { /* localStorage non disponibile */ }
  applyResolvedTheme(resolveTheme(pref));
  listeners.forEach((l) => l(pref));
}

// Applica subito il tema al load del modulo: copre il caso in cui lo script
// inline in index.html sia bloccato (es. CSP senza unsafe-inline).
if (typeof document !== 'undefined') {
  applyResolvedTheme(resolveTheme(getThemePreference()));
}

// Segue i cambi di tema di sistema quando la preferenza è "system"
const mq = mediaQuery();
if (mq) {
  const onSystemChange = () => {
    if (getThemePreference() === 'system') {
      applyResolvedTheme(resolveTheme('system'));
    }
  };
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onSystemChange);
  }
}

// Hook React: legge e aggiorna la preferenza tema
export function useTheme(): [ThemePreference, (pref: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference);

  useEffect(() => {
    const listener: Listener = (p) => setPref(p);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  return [pref, setThemePreference];
}
