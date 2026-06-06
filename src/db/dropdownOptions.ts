import { db, DropdownOptionCache, ProductCache } from './database';
import { apiFetchJson, isHomeserverConfigured } from '../lib/homeserver';
import { MeasureUnit, asMeasureUnit } from '../config/units';

// Static fallbacks (from original config files)
import { SUPPORTO_OPTIONS } from '../config/supporto';
import { TIPO_SUPPORTO_OPTIONS } from '../config/tipoSupporto';
import { ATTRAVERSAMENTO_OPTIONS } from '../config/attraversamento';
import { MARCA_PRODOTTO_OPTIONS } from '../config/marcaProdotto';
import { PRODUCTS_BY_BRAND } from '../config/products';

const STRUTTURA_OPTIONS: MenuOption[] = [
  { value: '', label: '' },
  { value: 'Parete', label: 'Parete' },
  { value: 'Soffitto', label: 'Soffitto' },
  { value: 'Cassonetto porta-impianto', label: 'Cassonetto porta-impianto' },
  { value: 'Altro', label: 'Altro' },
];

const TIPO_STRUTTURA_OPTIONS: MenuOption[] = [
  { value: '', label: '' },
  { value: 'Flessibile', label: 'Flessibile' },
  { value: 'Rigido', label: 'Rigido' },
];

export interface MenuOption {
  value: string;
  label: string;
  unit?: MeasureUnit; // unità di misura per voce (struttura/attraversamento)
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
 * Fetch dropdown options dall'API homeserver e cache locale.
 */
async function fetchAndCacheOptions(category: string): Promise<MenuOption[]> {
  if (!isHomeserverConfigured()) return [];

  try {
    const encoded = encodeURIComponent(category);
    const res = await apiFetchJson<{ data: any[] }>(
      `/api/dropdown_options?category=eq.${encoded}&is_active=eq.true&order=sort_order.asc&limit=1000`
    );
    const data = res.data;
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
      unit: asMeasureUnit(item.unit),
      sortOrder: item.sort_order,
      isActive: item.is_active,
      fetchedAt: now,
    }));

    await db.dropdownOptionsCache.bulkAdd(cacheItems);

    return [{ value: '', label: '' }, ...cacheItems.map(item => ({
      value: item.value,
      label: item.label,
      unit: item.unit,
    }))];
  } catch (err) {
    console.warn(`Failed to fetch ${category} options dall'homeserver:`, err);
    return [];
  }
}

/**
 * Fetch products dall'API homeserver e cache locale.
 */
async function fetchAndCacheProducts(): Promise<Record<string, string[]>> {
  if (!isHomeserverConfigured()) return {};

  try {
    const res = await apiFetchJson<{ data: any[] }>(
      `/api/products?is_active=eq.true&order=sort_order.asc&limit=1000`
    );
    const data = res.data;
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
    console.warn(`Failed to fetch products dall'homeserver:`, err);
    return {};
  }
}

/**
 * Get dropdown options for a category.
 * Priority: Supabase → IndexedDB cache → hardcoded fallback
 */
export async function getDropdownOptions(category: string): Promise<MenuOption[]> {
  // 1. Try homeserver (if cache is stale)
  if (isHomeserverConfigured() && !(await isCacheFresh(category))) {
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
      unit: item.unit,
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
  // 1. Try homeserver (if cache is stale)
  if (isHomeserverConfigured() && !(await isProductsCacheFresh())) {
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
  if (!isHomeserverConfigured()) return;

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
    case 'struttura': return STRUTTURA_OPTIONS;
    case 'tipo_struttura': return TIPO_STRUTTURA_OPTIONS;
    default: return [{ value: '', label: '' }];
  }
}
