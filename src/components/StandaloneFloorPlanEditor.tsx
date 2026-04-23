import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowLeft, Map, Upload, Database, FolderOpen, Trash2 } from 'lucide-react';
import FloorPlanEditor, { FloorPlanCartiglioData } from './FloorPlanEditor';
import { CanvasPoint, GridConfig } from './FloorPlanCanvas';
import {
  User,
  StandaloneMap,
  getStandaloneMaps,
  createStandaloneMap,
  updateStandaloneMap,
  deleteStandaloneMap,
  getFloorPlanBlobUrl,
  revokeFloorPlanBlobUrl,
} from '../db';
import { exportFloorPlanVectorPDF, ExportPoint, ExportCartiglioData } from '../utils/exportUtils';
import { processFloorPlan, blobToBase64 } from '../utils/floorPlanUtils';

interface StandaloneFloorPlanEditorProps {
  currentUser: User;
  onBack: () => void;
}

type ProcessedStandaloneFile = Awaited<ReturnType<typeof processFloorPlan>>;

const toExportCartiglio = (cartiglio?: Partial<FloorPlanCartiglioData> | null): ExportCartiglioData | null => {
  if (!cartiglio?.enabled) {
    return null;
  }

  const rowCount = Math.max(1, cartiglio.standaloneRowCount ?? 1);
  return {
    positionX: cartiglio.positionX ?? 0.03,
    positionY: cartiglio.positionY ?? 0.68,
    tavola: cartiglio.tavola || '',
    typologyNumbers: Array.from({ length: rowCount }, (_, index) => index + 1),
    typologyValues: { ...(cartiglio.typologyValues || {}) },
    committente: cartiglio.committente || '',
    locali: cartiglio.locali || '',
  };
};

const DEFAULT_GRID_CONFIG: GridConfig = {
  enabled: false,
  rows: 10,
  cols: 10,
  offsetX: 0,
  offsetY: 0,
};

const toStandalonePoints = (canvasPoints: CanvasPoint[]): StandaloneMap['points'] =>
  canvasPoints.map(point => ({
    id: point.id,
    pointType: point.type,
    pointX: point.pointX,
    pointY: point.pointY,
    labelX: point.labelX,
    labelY: point.labelY,
    perimeterPoints: point.perimeterPoints,
    customText: point.customText,
    labelText: point.labelText,
    labelBackgroundColor: point.labelBackgroundColor,
    labelTextColor: point.labelTextColor,
    eiRating: point.eiRating,
  }));

const StandaloneFloorPlanEditor: React.FC<StandaloneFloorPlanEditorProps> = ({
  currentUser,
  onBack,
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [currentImageBlob, setCurrentImageBlob] = useState<Blob | null>(null);
  const [currentPdfBlobBase64, setCurrentPdfBlobBase64] = useState<string | undefined>(undefined);
  const [currentPdfUrl, setCurrentPdfUrl] = useState<string | undefined>(undefined);
  const [currentOriginalFormat, setCurrentOriginalFormat] = useState<string | undefined>(undefined);
  const [processedFile, setProcessedFile] = useState<ProcessedStandaloneFile | null>(null);
  const [points, setPoints] = useState<CanvasPoint[]>([]);
  const [gridConfig, setGridConfig] = useState<GridConfig>(DEFAULT_GRID_CONFIG);
  const [rotation, setRotation] = useState<number>(0);
  const [mapMetadata, setMapMetadata] = useState<Record<string, any>>({ rotation: 0 });
  const [projectName, setProjectName] = useState<string>('');
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [availableMaps, setAvailableMaps] = useState<StandaloneMap[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const resetPreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      revokeFloorPlanBlobUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setImageUrl(null);
  }, []);

  const updatePreviewFromBlob = useCallback((blob: Blob) => {
    resetPreviewUrl();
    const blobUrl = getFloorPlanBlobUrl(blob);
    previewUrlRef.current = blobUrl;
    setImageUrl(blobUrl);
  }, [resetPreviewUrl]);

  useEffect(() => () => resetPreviewUrl(), [resetPreviewUrl]);

  const resetEditorState = useCallback(() => {
    resetPreviewUrl();
    setCurrentImageBlob(null);
    setCurrentPdfBlobBase64(undefined);
    setCurrentPdfUrl(undefined);
    setCurrentOriginalFormat(undefined);
    setProcessedFile(null);
    setPoints([]);
    setGridConfig(DEFAULT_GRID_CONFIG);
    setRotation(0);
    setMapMetadata({ rotation: 0 });
    setProjectName('');
    setCurrentMapId(null);
    setCurrentFile(null);
  }, [resetPreviewUrl]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
      alert('❌ Per favore seleziona un file immagine o PDF valido.');
      return;
    }

    try {
      const processed = await processFloorPlan(file);
      const pdfBlobBase64 = processed.pdfBlob
        ? await blobToBase64(processed.pdfBlob)
        : undefined;

      setCurrentFile(file);
      setProcessedFile(processed);
      setCurrentImageBlob(processed.fullRes);
      setCurrentPdfBlobBase64(pdfBlobBase64);
      setCurrentPdfUrl(undefined);
      setCurrentOriginalFormat(processed.originalFormat);
      setCurrentMapId(null);
      setProjectName('');
      setPoints([]);
      setGridConfig(DEFAULT_GRID_CONFIG);
      setRotation(0);
      setMapMetadata({ rotation: 0 });
      updatePreviewFromBlob(processed.fullRes);
    } catch (error) {
      console.error('Floor plan processing error:', error);
      alert('❌ Errore durante la preparazione della planimetria');
    }
  }, [updatePreviewFromBlob]);

  const handleLoadFloorPlan = useCallback(() => {
    if (points.length > 0 || projectName) {
      const confirmed = window.confirm('⚠️ Vuoi creare un nuovo progetto? Il lavoro non salvato andrà perso.');
      if (!confirmed) {
        return;
      }
    }

    resetEditorState();
    fileInputRef.current?.click();
  }, [points.length, projectName, resetEditorState]);

  const handleSave = useCallback(async (savedPoints: CanvasPoint[], savedGridConfig: GridConfig, savedCartiglio: FloorPlanCartiglioData) => {
    setPoints(savedPoints);
    setGridConfig(savedGridConfig);
    setMapMetadata(prev => ({ ...prev, cartiglio: savedCartiglio }));
    alert('✅ Modifiche salvate localmente');
  }, []);

  const handleExportPDF = useCallback(async (context?: {
    points: CanvasPoint[];
    eiLegendPosition: { x: number; y: number } | null;
    cartiglio?: FloorPlanCartiglioData;
  }) => {
    if (!currentImageBlob) {
      alert('❌ Nessuna planimetria caricata');
      return;
    }

    try {
      const exportPoints: ExportPoint[] = (context?.points ?? points).map(point => ({
        type: point.type,
        pointX: point.pointX,
        pointY: point.pointY,
        labelX: point.labelX,
        labelY: point.labelY,
        labelText: point.labelText,
        perimeterPoints: point.perimeterPoints,
        labelBackgroundColor: point.labelBackgroundColor,
        labelTextColor: point.labelTextColor,
        eiRating: point.eiRating,
      }));
      const filename = projectName ? `${projectName}.pdf` : 'planimetria.pdf';
      await exportFloorPlanVectorPDF(
        currentImageBlob,
        exportPoints,
        filename,
        currentPdfBlobBase64,
        rotation,
        context?.eiLegendPosition,
        toExportCartiglio(context?.cartiglio ?? mapMetadata.cartiglio),
      );
      alert('✅ Planimetria esportata in PDF');
    } catch (error) {
      console.error('Export PDF error:', error);
      alert('❌ Errore durante l\'esportazione PDF');
    }
  }, [currentImageBlob, currentPdfBlobBase64, points, projectName, rotation, mapMetadata.cartiglio]);

  const handleSaveToDatabase = useCallback(async (currentPoints: CanvasPoint[], currentGridConfig: GridConfig, currentCartiglio: FloorPlanCartiglioData) => {
    if (!currentImageBlob) {
      alert('❌ Nessuna planimetria caricata');
      return;
    }

    setPoints(currentPoints);
    setGridConfig(currentGridConfig);
    setMapMetadata(prev => ({ ...prev, cartiglio: currentCartiglio }));
    setShowNameDialog(true);
  }, [currentImageBlob]);

  const handleNameDialogConfirm = useCallback(async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      alert('❌ Per favore inserisci un nome per il progetto');
      return;
    }

      const standalonePoints = toStandalonePoints(points);
    const nextMetadata = { ...mapMetadata, rotation };

    setShowNameDialog(false);

    try {
      if (currentMapId) {
        await updateStandaloneMap(currentMapId, {
          name: trimmedName,
          points: standalonePoints,
          gridEnabled: gridConfig.enabled,
          gridConfig: {
            rows: gridConfig.rows || 10,
            cols: gridConfig.cols || 10,
            offsetX: gridConfig.offsetX || 0,
            offsetY: gridConfig.offsetY || 0,
          },
          metadata: nextMetadata,
          pdfBlobBase64: currentPdfBlobBase64,
          pdfUrl: currentPdfUrl,
          originalFormat: currentOriginalFormat,
        });
        setMapMetadata(nextMetadata);
        setProjectName(trimmedName);
        alert('✅ Progetto aggiornato con successo');
        return;
      }

      if (!currentFile) {
        alert('❌ Nessun file caricato. Per favore carica prima una planimetria');
        return;
      }

      const newMap = await createStandaloneMap(
        currentUser.id,
        trimmedName,
        currentFile,
        undefined,
        processedFile || undefined,
      );

      await updateStandaloneMap(newMap.id, {
        points: standalonePoints,
        gridEnabled: gridConfig.enabled,
        gridConfig: {
          rows: gridConfig.rows || 10,
          cols: gridConfig.cols || 10,
          offsetX: gridConfig.offsetX || 0,
          offsetY: gridConfig.offsetY || 0,
        },
        metadata: nextMetadata,
      });

      setCurrentMapId(newMap.id);
      setProjectName(trimmedName);
      setCurrentImageBlob(newMap.imageBlob ?? null);
      setCurrentPdfBlobBase64(newMap.pdfBlobBase64);
      setCurrentPdfUrl(newMap.pdfUrl);
      setCurrentOriginalFormat(newMap.originalFormat);
      setMapMetadata(nextMetadata);
      alert('✅ Progetto creato e salvato con successo');
    } catch (error) {
      console.error('Error saving map:', error);
      alert('❌ Errore durante il salvataggio del progetto');
    }
  }, [
    currentFile,
    currentMapId,
    currentOriginalFormat,
    currentPdfBlobBase64,
    currentPdfUrl,
    currentUser.id,
    gridConfig,
    mapMetadata,
    points,
    processedFile,
    projectName,
    rotation,
  ]);

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

  const handleLoadMap = useCallback(async (map: StandaloneMap) => {
    try {
      if (!map.imageBlob) {
        alert('Errore: immagine della mappa non disponibile');
        return;
      }

      updatePreviewFromBlob(map.imageBlob);
      setProjectName(map.name);
      setCurrentMapId(map.id);
      setCurrentFile(null);
      setProcessedFile(null);
      setCurrentImageBlob(map.imageBlob);
      setCurrentPdfBlobBase64(map.pdfBlobBase64);
      setCurrentPdfUrl(map.pdfUrl);
      setCurrentOriginalFormat(map.originalFormat);

      const nextMetadata = map.metadata || {};
      const nextRotation = typeof nextMetadata.rotation === 'number' ? nextMetadata.rotation : 0;

      const canvasPoints: CanvasPoint[] = map.points.map(point => ({
        id: point.id,
        type: point.pointType,
        pointX: point.pointX,
        pointY: point.pointY,
        labelX: point.labelX,
        labelY: point.labelY,
        labelText: point.labelText || (point.customText ? [point.customText] : ['Punto']),
        perimeterPoints: point.perimeterPoints,
        customText: point.customText,
        labelBackgroundColor: point.labelBackgroundColor,
        labelTextColor: point.labelTextColor,
        eiRating: point.eiRating,
      }));

      setPoints(canvasPoints);
      setGridConfig({
        enabled: map.gridEnabled,
        rows: map.gridConfig.rows,
        cols: map.gridConfig.cols,
        offsetX: map.gridConfig.offsetX,
        offsetY: map.gridConfig.offsetY,
      });
      setRotation(nextRotation);
      setMapMetadata({ ...nextMetadata, rotation: nextRotation });
      setShowLoadDialog(false);
      alert('✅ Progetto caricato con successo');
    } catch (error) {
      console.error('Error loading map:', error);
      alert('❌ Errore durante il caricamento del progetto');
    }
  }, [updatePreviewFromBlob]);

  const handleDeleteMap = useCallback(async (mapId: string) => {
    const confirmed = window.confirm('⚠️ Sei sicuro di voler eliminare questo progetto?');
    if (!confirmed) {
      return;
    }

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

  const handleRotationChange = useCallback((nextRotation: number) => {
    setRotation(nextRotation);
    setMapMetadata(prev => ({ ...prev, rotation: nextRotation }));
  }, []);

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
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
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

  if (!imageUrl) {
    return (
      <div className="flex flex-col h-[100dvh] bg-brand-100">
        <div className="bg-white border-b border-brand-200 px-5 py-4 flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center active:scale-95 transition-transform"
          >
            <ArrowLeft size={20} className="text-brand-700" />
          </button>
          <h1 className="text-lg font-bold text-brand-800">Editor Planimetrie</h1>
        </div>

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
    <div className="flex flex-col h-[100dvh] bg-brand-100">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

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

      <div className="flex-1 overflow-hidden relative">
        <FloorPlanEditor
          key={`${currentMapId || 'new'}:${imageUrl}`}
          imageUrl={imageUrl}
          initialPoints={points}
          initialGridConfig={gridConfig}
          mode="standalone"
          initialRotation={rotation}
          initialCartiglio={mapMetadata.cartiglio}
          onRotationChange={handleRotationChange}
          onSave={handleSave}
          onNewFile={handleLoadFloorPlan}
          onOpenFile={handleOpenFromDatabase}
          onSaveFile={handleSaveToDatabase}
          onExportPDF={handleExportPDF}
          allowCustomTypologyRows
        />
      </div>

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

      {showLoadDialog && <LoadDialogContent />}
    </div>
  );
};

export default StandaloneFloorPlanEditor;
