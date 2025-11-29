import React, { useState, useRef, useEffect } from 'react';
import './MultiValueSelector.css';

interface MultiValueSelectorProps {
  options: { value: string; label: string }[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

const MultiValueSelector: React.FC<MultiValueSelectorProps> = ({
  options,
  selectedValues,
  onChange,
  placeholder = 'Seleziona...'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggleOption = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter(v => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const handleRemoveValue = (value: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selectedValues.filter(v => v !== value));
  };

  const getLabel = (value: string) => {
    const option = options.find(opt => opt.value === value);
    return option ? option.label : value;
  };

  return (
    <div className="multi-value-selector" ref={containerRef}>
      <div
        className="multi-value-display"
        onClick={() => setIsOpen(!isOpen)}
      >
        {selectedValues.length === 0 ? (
          <span className="placeholder">{placeholder}</span>
        ) : (
          <div className="selected-tags">
            {selectedValues.map(value => (
              <span key={value} className="tag">
                {getLabel(value)}
                <button
                  type="button"
                  className="tag-remove"
                  onClick={(e) => handleRemoveValue(value, e)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
      </div>

      {isOpen && (
        <div className="multi-value-dropdown">
          {options
            .filter(opt => opt.value !== '')
            .map(option => (
              <div
                key={option.value}
                className={`dropdown-option ${selectedValues.includes(option.value) ? 'selected' : ''}`}
                onClick={() => handleToggleOption(option.value)}
              >
                <input
                  type="checkbox"
                  checked={selectedValues.includes(option.value)}
                  readOnly
                />
                <span>{option.label}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default MultiValueSelector;
