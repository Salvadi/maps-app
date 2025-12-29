/**
 * FloorPlanEditor Component
 * Main editor component for floor plan annotation
 */

import React, { useState, useCallback } from 'react';
import FloorPlanCanvas, { CanvasPoint, GridConfig, Tool } from './FloorPlanCanvas';
import './FloorPlanEditor.css';

interface FloorPlanEditorProps {
  imageUrl: string;
  initialPoints?: CanvasPoint[];
  initialGridConfig?: GridConfig;
  mode?: 'mapping' | 'standalone' | 'view'; // mapping = linked to mapping entry, standalone = independent, view = read-only
  onSave?: (points: CanvasPoint[], gridConfig: GridConfig) => void;
  onClose?: () => void;
}

const FloorPlanEditor: React.FC<FloorPlanEditorProps> = ({
  imageUrl,
  initialPoints = [],
  initialGridConfig = {
    enabled: false,
    rows: 10,
    cols: 10,
    offsetX: 0,
    offsetY: 0,
  },
  mode = 'standalone',
  onSave,
  onClose,
}) => {
  const [points, setPoints] = useState<CanvasPoint[]>(initialPoints);
  const [gridConfig, setGridConfig] = useState<GridConfig>(initialGridConfig);
  const [activeTool, setActiveTool] = useState<Tool>('pan');
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [showLeftMenu, setShowLeftMenu] = useState(false);
  const [showRightMenu, setShowRightMenu] = useState(mode === 'mapping'); // Auto-show in mapping mode

  // Handle adding new point
  const handlePointAdd = useCallback((newPoint: Omit<CanvasPoint, 'id'>) => {
    const point: CanvasPoint = {
      ...newPoint,
      id: `point-${Date.now()}-${Math.random()}`,
    };
    
    setPoints(prev => [...prev, point]);
    setSelectedPointId(point.id);
  }, []);

  // Handle moving point or label
  const handlePointMove = useCallback((pointId: string, newX: number, newY: number, isLabel: boolean) => {
    setPoints(prev => prev.map(p => {
      if (p.id === pointId) {
        if (isLabel) {
          return { ...p, labelX: newX, labelY: newY };
        } else {
          return { ...p, pointX: newX, pointY: newY };
        }
      }
      return p;
    }));
  }, []);

  // Handle point selection
  const handlePointSelect = useCallback((pointId: string | null) => {
    setSelectedPointId(pointId);
  }, []);

  // Handle point deletion
  const handleDeletePoint = useCallback(() => {
    if (selectedPointId) {
      setPoints(prev => prev.filter(p => p.id !== selectedPointId));
      setSelectedPointId(null);
    }
  }, [selectedPointId]);

  // Handle grid toggle
  const handleGridToggle = useCallback(() => {
    setGridConfig(prev => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  // Handle grid config change
  const handleGridConfigChange = useCallback((key: keyof GridConfig, value: number) => {
    setGridConfig(prev => ({ ...prev, [key]: value }));
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    onSave?.(points, gridConfig);
  }, [points, gridConfig, onSave]);

  // Handle zoom
  const handleZoomIn = () => setActiveTool('zoom-in');
  const handleZoomOut = () => setActiveTool('zoom-out');

  // Get selected point
  const selectedPoint = points.find(p => p.id === selectedPointId);

  return (
    <div className="floor-plan-editor">
      {/* Header */}
      <div className="editor-header">
        <div className="header-left">
          <h2>Editor Planimetria</h2>
          <span className="editor-mode">{mode === 'mapping' ? 'Mappatura' : mode === 'view' ? 'Visualizzazione' : 'Standalone'}</span>
        </div>
        
        <div className="header-actions">
          {mode !== 'view' && (
            <button className="btn-save" onClick={handleSave}>
              Salva
            </button>
          )}
          <button className="btn-close" onClick={onClose}>
            Chiudi
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="editor-toolbar">
        <div className="toolbar-section">
          <span className="toolbar-label">Navigazione:</span>
          <button 
            className={`tool-btn ${activeTool === 'pan' ? 'active' : ''}`}
            onClick={() => setActiveTool('pan')}
            title="Pan (Sposta vista)"
          >
            <span className="tool-icon">✋</span>
            Pan
          </button>
          <button 
            className="tool-btn"
            onClick={handleZoomIn}
            title="Zoom In"
          >
            <span className="tool-icon">🔍+</span>
          </button>
          <button 
            className="tool-btn"
            onClick={handleZoomOut}
            title="Zoom Out"
          >
            <span className="tool-icon">🔍−</span>
          </button>
        </div>

        {mode !== 'view' && (
          <>
            <div className="toolbar-divider"></div>

            <div className="toolbar-section">
              <span className="toolbar-label">Strumenti:</span>
              <button 
                className={`tool-btn ${activeTool === 'move' ? 'active' : ''}`}
                onClick={() => setActiveTool('move')}
                title="Sposta punto/etichetta"
              >
                <span className="tool-icon">↔️</span>
                Sposta
              </button>
            </div>

            <div className="toolbar-divider"></div>

            <div className="toolbar-section">
              <span className="toolbar-label">Aggiungi Punto:</span>
              <button 
                className={`tool-btn tool-parete ${activeTool === 'parete' ? 'active' : ''}`}
                onClick={() => setActiveTool('parete')}
                title="Punto Parete"
              >
                <span className="tool-icon">||→</span>
                Parete
              </button>
              <button 
                className={`tool-btn tool-solaio ${activeTool === 'solaio' ? 'active' : ''}`}
                onClick={() => setActiveTool('solaio')}
                title="Punto Solaio"
              >
                <span className="tool-icon">||↓</span>
                Solaio
              </button>
              <button 
                className={`tool-btn tool-perimetro ${activeTool === 'perimetro' ? 'active' : ''}`}
                onClick={() => setActiveTool('perimetro')}
                title="Perimetro"
              >
                <span className="tool-icon">⋯</span>
                Perimetro
              </button>
              <button 
                className={`tool-btn tool-generico ${activeTool === 'generico' ? 'active' : ''}`}
                onClick={() => setActiveTool('generico')}
                title="Punto Generico"
              >
                <span className="tool-icon">●</span>
                Generico
              </button>
            </div>

            {selectedPoint && (
              <>
                <div className="toolbar-divider"></div>
                <div className="toolbar-section">
                  <button 
                    className="tool-btn btn-delete"
                    onClick={handleDeletePoint}
                    title="Elimina punto selezionato"
                  >
                    <span className="tool-icon">🗑️</span>
                    Elimina
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Main content area */}
      <div className="editor-content">
        {/* Left menu (Settings) */}
        <div className={`editor-menu left-menu ${showLeftMenu ? 'open' : ''}`}>
          <div className="menu-header">
            <h3>Impostazioni</h3>
            <button className="menu-close" onClick={() => setShowLeftMenu(false)}>×</button>
          </div>

          <div className="menu-content">
            {/* Grid settings */}
            <div className="menu-section">
              <h4>Griglia</h4>
              <label className="menu-checkbox">
                <input 
                  type="checkbox" 
                  checked={gridConfig.enabled}
                  onChange={handleGridToggle}
                />
                <span>Attiva griglia</span>
              </label>

              {gridConfig.enabled && (
                <div className="grid-settings">
                  <div className="setting-row">
                    <label>Righe:</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="50" 
                      value={gridConfig.rows}
                      onChange={(e) => handleGridConfigChange('rows', parseInt(e.target.value) || 10)}
                    />
                  </div>
                  <div className="setting-row">
                    <label>Colonne:</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="50" 
                      value={gridConfig.cols}
                      onChange={(e) => handleGridConfigChange('cols', parseInt(e.target.value) || 10)}
                    />
                  </div>
                  <div className="setting-row">
                    <label>Offset X:</label>
                    <input 
                      type="number" 
                      min="0" 
                      max="1" 
                      step="0.01"
                      value={gridConfig.offsetX}
                      onChange={(e) => handleGridConfigChange('offsetX', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="setting-row">
                    <label>Offset Y:</label>
                    <input 
                      type="number" 
                      min="0" 
                      max="1" 
                      step="0.01"
                      value={gridConfig.offsetY}
                      onChange={(e) => handleGridConfigChange('offsetY', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Export options */}
            <div className="menu-section">
              <h4>Esporta</h4>
              <button className="menu-btn" disabled>
                <span>📄</span> Esporta PDF
              </button>
              <button className="menu-btn" disabled>
                <span>🖼️</span> Esporta PNG
              </button>
              <p className="menu-note">Disponibile prossimamente</p>
            </div>
          </div>
        </div>

        {/* Canvas area */}
        <div className="canvas-area">
          <FloorPlanCanvas
            imageUrl={imageUrl}
            points={points}
            gridConfig={gridConfig}
            activeTool={activeTool}
            onPointAdd={mode !== 'view' ? handlePointAdd : undefined}
            onPointMove={mode !== 'view' ? handlePointMove : undefined}
            onPointSelect={handlePointSelect}
            selectedPointId={selectedPointId}
          />
        </div>

        {/* Right menu (Points list) */}
        <div className={`editor-menu right-menu ${showRightMenu ? 'open' : ''}`}>
          <div className="menu-header">
            <h3>Punti</h3>
            <button className="menu-close" onClick={() => setShowRightMenu(false)}>×</button>
          </div>

          <div className="menu-content">
            {points.length === 0 ? (
              <p className="menu-empty">Nessun punto aggiunto</p>
            ) : (
              <div className="points-list">
                {points.map(point => (
                  <div 
                    key={point.id}
                    className={`point-item ${point.id === selectedPointId ? 'selected' : ''}`}
                    onClick={() => handlePointSelect(point.id)}
                  >
                    <div className="point-type">
                      <span className={`type-badge type-${point.type}`}>
                        {point.type}
                      </span>
                    </div>
                    <div className="point-label">
                      {point.labelText.map((line, i) => (
                        <div key={i} className="label-line">{line}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Menu toggle buttons */}
      <button 
        className="menu-toggle left-toggle"
        onClick={() => setShowLeftMenu(!showLeftMenu)}
        title="Impostazioni"
      >
        ⚙️
      </button>
      <button 
        className="menu-toggle right-toggle"
        onClick={() => setShowRightMenu(!showRightMenu)}
        title="Elenco Punti"
      >
        📋
      </button>
    </div>
  );
};

export default FloorPlanEditor;
