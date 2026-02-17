import { useState, useEffect } from 'react';
import { getDropdownOptions, getProductsByBrand, getBrandOptions } from '../db/dropdownOptions';

export interface MenuOption {
  value: string;
  label: string;
}

/**
 * Hook to load dropdown options from Supabase/cache/fallback
 */
export function useDropdownOptions(category: string): MenuOption[] {
  const [options, setOptions] = useState<MenuOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    getDropdownOptions(category).then(opts => {
      if (!cancelled) setOptions(opts);
    });
    return () => { cancelled = true; };
  }, [category]);

  return options;
}

/**
 * Hook to load products grouped by brand
 */
export function useProductsByBrand(): Record<string, string[]> {
  const [products, setProducts] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    getProductsByBrand().then(prods => {
      if (!cancelled) setProducts(prods);
    });
    return () => { cancelled = true; };
  }, []);

  return products;
}

/**
 * Hook to load brand options
 */
export function useBrandOptions(): MenuOption[] {
  const [options, setOptions] = useState<MenuOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    getBrandOptions().then(opts => {
      if (!cancelled) setOptions(opts);
    });
    return () => { cancelled = true; };
  }, []);

  return options;
}
