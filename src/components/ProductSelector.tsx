import React, { useState, useEffect } from 'react';
import './ProductSelector.css';

// Mapping dei prodotti per ogni marca
const PRODUCTS_BY_BRAND: Record<string, string[]> = {
  'Promat': [
    'Promat PROMASEAL-A',
    'Promat PROMASTOP-I',
    'Promat PROMASTOP-CC',
    'Promat PROMASEAL-PL',
    'Promat MASTERFLOW 928',
  ],
  'AF Systems': [
    'AF Systems Firestop Compound',
    'AF Systems Firestop Sealant',
    'AF Systems Firestop Mortar',
    'AF Systems Firestop Wrap',
  ],
  'Global Building': [
    'Global Building FireSeal',
    'Global Building FireStop',
    'Global Building FireProtect',
  ],
  'Hilti': [
    'Hilti CP 606',
    'Hilti CP 617',
    'Hilti CP 636',
    'Hilti CFS-S SIL',
    'Hilti FS-ONE',
  ],
};

interface ProductSelectorProps {
  marca: string;
  selectedProducts: string[];
  onChange: (products: string[]) => void;
}

const ProductSelector: React.FC<ProductSelectorProps> = ({
  marca,
  selectedProducts,
  onChange,
}) => {
  const [currentValue, setCurrentValue] = useState('');

  // Reset il select quando cambia la marca
  useEffect(() => {
    setCurrentValue('');
  }, [marca]);

  // Ottieni la lista dei prodotti disponibili per la marca selezionata
  const availableProducts = marca ? PRODUCTS_BY_BRAND[marca] || [] : [];

  const handleAddProduct = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const product = e.target.value;
    if (product && !selectedProducts.includes(product)) {
      onChange([...selectedProducts, product]);
    }
    setCurrentValue('');
  };

  const handleRemoveProduct = (productToRemove: string) => {
    onChange(selectedProducts.filter(p => p !== productToRemove));
  };

  return (
    <div className="product-selector">
      <select
        value={currentValue}
        onChange={handleAddProduct}
        className="product-select"
        disabled={!marca || availableProducts.length === 0}
      >
        <option value="">
          {!marca
            ? 'Seleziona prima una marca'
            : availableProducts.length === 0
            ? 'Nessun prodotto disponibile'
            : 'Seleziona un prodotto...'}
        </option>
        {availableProducts.map((product) => (
          <option
            key={product}
            value={product}
            disabled={selectedProducts.includes(product)}
          >
            {product}
          </option>
        ))}
      </select>

      {selectedProducts.length > 0 && (
        <div className="product-tags">
          {selectedProducts.map((product) => (
            <div key={product} className="product-tag">
              <span className="product-tag-text">{product}</span>
              <button
                type="button"
                className="product-tag-remove"
                onClick={() => handleRemoveProduct(product)}
                aria-label={`Rimuovi ${product}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductSelector;
