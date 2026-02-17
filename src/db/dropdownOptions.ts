import { db, DropdownOptionCache, ProductCache } from './database';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// Static fallbacks (from original config files)
import { SUPPORTO_OPTIONS } from '../config/supporto';
import { TIPO_SUPPORTO_OPTIONS } from '../config/tipoSupporto';
import { ATTRAVERSAMENTO_OPTIONS } from '../config/attraversamento';
import { MARCA_PRODOTTO_OPTIONS } from '../config/marcaProdotto';
import { PRODUCTS_BY_BRAND } from '../config/products';

export interface MenuOption {
  value: string;
  label: string;
}

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if cached options are still fresh
 */
async function isCacheFresh(category: string): Promise<boolean> {
  const cached = await db.dropdownOptionsCache
    .where('category')
    .equals(category)
    .first();
  if (!cached) return false;
  return (Date.now() - cached.fetchedAt) < CACHE_TTL;
}

/**
 * Check if products cache is still fresh
 */
async function isProductsCacheFresh(): Promise<boolean> {
  const cached = await db.productsCache.toCollection().first();
  if (!cached) return false;
  return (Date.now() - cached.fetchedAt) < CACHE_TTL;
}

/**
 * Fetch dropdown options from Supabase and cache locally
 */
async function fetchAndCacheOptions(category: string): Promise<MenuOption[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    const { data, error } = await supabase
      .from('dropdown_options')
      .select('*')
      .eq('category', category)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) return [];

    // Clear old cache for this category
    await db.dropdownOptionsCache.where('category').equals(category).delete();

    // Store in cache
    const now = Date.now();
    const cacheItems: DropdownOptionCache[] = data.map((item: any) => ({
      id: item.id,
      category: item.category,
      value: item.value,
      label: item.label,
      sortOrder: item.sort_order,
      isActive: item.is_active,
      fetchedAt: now,
    }));

    await db.dropdownOptionsCache.bulkAdd(cacheItems);

    return [{ value: '', label: '' }, ...cacheItems.map(item => ({
      value: item.value,
      label: item.label,
    }))];
  } catch (err) {
    console.warn(`Failed to fetch ${category} options from Supabase:`, err);
    return [];
  }
}

/**
 * Fetch products from Supabase and cache locally
 */
async function fetchAndCacheProducts(): Promise<Record<string, string[]>> {
  if (!isSupabaseConfigured()) return {};

  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) throw error;
    if (!data || data.length === 0) return {};

    // Clear old cache
    await db.productsCache.clear();

    // Store in cache
    const now = Date.now();
    const cacheItems: ProductCache[] = data.map((item: any) => ({
      id: item.id,
      brand: item.brand,
      name: item.name,
      sortOrder: item.sort_order,
      isActive: item.is_active,
      fetchedAt: now,
    }));

    await db.productsCache.bulkAdd(cacheItems);

    // Group by brand
    const grouped: Record<string, string[]> = {};
    for (const item of cacheItems) {
      if (!grouped[item.brand]) grouped[item.brand] = [];
      grouped[item.brand].push(item.name);
    }
    return grouped;
  } catch (err) {
    console.warn('Failed to fetch products from Supabase:', err);
    return {};
  }
}

/**
 * Get dropdown options for a category.
 * Priority: Supabase → IndexedDB cache → hardcoded fallback
 */
export async function getDropdownOptions(category: string): Promise<MenuOption[]> {
  // 1. Try Supabase (if cache is stale)
  if (isSupabaseConfigured() && !(await isCacheFresh(category))) {
    const remote = await fetchAndCacheOptions(category);
    if (remote.length > 0) return remote;
  }

  // 2. Try IndexedDB cache
  const cached = await db.dropdownOptionsCache
    .where('category')
    .equals(category)
    .sortBy('sortOrder');

  if (cached.length > 0) {
    return [{ value: '', label: '' }, ...cached.map(item => ({
      value: item.value,
      label: item.label,
    }))];
  }

  // 3. Hardcoded fallback
  return getFallbackOptions(category);
}

/**
 * Get products grouped by brand.
 * Priority: Supabase → IndexedDB cache → hardcoded fallback
 */
export async function getProductsByBrand(): Promise<Record<string, string[]>> {
  // 1. Try Supabase (if cache is stale)
  if (isSupabaseConfigured() && !(await isProductsCacheFresh())) {
    const remote = await fetchAndCacheProducts();
    if (Object.keys(remote).length > 0) return remote;
  }

  // 2. Try IndexedDB cache
  const cached = await db.productsCache.orderBy('sortOrder').toArray();
  if (cached.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const item of cached) {
      if (!grouped[item.brand]) grouped[item.brand] = [];
      grouped[item.brand].push(item.name);
    }
    return grouped;
  }

  // 3. Hardcoded fallback
  return PRODUCTS_BY_BRAND;
}

/**
 * Get brand options (derived from products).
 * Priority: Supabase → IndexedDB cache → hardcoded fallback
 */
export async function getBrandOptions(): Promise<MenuOption[]> {
  const products = await getProductsByBrand();
  const brands = Object.keys(products);

  if (brands.length > 0) {
    return [
      { value: '', label: '' },
      ...brands.map(b => ({ value: b, label: b })),
    ];
  }

  return MARCA_PRODOTTO_OPTIONS;
}

/**
 * Force refresh all dropdown caches (call during full sync)
 */
export async function refreshDropdownCaches(): Promise<void> {
  if (!isSupabaseConfigured()) return;

  await Promise.all([
    fetchAndCacheOptions('supporto'),
    fetchAndCacheOptions('tipo_supporto'),
    fetchAndCacheOptions('attraversamento'),
    fetchAndCacheProducts(),
  ]);

  console.log('✅ Dropdown caches refreshed');
}

/**
 * Get hardcoded fallback options
 */
function getFallbackOptions(category: string): MenuOption[] {
  switch (category) {
    case 'supporto': return SUPPORTO_OPTIONS;
    case 'tipo_supporto': return TIPO_SUPPORTO_OPTIONS;
    case 'attraversamento': return ATTRAVERSAMENTO_OPTIONS;
    default: return [{ value: '', label: '' }];
  }
}
