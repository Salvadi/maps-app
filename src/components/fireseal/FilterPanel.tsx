import React, { useEffect, useState } from 'react';
import { SearchFilters } from '../../lib/fireseal/vectorSearch';
import {
  getUniqueBrands,
  getUniqueReiValues,
  getUniqueSupportTypes
} from '../../db/certificates';

interface FilterPanelProps {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}

export function FilterPanel({ filters, onChange }: FilterPanelProps) {
  const [brands, setBrands] = useState<string[]>([]);
  const [reiValues, setReiValues] = useState<string[]>([]);
  const [supportTypes, setSupportTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFilterOptions() {
      try {
        const [brandsData, reiData, supportData] = await Promise.all([
          getUniqueBrands(),
          getUniqueReiValues(),
          getUniqueSupportTypes()
        ]);
        setBrands(brandsData);
        setReiValues(reiData);
        setSupportTypes(supportData);
      } catch (error) {
        console.error('Error loading filter options:', error);
      } finally {
        setLoading(false);
      }
    }
    loadFilterOptions();
  }, []);

  const handleChange = (key: keyof SearchFilters, value: string) => {
    onChange({
      ...filters,
      [key]: value || undefined
    });
  };

  const clearFilters = () => {
    onChange({});
  };

  const hasActiveFilters = Object.values(filters).some(v => v);

  if (loading) {
    return null;
  }

  // Don't show filter panel if no options available
  if (brands.length === 0 && reiValues.length === 0 && supportTypes.length === 0) {
    return null;
  }

  return (
    <div className="filter-panel">
      {brands.length > 0 && (
        <div className="filter-group">
          <label>Marca:</label>
          <select
            value={filters.brand || ''}
            onChange={(e) => handleChange('brand', e.target.value)}
          >
            <option value="">Tutte</option>
            {brands.map(brand => (
              <option key={brand} value={brand}>{brand}</option>
            ))}
          </select>
        </div>
      )}

      {reiValues.length > 0 && (
        <div className="filter-group">
          <label>REI:</label>
          <select
            value={filters.rei || ''}
            onChange={(e) => handleChange('rei', e.target.value)}
          >
            <option value="">Tutti</option>
            {reiValues.map(rei => (
              <option key={rei} value={rei}>{rei}</option>
            ))}
          </select>
        </div>
      )}

      {supportTypes.length > 0 && (
        <div className="filter-group">
          <label>Supporto:</label>
          <select
            value={filters.supporto || ''}
            onChange={(e) => handleChange('supporto', e.target.value)}
          >
            <option value="">Tutti</option>
            {supportTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      )}

      {hasActiveFilters && (
        <button className="clear-filters" onClick={clearFilters}>
          Pulisci filtri
        </button>
      )}
    </div>
  );
}
