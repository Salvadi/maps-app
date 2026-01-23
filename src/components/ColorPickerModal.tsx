import React, { useState, useEffect } from 'react';
import './ColorPickerModal.css';

interface ColorPickerModalProps {
  isOpen: boolean;
  initialColor: { r: number; g: number; b: number };
  selectedCount: number;
  recentColors: string[]; // Array di hex colors (es. ["#FF5733", "#33FF57"])
  onApply: (color: { r: number; g: number; b: number }) => void;
  onClose: () => void;
}

const ColorPickerModal: React.FC<ColorPickerModalProps> = ({
  isOpen,
  initialColor,
  selectedCount,
  recentColors,
  onApply,
  onClose
}) => {
  const [color, setColor] = useState(initialColor);
  const [hexInput, setHexInput] = useState('');

  // Sincronizza hex con RGB
  useEffect(() => {
    const hex = `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`;
    setHexInput(hex.toUpperCase());
  }, [color]);

  // Handler cambio slider
  const handleSliderChange = (channel: 'r' | 'g' | 'b', value: number) => {
    setColor(prev => ({ ...prev, [channel]: value }));
  };

  // Handler cambio hex input
  const handleHexChange = (value: string) => {
    setHexInput(value);

    // Valida e converti hex -> RGB
    const hex = value.replace('#', '');
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
      const r = parseInt(hex.substr(0, 2), 16);
      const g = parseInt(hex.substr(2, 2), 16);
      const b = parseInt(hex.substr(4, 2), 16);
      setColor({ r, g, b });
    }
  };

  // Handler click su colore recente
  const handleRecentColorClick = (hexColor: string) => {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    setColor({ r, g, b });
  };

  // Reset a colori default
  const handleReset = () => {
    setColor({ r: 250, g: 250, b: 240 }); // beige default
  };

  // Chiudi su Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Previeni scroll body
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const hexColor = `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`;

  return (
    <div className="color-picker-overlay" onClick={onClose}>
      <div className="color-picker-container" onClick={(e) => e.stopPropagation()}>
        <div className="color-picker-header">
          <h3>Seleziona Colore Etichetta</h3>
          <button className="color-picker-close" onClick={onClose}>×</button>
        </div>

        <div className="color-picker-content">
          <p className="selected-count">
            {selectedCount} punt{selectedCount === 1 ? 'o' : 'i'} selezionat{selectedCount === 1 ? 'o' : 'i'}
          </p>

          {/* Preview */}
          <div className="color-preview-box">
            <div
              className="color-preview-label"
              style={{
                backgroundColor: hexColor,
                border: '2px solid #333',
                padding: '12px',
                borderRadius: '4px',
                color: '#000',
                fontWeight: 'bold',
                fontSize: '14px'
              }}
            >
              Anteprima etichetta
            </div>
          </div>

          {/* Recent Colors Palette */}
          {recentColors.length > 0 && (
            <div className="recent-colors-section">
              <label className="recent-colors-label">Colori recenti:</label>
              <div className="recent-colors-grid">
                {recentColors.map((hexColor, index) => (
                  <button
                    key={index}
                    className="recent-color-btn"
                    style={{ backgroundColor: hexColor }}
                    onClick={() => handleRecentColorClick(hexColor)}
                    title={hexColor}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Slider RGB */}
          <div className="color-sliders">
            <div className="slider-group">
              <label>
                Rosso (R): <span className="slider-value">{color.r}</span>
              </label>
              <input
                type="range"
                min="0"
                max="255"
                value={color.r}
                onChange={(e) => handleSliderChange('r', parseInt(e.target.value))}
                className="color-slider slider-red"
              />
            </div>

            <div className="slider-group">
              <label>
                Verde (G): <span className="slider-value">{color.g}</span>
              </label>
              <input
                type="range"
                min="0"
                max="255"
                value={color.g}
                onChange={(e) => handleSliderChange('g', parseInt(e.target.value))}
                className="color-slider slider-green"
              />
            </div>

            <div className="slider-group">
              <label>
                Blu (B): <span className="slider-value">{color.b}</span>
              </label>
              <input
                type="range"
                min="0"
                max="255"
                value={color.b}
                onChange={(e) => handleSliderChange('b', parseInt(e.target.value))}
                className="color-slider slider-blue"
              />
            </div>
          </div>

          {/* Input Hex */}
          <div className="hex-input-group">
            <label>Codice Hex:</label>
            <input
              type="text"
              value={hexInput}
              onChange={(e) => handleHexChange(e.target.value)}
              placeholder="#RRGGBB"
              maxLength={7}
              className="hex-input"
            />
          </div>

          {/* Bottoni azione */}
          <div className="color-picker-actions">
            <button className="btn-reset" onClick={handleReset}>
              Ripristina Default
            </button>
            <button className="btn-cancel" onClick={onClose}>
              Annulla
            </button>
            <button className="btn-apply" onClick={() => onApply(color)}>
              Applica
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ColorPickerModal;
