import React, { useState, useEffect } from 'react';
import { useModal } from '../hooks/useModal';
import './ColorPickerModal.css';

interface ColorPickerModalProps {
  isOpen: boolean;
  mode: 'background' | 'text';
  initialBackgroundColor: { r: number; g: number; b: number };
  initialTextColor: { r: number; g: number; b: number };
  selectedCount: number;
  recentBackgroundColors: string[];
  recentTextColors: string[];
  onApply: (color: { r: number; g: number; b: number }, mode: 'background' | 'text') => void;
  onClose: () => void;
  onModeChange?: (mode: 'background' | 'text') => void;
}

const ColorPickerModal: React.FC<ColorPickerModalProps> = ({
  isOpen,
  mode,
  initialBackgroundColor,
  initialTextColor,
  selectedCount,
  recentBackgroundColors,
  recentTextColors,
  onApply,
  onClose,
  onModeChange
}) => {
  // Separate state for background and text colors
  const [backgroundColor, setBackgroundColor] = useState(initialBackgroundColor);
  const [textColor, setTextColor] = useState(initialTextColor);

  // Use the appropriate color based on mode
  const activeColor = mode === 'background' ? backgroundColor : textColor;
  const setActiveColor = mode === 'background' ? setBackgroundColor : setTextColor;

  const [hexInput, setHexInput] = useState('');

  // Sincronizza hex con RGB del colore attivo
  useEffect(() => {
    const hex = `#${activeColor.r.toString(16).padStart(2, '0')}${activeColor.g.toString(16).padStart(2, '0')}${activeColor.b.toString(16).padStart(2, '0')}`;
    setHexInput(hex.toUpperCase());
  }, [activeColor]);

  // Handler cambio slider
  const handleSliderChange = (channel: 'r' | 'g' | 'b', value: number) => {
    setActiveColor(prev => ({ ...prev, [channel]: value }));
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
      setActiveColor({ r, g, b });
    }
  };

  // Handler click su colore recente
  const handleRecentColorClick = (hexColor: string) => {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    setActiveColor({ r, g, b });
  };

  // Reset a colori default
  const handleReset = () => {
    if (mode === 'background') {
      setBackgroundColor({ r: 250, g: 250, b: 240 }); // beige default
    } else {
      setTextColor({ r: 0, g: 0, b: 0 }); // black default
    }
  };

  useModal(isOpen, onClose);

  if (!isOpen) return null;

  const backgroundHexColor = `#${backgroundColor.r.toString(16).padStart(2, '0')}${backgroundColor.g.toString(16).padStart(2, '0')}${backgroundColor.b.toString(16).padStart(2, '0')}`;
  const textHexColor = `#${textColor.r.toString(16).padStart(2, '0')}${textColor.g.toString(16).padStart(2, '0')}${textColor.b.toString(16).padStart(2, '0')}`;

  const recentColors = mode === 'background' ? recentBackgroundColors : recentTextColors;

  return (
    <div className="color-picker-overlay" onClick={onClose}>
      <div className="color-picker-container" onClick={(e) => e.stopPropagation()}>
        <div className="color-picker-header">
          <h3>Seleziona Colore Etichetta</h3>
          <button className="color-picker-close" onClick={onClose} aria-label="Chiudi">×</button>
        </div>

        <div className="color-picker-content">
          <p className="selected-count">
            {selectedCount} punt{selectedCount === 1 ? 'o' : 'i'} selezionat{selectedCount === 1 ? 'o' : 'i'}
          </p>

          {/* Tab toggle per scegliere sfondo o testo */}
          <div className="color-mode-tabs">
            <button
              className={`mode-tab ${mode === 'background' ? 'active' : ''}`}
              onClick={() => onModeChange?.('background')}
            >
              Sfondo
            </button>
            <button
              className={`mode-tab ${mode === 'text' ? 'active' : ''}`}
              onClick={() => onModeChange?.('text')}
            >
              Testo
            </button>
          </div>

          {/* Preview - mostra entrambi i colori */}
          <div className="color-preview-box">
            <div
              className="color-preview-label"
              style={{
                backgroundColor: backgroundHexColor,
                color: textHexColor,
                border: '2px solid #333',
                padding: '12px',
                borderRadius: '4px',
                fontWeight: 'bold',
                fontSize: '14px'
              }}
            >
              Anteprima etichetta
            </div>
          </div>

          {/* Recent Colors Palette - separata per mode */}
          {recentColors.length > 0 && (
            <div className="recent-colors-section">
              <label className="recent-colors-label">
                Colori recenti ({mode === 'background' ? 'Sfondo' : 'Testo'}):
              </label>
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
                Rosso (R): <span className="slider-value">{activeColor.r}</span>
              </label>
              <input
                type="range"
                min="0"
                max="255"
                value={activeColor.r}
                onChange={(e) => handleSliderChange('r', parseInt(e.target.value))}
                className="color-slider slider-red"
              />
            </div>

            <div className="slider-group">
              <label>
                Verde (G): <span className="slider-value">{activeColor.g}</span>
              </label>
              <input
                type="range"
                min="0"
                max="255"
                value={activeColor.g}
                onChange={(e) => handleSliderChange('g', parseInt(e.target.value))}
                className="color-slider slider-green"
              />
            </div>

            <div className="slider-group">
              <label>
                Blu (B): <span className="slider-value">{activeColor.b}</span>
              </label>
              <input
                type="range"
                min="0"
                max="255"
                value={activeColor.b}
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
            <button className="btn-apply" onClick={() => onApply(activeColor, mode)}>
              Applica
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ColorPickerModal;
