import React, { useState, useCallback, useRef } from 'react';
import FloorPlanEditor from './FloorPlanEditor';
import { CanvasPoint, GridConfig } from './FloorPlanCanvas';
import { User, StandaloneMap, getStandaloneMaps, createStandaloneMap, updateStandaloneMap, deleteStandaloneMap, getFloorPlanBlobUrl } from '../db';
import { exportCanvasToPDF, exportCanvasToPNG, convertPDFToImage } from '../utils/exportUtils';
import './StandaloneFloorPlanEditor.css';

interface StandaloneFloorPlanEditorProps {
  currentUser: User;
  onBack: () => void;
}

const StandaloneFloorPlanEditor: React.FC<StandaloneFloorPlanEditorProps> = ({
  currentUser,
  onBack,
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [points, setPoints] = useState<CanvasPoint[]>([]);
  const [gridConfig, setGridConfig] = useState<GridConfig>({
    enabled: false,
    rows: 10,
    cols: 10,
    offsetX: 0,
    offsetY: 0,
  });
  const [projectName, setProjectName] = useState<string>('');
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [availableMaps, setAvailableMaps] = useState<StandaloneMap[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Store the current file for saving
  const [currentFile, setCurrentFile] = useState<File | null>(null);

  // Handle file upload
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Store the file for later use
    setCurrentFile(file);

    // Check if it's a PDF or image
    if (file.type === 'application/pdf') {
      try {
        const imageUrl = await convertPDFToImage(file);
        setImageUrl(imageUrl);
        setPoints([]);
        setGridConfig({
          enabled: false,
          rows: 10,
          cols: 10,
          offsetX: 0,
          offsetY: 0,
        });
      } catch (error) {
        console.error('PDF conversion error:', error);
        alert('❌ Errore durante la conversione del PDF');
      }
    } else if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const url = e.target?.result as string;
        setImageUrl(url);
        setPoints([]);
        setGridConfig({
          enabled: false,
          rows: 10,
          cols: 10,
          offsetX: 0,
          offsetY: 0,
        });
      };
      reader.readAsDataURL(file);
    } else {
      alert('❌ Per favore seleziona un file immagine o PDF valido.');
    }
  }, []);

  // Trigger file input
  const handleLoadFloorPlan = useCallback(() => {
    // Confirm if there's unsaved work
    if (points.length > 0 || projectName) {
      const confirmed = window.confirm('⚠️ Vuoi creare un nuovo progetto? Il lavoro non salvato andrà perso.');
      if (!confirmed) return;
    }

    // Reset all state
    setImageUrl(null);
    setPoints([]);
    setGridConfig({
      enabled: false,
      rows: 10,
      cols: 10,
      offsetX: 0,
      offsetY: 0,
    });
    setProjectName('');
    setCurrentMapId(null);
    setCurrentFile(null);

    // Trigger file input
    fileInputRef.current?.click();
  }, [points.length, projectName]);

  // Handle save
  const handleSave = useCallback((savedPoints: CanvasPoint[], savedGridConfig: GridConfig) => {
    setPoints(savedPoints);
    setGridConfig(savedGridConfig);
    alert('✅ Modifiche salvate localmente');
  }, []);

  // Handle export as PNG
  const handleExportPNG = useCallback(() => {
    const canvas = document.querySelector('.floor-plan-canvas') as HTMLCanvasElement;
    if (!canvas) {
      alert('❌ Impossibile trovare il canvas');
      return;
    }

    try {
      const filename = projectName ? `${projectName}.png` : 'planimetria.png';
      exportCanvasToPNG(canvas, filename);
      alert('✅ Planimetria esportata in PNG');
    } catch (error) {
      console.error('Export PNG error:', error);
      alert('❌ Errore durante l\'esportazione PNG');
    }
  }, [projectName]);

  // Handle export as PDF
  const handleExportPDF = useCallback(() => {
    const canvas = document.querySelector('.floor-plan-canvas') as HTMLCanvasElement;
    if (!canvas) {
      alert('❌ Impossibile trovare il canvas');
      return;
    }

    try {
      const filename = projectName ? `${projectName}.pdf` : 'planimetria.pdf';
      exportCanvasToPDF(canvas, filename);
      alert('✅ Planimetria esportata in PDF');
    } catch (error) {
      console.error('Export PDF error:', error);
      alert('❌ Errore durante l\'esportazione PDF');
    }
  }, [projectName]);

  // Handle export as JSON
  const handleExportJSON = useCallback(() => {
    if (!imageUrl) {
      alert('❌ Nessuna planimetria caricata');
      return;
    }

    const data = {
      projectName: projectName || 'Progetto senza nome',
      createdAt: new Date().toISOString(),
      imageUrl,
      points,
      gridConfig,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName || 'planimetria'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('✅ Progetto esportato come JSON');
  }, [imageUrl, points, gridConfig, projectName]);

  // Handle save to database
  const handleSaveToDatabase = useCallback((currentPoints: CanvasPoint[], currentGridConfig: GridConfig) => {
    if (!imageUrl) {
      alert('❌ Nessuna planimetria caricata');
      return;
    }

    // Update state with current values from editor
    setPoints(currentPoints);
    setGridConfig(currentGridConfig);

    // Show name dialog
    setShowNameDialog(true);
  }, [imageUrl]);

  // Handle name dialog confirm
  const handleNameDialogConfirm = useCallback(async () => {
    if (!projectName.trim()) {
      alert('❌ Per favore inserisci un nome per il progetto');
      return;
    }

    setShowNameDialog(false);

    try {
      if (currentMapId) {
        // Update existing map
        await updateStandaloneMap(currentMapId, {
          name: projectName,
          points: points.map(p => ({
            id: p.id,
            pointType: p.type,
            pointX: p.pointX,
            pointY: p.pointY,
            labelX: p.labelX,
            labelY: p.labelY,
            perimeterPoints: p.perimeterPoints,
            customText: p.customText,
          })),
          gridEnabled: gridConfig.enabled,
          gridConfig: {
            rows: gridConfig.rows || 10,
            cols: gridConfig.cols || 10,
            offsetX: gridConfig.offsetX || 0,
            offsetY: gridConfig.offsetY || 0,
          },
        });
        alert('✅ Progetto aggiornato con successo');
      } else {
        // Create new map
        if (!currentFile) {
          alert('❌ Nessun file caricato. Per favore carica prima una planimetria');
          return;
        }

        const newMap = await createStandaloneMap(
          currentUser.id,
          projectName,
          currentFile
        );

        // Update the new map with points and grid config
        await updateStandaloneMap(newMap.id, {
          points: points.map(p => ({
            id: p.id,
            pointType: p.type,
            pointX: p.pointX,
            pointY: p.pointY,
            labelX: p.labelX,
            labelY: p.labelY,
            perimeterPoints: p.perimeterPoints,
            customText: p.customText,
          })),
          gridEnabled: gridConfig.enabled,
          gridConfig: {
            rows: gridConfig.rows || 10,
            cols: gridConfig.cols || 10,
            offsetX: gridConfig.offsetX || 0,
            offsetY: gridConfig.offsetY || 0,
          },
        });

        setCurrentMapId(newMap.id);
        alert('✅ Progetto creato e salvato con successo');
      }
    } catch (error) {
      console.error('Error saving map:', error);
      alert('❌ Errore durante il salvataggio del progetto');
    }
  }, [projectName, currentMapId, points, gridConfig, currentFile, currentUser.id]);

  // Handle open from database
  const handleOpenFromDatabase = useCallback(async () => {
    try {
      const maps = await getStandaloneMaps(currentUser.id);
      setAvailableMaps(maps);
      setShowLoadDialog(true);
    } catch (error) {
      console.error('Error loading maps:', error);
      alert('❌ Errore durante il caricamento dei progetti salvati');
    }
  }, [currentUser.id]);

  // Handle load map from dialog
  const handleLoadMap = useCallback(async (map: StandaloneMap) => {
    try {
      if (!map.imageBlob) {
        alert('Errore: immagine della mappa non disponibile');
        return;
      }
      const blobUrl = getFloorPlanBlobUrl(map.imageBlob);
      setImageUrl(blobUrl);
      setProjectName(map.name);
      setCurrentMapId(map.id);

      // Convert standalone map points to canvas points
      const canvasPoints: CanvasPoint[] = map.points.map(p => ({
        id: p.id,
        type: p.pointType,
        pointX: p.pointX,
        pointY: p.pointY,
        labelX: p.labelX,
        labelY: p.labelY,
        labelText: p.customText ? [p.customText] : ['Punto'],
        perimeterPoints: p.perimeterPoints,
        customText: p.customText,
      }));

      setPoints(canvasPoints);
      setGridConfig({
        enabled: map.gridEnabled,
        rows: map.gridConfig.rows,
        cols: map.gridConfig.cols,
        offsetX: map.gridConfig.offsetX,
        offsetY: map.gridConfig.offsetY,
      });

      setShowLoadDialog(false);
      alert('✅ Progetto caricato con successo');
    } catch (error) {
      console.error('Error loading map:', error);
      alert('❌ Errore durante il caricamento del progetto');
    }
  }, []);

  // Handle delete map from dialog
  const handleDeleteMap = useCallback(async (mapId: string) => {
    const confirmed = window.confirm('⚠️ Sei sicuro di voler eliminare questo progetto?');
    if (!confirmed) return;

    try {
      await deleteStandaloneMap(mapId);
      const maps = await getStandaloneMaps(currentUser.id);
      setAvailableMaps(maps);
      alert('✅ Progetto eliminato con successo');
    } catch (error) {
      console.error('Error deleting map:', error);
      alert('❌ Errore durante l\'eliminazione del progetto');
    }
  }, [currentUser.id]);

  // Show initial load prompt
  if (!imageUrl) {
    return (
      <div className="standalone-editor-container">
        <div className="standalone-header">
          <button className="back-button" onClick={onBack}>
            ← Home
          </button>
          <h1>Editor Planimetrie Standalone</h1>
        </div>

        <div className="load-prompt">
          <div className="load-prompt-content">
            <div className="load-prompt-icon">📐</div>
            <h2>Carica una Planimetria</h2>
            <p>Seleziona un file immagine per iniziare ad annotare la planimetria</p>
            <button className="load-button" onClick={handleLoadFloorPlan}>
              📁 Carica Planimetria
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <div className="divider">
              <span>oppure</span>
            </div>
            <button className="load-button secondary" onClick={handleOpenFromDatabase}>
              🗄️ Apri da Database
            </button>
          </div>
        </div>

        {/* Load Dialog - anche nella vista iniziale */}
        {showLoadDialog && (
          <div className="name-dialog-overlay">
            <div className="load-dialog">
              <h3>Apri Progetto</h3>
              {availableMaps.length === 0 ? (
                <p className="no-maps-message">Nessun progetto salvato trovato.</p>
              ) : (
                <div className="maps-list">
                  {availableMaps.map(map => (
                    <div key={map.id} className="map-item">
                      <div className="map-info">
                        <div className="map-name">{map.name}</div>
                        <div className="map-date">
                          {new Date(map.updatedAt).toLocaleDateString('it-IT', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                      <div className="map-actions">
                        <button
                          className="map-action-button load"
                          onClick={() => handleLoadMap(map)}
                          title="Apri progetto"
                        >
                          📂 Apri
                        </button>
                        <button
                          className="map-action-button delete"
                          onClick={() => handleDeleteMap(map.id)}
                          title="Elimina progetto"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="dialog-buttons">
                <button className="dialog-button cancel" onClick={() => setShowLoadDialog(false)}>
                  Chiudi
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="standalone-editor-container">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      {/* Simple header with back button */}
      <div className="standalone-editor-header">
        <button className="header-back-button" onClick={onBack} title="Torna alla Home">
          ← Home
        </button>
        <div className="header-title">
          <h2>Editor Planimetrie</h2>
          {projectName && <span className="project-name-badge">{projectName}</span>}
        </div>
      </div>

      <div className="editor-wrapper">
        <FloorPlanEditor
          key={currentMapId || 'new'}
          imageUrl={imageUrl}
          initialPoints={points}
          initialGridConfig={gridConfig}
          mode="standalone"
          onSave={handleSave}
          onNewFile={handleLoadFloorPlan}
          onOpenFile={handleOpenFromDatabase}
          onSaveFile={handleSaveToDatabase}
          onExportJSON={handleExportJSON}
          onExportPNG={handleExportPNG}
          onExportPDF={handleExportPDF}
        />
      </div>

      {/* Name Dialog */}
      {showNameDialog && (
        <div className="name-dialog-overlay">
          <div className="name-dialog">
            <h3>Salva Progetto</h3>
            <p>Inserisci un nome per il progetto:</p>
            <input
              type="text"
              className="name-input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Nome progetto..."
              autoFocus
            />
            <div className="dialog-buttons">
              <button className="dialog-button cancel" onClick={() => setShowNameDialog(false)}>
                Annulla
              </button>
              <button className="dialog-button confirm" onClick={handleNameDialogConfirm}>
                Salva
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Dialog */}
      {showLoadDialog && (
        <div className="name-dialog-overlay">
          <div className="load-dialog">
            <h3>Apri Progetto</h3>
            {availableMaps.length === 0 ? (
              <p className="no-maps-message">Nessun progetto salvato trovato.</p>
            ) : (
              <div className="maps-list">
                {availableMaps.map(map => (
                  <div key={map.id} className="map-item">
                    <div className="map-info">
                      <div className="map-name">{map.name}</div>
                      <div className="map-date">
                        {new Date(map.updatedAt).toLocaleDateString('it-IT', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                    <div className="map-actions">
                      <button
                        className="map-action-button load"
                        onClick={() => handleLoadMap(map)}
                        title="Apri progetto"
                      >
                        📂 Apri
                      </button>
                      <button
                        className="map-action-button delete"
                        onClick={() => handleDeleteMap(map.id)}
                        title="Elimina progetto"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="dialog-buttons">
              <button className="dialog-button cancel" onClick={() => setShowLoadDialog(false)}>
                Chiudi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StandaloneFloorPlanEditor;
