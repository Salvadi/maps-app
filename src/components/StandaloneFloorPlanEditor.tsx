import React, { useState, useCallback, useRef } from 'react';
import { ArrowLeft, Map, Upload, Database, FolderOpen, Trash2 } from 'lucide-react';
import FloorPlanEditor from './FloorPlanEditor';
import { CanvasPoint, GridConfig } from './FloorPlanCanvas';
import { User, StandaloneMap, getStandaloneMaps, createStandaloneMap, updateStandaloneMap, deleteStandaloneMap, getFloorPlanBlobUrl } from '../db';
import { exportCanvasToPDF, exportCanvasToPNG, convertPDFToImage } from '../utils/exportUtils';

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
      const blobUrl = getFloorPlanBlobUrl(map.imageBlob, map.imageUrl);
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

  // Shared load dialog JSX
  const LoadDialogContent = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-card-hover">
        <div className="px-6 py-5 border-b border-brand-200">
          <h3 className="text-lg font-bold text-brand-800">Apri Progetto</h3>
        </div>
        {availableMaps.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 px-6">
            <Database size={40} className="text-brand-300 mb-3" />
            <p className="text-brand-500 text-sm text-center">Nessun progetto salvato trovato.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
            {availableMaps.map(map => (
              <div key={map.id} className="flex items-center gap-3 p-3 bg-brand-50 rounded-xl border border-brand-200 hover:border-accent/40 hover:bg-white transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-brand-800 truncate">{map.name}</div>
                  <div className="text-xs text-brand-500 mt-0.5">
                    {new Date(map.updatedAt).toLocaleDateString('it-IT', {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleLoadMap(map)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-xl text-xs font-semibold"
                  >
                    <FolderOpen size={13} />
                    Apri
                  </button>
                  <button
                    onClick={() => handleDeleteMap(map.id)}
                    className="w-8 h-8 flex items-center justify-center bg-danger/10 text-danger rounded-xl"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="px-6 py-4 border-t border-brand-200">
          <button
            onClick={() => setShowLoadDialog(false)}
            className="w-full py-2.5 rounded-xl border border-brand-200 text-brand-700 text-sm font-semibold"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );

  // Show initial load prompt
  if (!imageUrl) {
    return (
      <div className="flex flex-col h-screen bg-brand-100">
        {/* Header */}
        <div className="bg-white border-b border-brand-200 px-5 py-4 flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center active:scale-95 transition-transform"
          >
            <ArrowLeft size={20} className="text-brand-700" />
          </button>
          <h1 className="text-lg font-bold text-brand-800">Editor Planimetrie</h1>
        </div>

        {/* Load prompt */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm text-center space-y-4">
            <Map size={64} className="mx-auto text-brand-300" />
            <div>
              <h2 className="text-2xl font-bold text-brand-800">Carica una Planimetria</h2>
              <p className="text-brand-500 text-sm mt-1">Seleziona un file immagine o PDF per iniziare ad annotare</p>
            </div>
            <button
              onClick={handleLoadFloorPlan}
              className="w-full flex items-center justify-center gap-2 bg-accent text-white rounded-2xl py-3 font-semibold active:scale-[0.98] transition-transform shadow-card"
            >
              <Upload size={18} />
              Carica Planimetria
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <div className="flex items-center gap-3 text-brand-400 text-xs">
              <div className="flex-1 h-px bg-brand-200" />
              <span>oppure</span>
              <div className="flex-1 h-px bg-brand-200" />
            </div>
            <button
              onClick={handleOpenFromDatabase}
              className="w-full flex items-center justify-center gap-2 bg-white border border-brand-200 text-brand-700 rounded-2xl py-3 font-semibold active:scale-[0.98] transition-transform"
            >
              <Database size={18} />
              Apri da Database
            </button>
          </div>
        </div>

        {showLoadDialog && <LoadDialogContent />}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-brand-100">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-5 py-4 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center active:scale-95 transition-transform"
          title="Torna alla Home"
        >
          <ArrowLeft size={20} className="text-brand-700" />
        </button>
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <h2 className="text-lg font-bold text-brand-800">Editor Planimetrie</h2>
          {projectName && (
            <span className="px-2 py-0.5 bg-accent/10 text-accent text-xs font-semibold rounded-xl truncate max-w-[160px]">
              {projectName}
            </span>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden relative">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-card-hover">
            <div className="px-6 py-5 border-b border-brand-200">
              <h3 className="text-lg font-bold text-brand-800">Salva Progetto</h3>
              <p className="text-sm text-brand-500 mt-1">Inserisci un nome per il progetto</p>
            </div>
            <div className="px-6 py-4">
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Nome progetto..."
                autoFocus
                className="w-full px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-800 placeholder-brand-400 focus:outline-none focus:border-accent"
              />
            </div>
            <div className="px-6 py-4 border-t border-brand-200 flex gap-3">
              <button
                onClick={() => setShowNameDialog(false)}
                className="flex-1 py-2.5 rounded-xl border border-brand-200 text-brand-700 text-sm font-semibold"
              >
                Annulla
              </button>
              <button
                onClick={handleNameDialogConfirm}
                className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold"
              >
                Salva
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Dialog */}
      {showLoadDialog && <LoadDialogContent />}
    </div>
  );
};

export default StandaloneFloorPlanEditor;
