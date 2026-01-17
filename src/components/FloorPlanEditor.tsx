/**
 * FloorPlanEditor Component
 * Main editor component for floor plan annotation
 */

import React, { useState, useCallback } from 'react';
import FloorPlanCanvas, { CanvasPoint, GridConfig, Tool } from './FloorPlanCanvas';
import { exportCanvasToPDF, exportCanvasToPNG } from '../utils/exportUtils';
import './FloorPlanEditor.css';

export interface UnmappedEntry {
  id: string;
  labelText: string[];
  type: 'parete' | 'solaio';
}

interface FloorPlanEditorProps {
  imageUrl: string;
  initialPoints?: CanvasPoint[];
  initialGridConfig?: GridConfig;
  mode?: 'mapping' | 'standalone' | 'view' | 'view-edit'; // mapping = linked to mapping entry, standalone = independent, view = read-only, view-edit = can move labels and add generico/perimetro
  maxPoints?: number; // Maximum number of points allowed (for mapping mode, typically 1)
  unmappedEntries?: UnmappedEntry[]; // Entries not yet positioned on floor plan (for view-edit mode)
  onSave?: (points: CanvasPoint[], gridConfig: GridConfig) => void;
  onClose?: () => void;
  // Standalone mode handlers
  onNewFile?: () => void;
  onOpenFile?: () => void;
  onSaveFile?: (points: CanvasPoint[], gridConfig: GridConfig) => void;
  onExportJSON?: () => void;
  onExportPNG?: () => void;
  onExportPDF?: () => void;
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
  maxPoints,
  unmappedEntries: unmappedEntriesProp = [],
  onSave,
  onClose,
  onNewFile,
  onOpenFile,
  onSaveFile,
  onExportJSON,
  onExportPNG: onExportPNGProp,
  onExportPDF: onExportPDFProp,
}) => {
  const [points, setPoints] = useState<CanvasPoint[]>(initialPoints);
  const [gridConfig, setGridConfig] = useState<GridConfig>(initialGridConfig);
  const [unmappedEntries, setUnmappedEntries] = useState<UnmappedEntry[]>(unmappedEntriesProp);
  const [activeTool, setActiveTool] = useState<Tool>('pan');
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [showLeftMenu, setShowLeftMenu] = useState(false);
  const [showRightMenu, setShowRightMenu] = useState(mode === 'mapping' || (mode === 'view-edit' && unmappedEntriesProp.length > 0)); // Auto-show in mapping mode or view-edit with unmapped
  const [zoomInTrigger, setZoomInTrigger] = useState(0);
  const [zoomOutTrigger, setZoomOutTrigger] = useState(0);
  const [isDrawingPerimeter, setIsDrawingPerimeter] = useState(false);
  const [showToolbarMenu, setShowToolbarMenu] = useState(false);
  const [selectedUnmappedId, setSelectedUnmappedId] = useState<string | null>(null);
  const [showOnlyUnmapped, setShowOnlyUnmapped] = useState(false);
  const [sortOrder, setSortOrder] = useState<'none' | 'asc' | 'desc' | 'recent'>('none');

  // Handle placing unmapped entry on canvas
  const handlePlaceUnmappedEntry = useCallback((newPoint: Omit<CanvasPoint, 'id'>) => {
    const entry = unmappedEntries.find(e => e.id === selectedUnmappedId);
    if (!entry) return;

    // Create point with mapping entry ID
    const point: CanvasPoint = {
      ...newPoint,
      id: `point-${Date.now()}-${Math.random()}`,
      labelText: entry.labelText,
      type: entry.type,
      mappingEntryId: entry.id, // Link to mapping entry
    };

    setPoints(prev => [...prev, point]);
    setSelectedPointId(point.id);
    setSelectedUnmappedId(null);
    setActiveTool('pan');

    // Remove entry from unmapped list
    setUnmappedEntries(prev => prev.filter(e => e.id !== entry.id));
  }, [selectedUnmappedId, unmappedEntries]);

  // Handle adding new point
  const handlePointAdd = useCallback((newPoint: Omit<CanvasPoint, 'id'>) => {
    // If placing an unmapped entry, use special handler
    if (selectedUnmappedId) {
      handlePlaceUnmappedEntry(newPoint);
      return;
    }

    // In view-edit mode, only allow generico and perimetro points
    if (mode === 'view-edit' && newPoint.type !== 'generico' && newPoint.type !== 'perimetro') {
      alert('In modalità visualizzazione puoi aggiungere solo punti Generici o Perimetri.');
      return;
    }

    // Check if max points limit is reached
    if (maxPoints !== undefined && points.length >= maxPoints) {
      alert(`Puoi aggiungere massimo ${maxPoints} punto${maxPoints > 1 ? 'i' : ''} in modalità ${mode}.`);
      return;
    }

    const point: CanvasPoint = {
      ...newPoint,
      id: `point-${Date.now()}-${Math.random()}`,
    };

    setPoints(prev => [...prev, point]);
    setSelectedPointId(point.id);
  }, [maxPoints, points.length, mode, selectedUnmappedId, handlePlaceUnmappedEntry]);

  // Handle moving point or label
  const handlePointMove = useCallback((pointId: string, newX: number, newY: number, isLabel: boolean) => {
    setPoints(prev => prev.map(p => {
      if (p.id === pointId) {
        // Allow moving all points and labels in all modes (except view-only)
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

  // Handle label text change
  const handleLabelTextChange = useCallback((pointId: string, lineIndex: number, newText: string) => {
    setPoints(prev => prev.map(p => {
      if (p.id === pointId) {
        const updatedLabelText = [...p.labelText];
        updatedLabelText[lineIndex] = newText;
        return { ...p, labelText: updatedLabelText };
      }
      return p;
    }));
  }, []);

  // Handle point deletion
  const handleDeletePoint = useCallback(() => {
    if (selectedPointId) {
      const selectedPoint = points.find(p => p.id === selectedPointId);
      if (!selectedPoint) return;

      // In view-edit mode, allow deleting all points
      if (mode === 'view-edit') {
        // If point has mappingEntryId, add it back to unmapped entries
        if (selectedPoint.mappingEntryId) {
          const newUnmappedEntry: UnmappedEntry = {
            id: selectedPoint.mappingEntryId,
            labelText: selectedPoint.labelText,
            type: selectedPoint.type === 'parete' || selectedPoint.type === 'solaio'
              ? selectedPoint.type
              : 'parete', // Default to parete for generico/perimetro
          };
          setUnmappedEntries(prev => [...prev, newUnmappedEntry]);
        }

        setPoints(prev => prev.filter(p => p.id !== selectedPointId));
        setSelectedPointId(null);
        return;
      }

      // Normal mode - allow deleting any point
      setPoints(prev => prev.filter(p => p.id !== selectedPointId));
      setSelectedPointId(null);
    }
  }, [selectedPointId, mode, points]);

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

  // Handle export to PDF
  const handleExportPDF = useCallback(() => {
    if (onExportPDFProp) {
      onExportPDFProp();
      return;
    }

    const canvas = document.querySelector('.floor-plan-canvas') as HTMLCanvasElement;
    if (!canvas) {
      alert('❌ Impossibile trovare il canvas');
      return;
    }

    try {
      exportCanvasToPDF(canvas, 'planimetria-annotata.pdf');
      alert('✅ Planimetria esportata in PDF');
    } catch (error) {
      console.error('Export PDF error:', error);
      alert('❌ Errore durante l\'esportazione PDF');
    }
  }, [onExportPDFProp]);

  // Handle export to PNG
  const handleExportPNG = useCallback(() => {
    if (onExportPNGProp) {
      onExportPNGProp();
      return;
    }

    const canvas = document.querySelector('.floor-plan-canvas') as HTMLCanvasElement;
    if (!canvas) {
      alert('❌ Impossibile trovare il canvas');
      return;
    }

    try {
      exportCanvasToPNG(canvas, 'planimetria-annotata.png');
      alert('✅ Planimetria esportata in PNG');
    } catch (error) {
      console.error('Export PNG error:', error);
      alert('❌ Errore durante l\'esportazione PNG');
    }
  }, [onExportPNGProp]);

  // Handle zoom
  const handleZoomIn = () => setZoomInTrigger(prev => prev + 1);
  const handleZoomOut = () => setZoomOutTrigger(prev => prev + 1);

  // Handle perimeter drawing state change
  const handlePerimeterDrawingChange = useCallback((isDrawing: boolean) => {
    setIsDrawingPerimeter(isDrawing);
  }, []);

  // Handle complete perimeter
  const handleCompletePerimeter = useCallback(() => {
    (window as any).__completePerimeter?.();
  }, []);

  // Handle cancel perimeter
  const handleCancelPerimeter = useCallback(() => {
    (window as any).__cancelPerimeter?.();
  }, []);

  // Handle unmapped entry selection (for positioning)
  const handleUnmappedEntryClick = useCallback((entryId: string) => {
    const entry = unmappedEntries.find(e => e.id === entryId);
    if (!entry) return;

    // Toggle selection
    if (selectedUnmappedId === entryId) {
      setSelectedUnmappedId(null);
      setActiveTool('pan');
    } else {
      setSelectedUnmappedId(entryId);
      setSelectedPointId(null);
      // Set tool to the entry type to allow placement
      setActiveTool(entry.type);
    }
  }, [selectedUnmappedId, unmappedEntries]);


  // Filter unmapped entries to exclude already positioned points
  const filteredUnmappedEntries = useCallback(() => {
    // Get IDs of mapping entries that are already positioned
    const positionedMappingIds = new Set(
      points
        .filter(p => p.mappingEntryId) // Only points with mapping entry ID
        .map(p => p.mappingEntryId)
    );

    // Filter out unmapped entries that are already positioned
    return unmappedEntries.filter(entry => !positionedMappingIds.has(entry.id));
  }, [unmappedEntries, points]);

  // Sort unmapped entries based on current sort order
  const sortedUnmappedEntries = useCallback(() => {
    const filtered = filteredUnmappedEntries();

    if (sortOrder === 'none') return filtered;

    if (sortOrder === 'recent') {
      // Most recent first (reverse original order)
      return [...filtered].reverse();
    }

    return [...filtered].sort((a, b) => {
      const aText = a.labelText.join(' ').toLowerCase();
      const bText = b.labelText.join(' ').toLowerCase();

      if (sortOrder === 'asc') {
        return aText.localeCompare(bText);
      } else {
        return bText.localeCompare(aText);
      }
    });
  }, [filteredUnmappedEntries, sortOrder]);

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
          {mode !== 'view' && mode !== 'standalone' && (
            <button className="btn-save" onClick={handleSave}>
              Salva
            </button>
          )}
          {mode !== 'standalone' && (
            <button className="btn-close" onClick={onClose}>
              Chiudi
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="editor-toolbar">
        {/* Hamburger menu buttons - always visible */}
        <button
          className="toolbar-hamburger-btn"
          onClick={() => setShowLeftMenu(!showLeftMenu)}
          title="Impostazioni"
        >
          ☰
        </button>

        {/* Mobile: Dropdown toggle button */}
        <button
          className="toolbar-dropdown-toggle"
          onClick={() => setShowToolbarMenu(!showToolbarMenu)}
        >
          Strumenti {showToolbarMenu ? '▲' : '▼'}
        </button>

        {/* Desktop toolbar + Mobile dropdown */}
        <div className={`toolbar-content ${showToolbarMenu ? 'mobile-open' : ''}`}>
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
                {mode !== 'view-edit' && (
                  <>
                    <button
                      className={`tool-btn tool-parete ${activeTool === 'parete' ? 'active' : ''}`}
                      onClick={() => setActiveTool('parete')}
                      title="Punto Parete"
                    >
                      <svg className="tool-icon-svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <line x1="4" y1="2" x2="4" y2="14" stroke="currentColor" strokeWidth="1.5"/>
                        <line x1="7" y1="2" x2="7" y2="14" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M 10 8 L 14 8 M 12 6 L 14 8 L 12 10" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                      </svg>
                      Parete
                    </button>
                    <button
                      className={`tool-btn tool-solaio ${activeTool === 'solaio' ? 'active' : ''}`}
                      onClick={() => setActiveTool('solaio')}
                      title="Punto Solaio"
                    >
                      <svg className="tool-icon-svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.5"/>
                        <line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M 8 10 L 8 14 M 6 12 L 8 14 L 10 12" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                      </svg>
                      Solaio
                    </button>
                  </>
                )}
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

        {/* Right hamburger menu button */}
        <button
          className="toolbar-hamburger-btn"
          onClick={() => setShowRightMenu(!showRightMenu)}
          title="Elenco Punti"
        >
          ☰
        </button>
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
            {/* File menu for standalone mode */}
            {mode === 'standalone' && (
              <>
                <div className="menu-section">
                  <h4>Progetto</h4>
                  <button className="menu-btn" onClick={onNewFile}>
                    <span>📄</span> Nuovo Progetto
                  </button>
                  <button className="menu-btn" onClick={onOpenFile}>
                    <span>📂</span> Apri Progetto
                  </button>
                  <button className="menu-btn primary" onClick={() => onSaveFile?.(points, gridConfig)}>
                    <span>💾</span> Salva Progetto
                  </button>
                </div>

                <div className="menu-section">
                  <h4>Esporta</h4>
                  <button className="menu-btn" onClick={handleExportPDF}>
                    <span>📄</span> PDF
                  </button>
                  <button className="menu-btn" onClick={handleExportPNG}>
                    <span>🖼️</span> PNG
                  </button>
                  <button className="menu-btn" onClick={onExportJSON}>
                    <span>📦</span> JSON
                  </button>
                </div>
              </>
            )}

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
            {mode !== 'standalone' && (
              <div className="menu-section">
                <h4>Esporta</h4>
                <button className="menu-btn" onClick={handleExportPDF}>
                  <span>📄</span> Esporta PDF
                </button>
                <button className="menu-btn" onClick={handleExportPNG}>
                  <span>🖼️</span> Esporta PNG
                </button>
              </div>
            )}
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
            zoomInTrigger={zoomInTrigger}
            zoomOutTrigger={zoomOutTrigger}
            onPerimeterDrawingChange={handlePerimeterDrawingChange}
            onCompletePerimeter={handleCompletePerimeter}
            onCancelPerimeter={handleCancelPerimeter}
          />

          {/* Perimeter control buttons (V/X) */}
          {isDrawingPerimeter && (
            <div className="perimeter-controls">
              <button
                className="perimeter-btn complete"
                onClick={handleCompletePerimeter}
                title="Completa perimetro (Enter)"
              >
                ✓
              </button>
              <button
                className="perimeter-btn cancel"
                onClick={handleCancelPerimeter}
                title="Annulla perimetro (Esc)"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Right menu (Points list) */}
        <div className={`editor-menu right-menu ${showRightMenu ? 'open' : ''}`}>
          <div className="menu-header">
            <h3>Punti</h3>
            <button className="menu-close" onClick={() => setShowRightMenu(false)}>×</button>
          </div>

          <div className="menu-content">
            {/* Filter toggle for unmapped entries */}
            {mode === 'view-edit' && unmappedEntries.length > 0 && (
              <div className="menu-section">
                <label className="menu-checkbox">
                  <input
                    type="checkbox"
                    checked={showOnlyUnmapped}
                    onChange={(e) => setShowOnlyUnmapped(e.target.checked)}
                  />
                  <span>Mostra solo non posizionati ({filteredUnmappedEntries().length})</span>
                </label>
                <div style={{ marginTop: '8px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>
                    Ordina punti:
                  </label>
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as 'none' | 'asc' | 'desc' | 'recent')}
                    style={{
                      width: '100%',
                      padding: '6px 12px',
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: 'var(--color-text)'
                    }}
                  >
                    <option value="none">Nessun ordinamento</option>
                    <option value="asc">Nome (A-Z)</option>
                    <option value="desc">Nome (Z-A)</option>
                    <option value="recent">Più recenti</option>
                  </select>
                </div>
              </div>
            )}

            {/* Unmapped entries section */}
            {mode === 'view-edit' && unmappedEntries.length > 0 && !showOnlyUnmapped && (
              <div className="unmapped-entries-section">
                <h4 className="section-title">Non posizionati</h4>
                <div className="unmapped-entries-list">
                  {sortedUnmappedEntries().map(entry => (
                    <div
                      key={entry.id}
                      className={`unmapped-entry-item ${selectedUnmappedId === entry.id ? 'selected' : ''}`}
                      onClick={() => handleUnmappedEntryClick(entry.id)}
                    >
                      <div className="point-type">
                        <span className={`type-badge type-${entry.type} unmapped`}>
                          {entry.type}
                        </span>
                      </div>
                      <div className="point-label">
                        {entry.labelText.map((line, i) => (
                          <div key={i} className="label-line">{line}</div>
                        ))}
                      </div>
                      <div className="unmapped-indicator">⬇ Clicca per posizionare</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mapped points section */}
            {!showOnlyUnmapped && (
              <>
                {mode === 'view-edit' && unmappedEntries.length > 0 && points.length > 0 && (
                  <h4 className="section-title">Posizionati</h4>
                )}
                {points.length === 0 && unmappedEntries.length === 0 ? (
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
                          {/* Show editable inputs for points in standalone, view-edit modes, or generic/perimeter in other modes */}
                          {((mode === 'standalone' || mode === 'view-edit') ||
                            (mode !== 'view' && !point.mappingEntryId && (point.type === 'generico' || point.type === 'perimetro'))) &&
                           point.id === selectedPointId ? (
                            <div className="label-edit-fields">
                              <input
                                type="text"
                                className="label-edit-input"
                                placeholder="Prima riga"
                                value={point.labelText[0] || ''}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => handleLabelTextChange(point.id, 0, e.target.value)}
                              />
                              <input
                                type="text"
                                className="label-edit-input"
                                placeholder="Seconda riga"
                                value={point.labelText[1] || ''}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => handleLabelTextChange(point.id, 1, e.target.value)}
                              />
                            </div>
                          ) : (
                            point.labelText.map((line, i) => (
                              <div key={i} className="label-line">{line}</div>
                            ))
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Show only unmapped entries when filter is active */}
            {showOnlyUnmapped && unmappedEntries.length > 0 && (
              <div className="unmapped-entries-list">
                {sortedUnmappedEntries().map(entry => (
                  <div
                    key={entry.id}
                    className={`unmapped-entry-item ${selectedUnmappedId === entry.id ? 'selected' : ''}`}
                    onClick={() => handleUnmappedEntryClick(entry.id)}
                  >
                    <div className="point-type">
                      <span className={`type-badge type-${entry.type} unmapped`}>
                        {entry.type}
                      </span>
                    </div>
                    <div className="point-label">
                      {entry.labelText.map((line, i) => (
                        <div key={i} className="label-line">{line}</div>
                      ))}
                    </div>
                    <div className="unmapped-indicator">⬇ Clicca per posizionare</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FloorPlanEditor;
