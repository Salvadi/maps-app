import React, { useState, useRef, useEffect } from 'react';
import imageCompression from 'browser-image-compression';
import {
  ArrowLeft, ArrowRight, Check, Camera, MapPin,
  Plus, X, ChevronDown, Image, AlertTriangle, Eye
} from 'lucide-react';
import { validateFileSignature } from '../utils/validation';
import {
  Project, Crossing, User, MappingEntry, calcAsolaMq,
  createMappingEntry, getMappingEntriesForProject,
  updateMappingEntry, getPhotosForMapping,
  addPhotosToMapping, removePhotoFromMapping,
  FloorPlan, FloorPlanPoint,
  getFloorPlanByProjectAndFloor, getFloorPlanPointByMappingEntry,
  createFloorPlanPoint, updateFloorPlanPoint, updateFloorPlan,
  updateFloorPlanLabelsForMapping, getFloorPlanBlobUrl, getFloorPlanPoints
} from '../db';
import { useDropdownOptions } from '../hooks/useDropdownOptions';
import PhotoPreviewModal from './PhotoPreviewModal';
import TypologyViewerModal from './TypologyViewerModal';
import FloorPlanEditor from './FloorPlanEditor';
import type { CanvasPoint, GridConfig } from './FloorPlanCanvas';

interface MappingWizardProps {
  project: Project | null;
  currentUser: User;
  onBack: () => void;
  editingEntry?: MappingEntry;
  onSync?: () => void;
  isSyncing?: boolean;
}

type Step = 0 | 1 | 2;

const STEP_LABELS = ['Posizione', 'Attraversamenti', 'Foto'];

const MappingWizard: React.FC<MappingWizardProps> = ({
  project, currentUser, onBack, editingEntry, onSync, isSyncing
}) => {
  const SUPPORTO_OPTIONS = useDropdownOptions('supporto');
  const TIPO_SUPPORTO_OPTIONS = useDropdownOptions('tipo_supporto');
  const ATTRAVERSAMENTO_OPTIONS = useDropdownOptions('attraversamento');

  const [step, setStep] = useState<Step>(0);

  // Position fields
  const getLastUsedFloor = () => {
    if (editingEntry) return editingEntry.floor;
    const lastFloor = localStorage.getItem('lastUsedFloor');
    if (lastFloor && project?.floors.includes(lastFloor)) return lastFloor;
    return project?.floors[0] || '0';
  };

  const [floor, setFloor] = useState(getLastUsedFloor());
  const [roomNumber, setRoomNumber] = useState(editingEntry?.room || '');
  const [interventionNumber, setInterventionNumber] = useState(editingEntry?.intervention || '');
  const [toComplete, setToComplete] = useState(editingEntry?.toComplete || false);

  // Crossings
  const [crossings, setCrossings] = useState<Crossing[]>(
    editingEntry && editingEntry.crossings.length > 0
      ? editingEntry.crossings
      : [{ id: `${Date.now()}-0`, supporto: '', tipoSupporto: '', attraversamento: '', tipologicoId: undefined, quantita: undefined, diametro: undefined, dimensioni: undefined, notes: '' }]
  );

  // Photos
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoIds, setPhotoIds] = useState<(string | null)[]>([]);
  const [initialPhotoCount, setInitialPhotoCount] = useState(0);
  const [photosToRemove, setPhotosToRemove] = useState<string[]>([]);
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<{ url: string; alt: string } | null>(null);

  // Floor plan
  const [showFloorPlanEditor, setShowFloorPlanEditor] = useState(false);
  const [currentFloorPlan, setCurrentFloorPlan] = useState<FloorPlan | null>(null);
  const [currentFloorPlanPoint, setCurrentFloorPlanPoint] = useState<FloorPlanPoint | null>(null);
  const [floorPlanImageUrl, setFloorPlanImageUrl] = useState<string | null>(null);
  const [readOnlyPoints, setReadOnlyPoints] = useState<CanvasPoint[]>([]);
  const [savedDraftEntry, setSavedDraftEntry] = useState<MappingEntry | null>(null);

  const [showTypologyViewer, setShowTypologyViewer] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState('');
  const [error, setError] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Load existing photos if editing
  useEffect(() => {
    if (editingEntry) {
      (async () => {
        const photos = await getPhotosForMapping(editingEntry.id);
        const previews = await Promise.all(
          photos.map(p => new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(p.blob);
          }))
        );
        const files = photos.map((p, i) => new File([p.blob], `photo-${i}.jpg`, { type: p.blob.type }));
        setPhotoPreviews(previews);
        setPhotoFiles(files);
        setPhotoIds(photos.map(p => p.id));
        setInitialPhotoCount(files.length);
      })();
    }
  }, [editingEntry]);

  // Auto-calculate intervention number
  useEffect(() => {
    if (!editingEntry && project?.useInterventionNumbering) {
      (async () => {
        const entries = await getMappingEntriesForProject(project.id);
        const max = entries.reduce((m, e) => {
          const n = parseInt(e.intervention || '0');
          return !isNaN(n) && n > m ? n : m;
        }, 0);
        setInterventionNumber((max + 1).toString());
      })();
    }
  }, [project, editingEntry]);

  // Load floor plan for current floor
  useEffect(() => {
    if (!project || !floor) return;
    (async () => {
      const fp = await getFloorPlanByProjectAndFloor(project.id, floor);
      setCurrentFloorPlan(fp || null);
      if (fp?.imageBlob) {
        setFloorPlanImageUrl(getFloorPlanBlobUrl(fp.imageBlob));
      } else {
        setFloorPlanImageUrl(null);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, project?.id]);

  // Duplicate check
  useEffect(() => {
    if (!project || !floor) { setDuplicateWarning(''); return; }
    (async () => {
      const entries = await getMappingEntriesForProject(project.id);
      const others = editingEntry ? entries.filter(e => e.id !== editingEntry.id) : entries;
      const dup = others.some(m => {
        const fMatch = m.floor === floor;
        const rMatch = project.useRoomNumbering ? (m.room || '') === (roomNumber || '') : true;
        const iMatch = project.useInterventionNumbering ? (m.intervention || '') === (interventionNumber || '') : true;
        return fMatch && rMatch && iMatch;
      });
      setDuplicateWarning(dup ? 'Esiste già una mappatura con questa combinazione.' : '');
    })();
  }, [floor, roomNumber, interventionNumber, project, editingEntry]);

  const handleFloorChange = (v: string) => {
    setFloor(v);
    localStorage.setItem('lastUsedFloor', v);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const allFiles = Array.from(e.target.files);

    // Validate file signatures (magic bytes) to prevent disguised file uploads
    const validFiles: File[] = [];
    for (const file of allFiles) {
      const { valid } = await validateFileSignature(file);
      if (valid) {
        validFiles.push(file);
      } else {
        console.warn(`File rifiutato (tipo non valido): ${file.name}`);
      }
    }
    if (validFiles.length === 0) return;

    setPhotoFiles(prev => [...prev, ...validFiles]);
    setPhotoIds(prev => [...prev, ...validFiles.map(() => null)]);
    const previews = await Promise.all(validFiles.map(f => new Promise<string>(r => {
      const reader = new FileReader();
      reader.onload = () => r(reader.result as string);
      reader.readAsDataURL(f);
    })));
    setPhotoPreviews(prev => [...prev, ...previews]);
  };

  const handleRemovePhoto = (index: number) => {
    const id = photoIds[index];
    if (id) {
      setPhotosToRemove(prev => [...prev, id]);
      setInitialPhotoCount(prev => prev - 1);
    }
    setPhotoFiles(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
    setPhotoIds(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddCrossing = () => {
    const last = crossings[crossings.length - 1];
    setCrossings([...crossings, {
      id: `${Date.now()}-${crossings.length}`,
      supporto: last?.supporto || '', tipoSupporto: last?.tipoSupporto || '',
      attraversamento: '', tipologicoId: undefined, quantita: undefined,
      diametro: undefined, dimensioni: undefined, notes: ''
    }]);
  };

  const handleRemoveCrossing = (i: number) => {
    if (crossings.length > 1) setCrossings(crossings.filter((_, idx) => idx !== i));
  };

  const handleCrossingChange = (i: number, field: keyof Omit<Crossing, 'id'>, value: string | number | boolean) => {
    const updated = [...crossings];
    updated[i] = { ...updated[i], [field]: typeof value === 'boolean' ? value : (value || undefined) };
    setCrossings(updated);
  };

  const needsDiametro = (a: string) => a.toLowerCase().includes('tubo');
  const needsDimensioni = (a: string) => {
    const types = ['canalina', 'serranda', 'canala', 'asola', 'altro'];
    return types.some(t => a.toLowerCase().includes(t));
  };

  const generatePhotoPrefix = () => {
    const parts: string[] = [];
    if (project?.floors && project.floors.length > 1) parts.push(`P${floor}`);
    if (project?.useRoomNumbering && roomNumber) parts.push(`S${roomNumber}`);
    if (project?.useInterventionNumbering && interventionNumber) parts.push(`Int${interventionNumber}`);
    return parts.length > 0 ? parts.join('_') + '_' : '';
  };

  const generateLabelText = (): string[] => {
    const photoName = generatePhotoPrefix() + '01';
    const tipNumbers = crossings
      .map(c => c.tipologicoId ? project?.typologies.find(t => t.id === c.tipologicoId)?.number : null)
      .filter((n): n is number => n !== null)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b)
      .join(' - ');
    return [photoName, tipNumbers ? `tip. ${tipNumbers}` : ''].filter(Boolean);
  };

  const handleCopyPrevious = async () => {
    if (!project) return;
    const entries = await getMappingEntriesForProject(project.id);
    if (entries.length === 0) { alert('Nessuna mappatura precedente nel progetto'); return; }
    // Find the most recently updated/created entry
    const sorted = entries.sort((a, b) => b.timestamp - a.timestamp);
    const last = sorted[0];
    setFloor(last.floor || floor);
    setRoomNumber(last.room || '');
    setCrossings(
      last.crossings.length > 0
        ? last.crossings.map((c, ci) => ({ ...c, id: `${Date.now()}-${ci}` }))
        : [{ id: `${Date.now()}-0`, supporto: '', tipoSupporto: '', attraversamento: '', tipologicoId: undefined, quantita: undefined, diametro: undefined, dimensioni: undefined, notes: '' }]
    );
    if (project.useInterventionNumbering) {
      const max = entries.reduce((m, e) => { const n = parseInt(e.intervention || '0'); return !isNaN(n) && n > m ? n : m; }, 0);
      setInterventionNumber((max + 1).toString());
    }
  };

  const handleOpenFloorPlanEditor = async () => {
    if (!currentFloorPlan || !project) return;
    const currentEntry = editingEntry || savedDraftEntry;
    if (!currentEntry) {
      setIsSubmitting(true);
      try {
        const draft = await createMappingEntry({
          projectId: project.id, floor,
          room: project.useRoomNumbering ? roomNumber : undefined,
          intervention: project.useInterventionNumbering ? interventionNumber : undefined,
          toComplete: true,
          crossings: crossings.map((s, i) => ({ ...s, id: s.id || `${Date.now()}-${i}` })),
          createdBy: currentUser.id,
        }, []);
        setSavedDraftEntry(draft);
      } catch { return; } finally { setIsSubmitting(false); }
    }
    const entryToCheck = editingEntry || savedDraftEntry;
    if (entryToCheck) {
      const pt = await getFloorPlanPointByMappingEntry(entryToCheck.id);
      setCurrentFloorPlanPoint(pt || null);
    }
    try {
      const allPts = await getFloorPlanPoints(currentFloorPlan.id);
      const cid = (editingEntry || savedDraftEntry)?.id;
      setReadOnlyPoints(allPts.filter(p => p.mappingEntryId !== cid).map(p => ({
        id: p.id, type: p.pointType as CanvasPoint['type'],
        pointX: p.pointX, pointY: p.pointY, labelX: p.labelX, labelY: p.labelY,
        labelText: p.metadata?.labelText || ['Punto'], perimeterPoints: p.perimeterPoints,
        mappingEntryId: p.mappingEntryId,
        labelBackgroundColor: p.metadata?.labelBackgroundColor,
        labelTextColor: p.metadata?.labelTextColor,
      })));
    } catch { setReadOnlyPoints([]); }
    setShowFloorPlanEditor(true);
  };

  const handleSaveFloorPlanPoint = async (points: CanvasPoint[], gridConfig: GridConfig) => {
    if (!currentFloorPlan) return;
    const entry = editingEntry || savedDraftEntry;
    if (!entry) return;
    const point = points[0];
    if (!point) { setShowFloorPlanEditor(false); return; }
    try {
      if (currentFloorPlanPoint) {
        await updateFloorPlanPoint(currentFloorPlanPoint.id, {
          pointType: point.type, pointX: point.pointX, pointY: point.pointY,
          labelX: point.labelX, labelY: point.labelY,
          perimeterPoints: point.perimeterPoints, customText: point.customText,
        });
      } else {
        await createFloorPlanPoint(currentFloorPlan.id, entry.id, point.type,
          point.pointX, point.pointY, point.labelX, point.labelY, currentUser.id,
          { perimeterPoints: point.perimeterPoints, customText: point.customText });
      }
      await updateFloorPlan(currentFloorPlan.id, { gridEnabled: gridConfig.enabled, gridConfig: { rows: gridConfig.rows, cols: gridConfig.cols, offsetX: gridConfig.offsetX, offsetY: gridConfig.offsetY } });
      alert('Punto salvato sulla planimetria!');
    } catch { alert('Errore nel salvataggio del punto'); }
  };

  const handleSubmit = async () => {
    if (!project) { setError('Nessun progetto selezionato'); return; }
    setIsSubmitting(true);
    setError('');

    try {
      const existing = editingEntry || savedDraftEntry;
      const photosToCompress = existing ? photoFiles.slice(initialPhotoCount) : photoFiles;
      let compressedBlobs: Blob[] = [];

      if (photosToCompress.length > 0) {
        const results: Blob[] = [];
        for (let i = 0; i < photosToCompress.length; i++) {
          setCompressionProgress(`Compressione foto ${i + 1}/${photosToCompress.length}...`);
          const compressed = await imageCompression(photosToCompress[i], {
            maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true
          }) as Blob;
          results.push(compressed);
        }
        setCompressionProgress('');
        compressedBlobs = results;
      }

      if (existing) {
        const finalPhotoCount = photoFiles.length;
        await updateMappingEntry(existing.id, {
          floor,
          room: project.useRoomNumbering ? roomNumber : undefined,
          intervention: project.useInterventionNumbering ? interventionNumber : undefined,
          toComplete: finalPhotoCount === 0 || toComplete,
          crossings: crossings.map((s, i) => ({ ...s, id: s.id || `${Date.now()}-${i}` })),
        }, currentUser.id);

        try { await updateFloorPlanLabelsForMapping(existing.id, () => generateLabelText()); } catch {}

        for (const id of photosToRemove) {
          await removePhotoFromMapping(existing.id, id, currentUser.id);
        }
        if (compressedBlobs.length > 0) {
          await addPhotosToMapping(existing.id, compressedBlobs, currentUser.id);
        }
        alert('Mappatura aggiornata!');
      } else {
        await createMappingEntry({
          projectId: project.id, floor,
          room: project.useRoomNumbering ? roomNumber : undefined,
          intervention: project.useInterventionNumbering ? interventionNumber : undefined,
          toComplete: compressedBlobs.length === 0 || toComplete,
          crossings: crossings.map((s, i) => ({ ...s, id: `${Date.now()}-${i}` })),
          createdBy: currentUser.id,
        }, compressedBlobs);

        alert('Mappatura salvata!');
      }
      onBack();
    } catch (err) {
      console.error('Save error:', err);
      setError('Errore nel salvataggio. Riprova.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Floor plan editor
  if (showFloorPlanEditor && currentFloorPlan && floorPlanImageUrl) {
    const initialPoint = currentFloorPlanPoint ? [{
      id: currentFloorPlanPoint.id,
      type: currentFloorPlanPoint.pointType as CanvasPoint['type'],
      pointX: currentFloorPlanPoint.pointX, pointY: currentFloorPlanPoint.pointY,
      labelX: currentFloorPlanPoint.labelX, labelY: currentFloorPlanPoint.labelY,
      labelText: currentFloorPlanPoint.metadata?.labelText || generateLabelText(),
      perimeterPoints: currentFloorPlanPoint.perimeterPoints,
      mappingEntryId: currentFloorPlanPoint.mappingEntryId,
      labelBackgroundColor: currentFloorPlanPoint.metadata?.labelBackgroundColor,
      labelTextColor: currentFloorPlanPoint.metadata?.labelTextColor,
    }] : [];

    return (
      <FloorPlanEditor
        imageUrl={floorPlanImageUrl}
        initialPoints={initialPoint}
        initialGridConfig={currentFloorPlan.gridEnabled ? {
          enabled: currentFloorPlan.gridEnabled,
          rows: currentFloorPlan.gridConfig?.rows || 10,
          cols: currentFloorPlan.gridConfig?.cols || 10,
          offsetX: currentFloorPlan.gridConfig?.offsetX || 0,
          offsetY: currentFloorPlan.gridConfig?.offsetY || 0,
        } : undefined}
        mode="mapping"
        maxPoints={1}
        readOnlyPoints={readOnlyPoints}
        onSave={handleSaveFloorPlanPoint}
        onClose={() => setShowFloorPlanEditor(false)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-brand-100">
      {/* Header */}
      <div className="bg-white shadow-card z-10 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="w-9 h-9 rounded-xl flex items-center justify-center text-brand-600 hover:bg-brand-50">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold text-brand-800 flex-1">
            {editingEntry ? 'Modifica Mappatura' : 'Nuova Mappatura'}
          </h1>
          {!editingEntry && (
            <button onClick={handleCopyPrevious} className="text-xs text-accent font-medium px-3 py-1.5 bg-accent/10 rounded-lg">
              Copia prec.
            </button>
          )}
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEP_LABELS.map((label, i) => (
            <React.Fragment key={i}>
              <button
                onClick={() => setStep(i as Step)}
                className="flex items-center gap-1.5"
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  i < step ? 'bg-success text-white' :
                  i === step ? 'bg-accent text-white' :
                  'bg-brand-200 text-brand-500'
                }`}>
                  {i < step ? <Check size={14} /> : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:inline ${
                  i === step ? 'text-accent' : 'text-brand-500'
                }`}>{label}</span>
              </button>
              {i < 2 && <div className={`flex-1 h-0.5 rounded ${i < step ? 'bg-success' : 'bg-brand-200'}`} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Hidden file inputs */}
      <input ref={cameraInputRef} type="file" onChange={handleImageChange} accept="image/*" capture="environment" multiple className="hidden" />
      <input ref={fileInputRef} type="file" onChange={handleImageChange} accept="image/*" multiple className="hidden" />

      {/* Step content */}
      <div className="flex-1 overflow-auto px-4 pt-4 pb-32">
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-danger text-sm rounded-xl flex items-center gap-2">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}
        {duplicateWarning && (
          <div className="mb-4 p-3 bg-orange-50 text-warning text-sm font-medium rounded-xl flex items-center gap-2">
            <AlertTriangle size={16} />
            {duplicateWarning}
          </div>
        )}

        {/* STEP 0: Position */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-card p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-brand-600 mb-1.5">Piano</label>
                <div className="relative">
                  <select
                    value={floor}
                    onChange={e => handleFloorChange(e.target.value)}
                    className="w-full px-4 py-3 bg-brand-50 rounded-xl text-sm text-brand-800 appearance-none focus:ring-2 focus:ring-accent/30 outline-none"
                  >
                    {(project?.floors || ['0']).sort((a, b) => parseFloat(a) - parseFloat(b)).map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                </div>
              </div>

              {project?.useRoomNumbering && (
                <div>
                  <label className="block text-xs font-semibold text-brand-600 mb-1.5">Stanza</label>
                  <input
                    type="text"
                    value={roomNumber}
                    onChange={e => setRoomNumber(e.target.value)}
                    placeholder="Es. 3"
                    className="w-full px-4 py-3 bg-brand-50 rounded-xl text-sm text-brand-800 placeholder:text-brand-400 focus:ring-2 focus:ring-accent/30 outline-none"
                  />
                </div>
              )}

              {project?.useInterventionNumbering && (
                <div>
                  <label className="block text-xs font-semibold text-brand-600 mb-1.5">Intervento n.</label>
                  <input
                    type="text"
                    value={interventionNumber}
                    onChange={e => setInterventionNumber(e.target.value)}
                    placeholder="Es. 1"
                    className="w-full px-4 py-3 bg-brand-50 rounded-xl text-sm text-brand-800 placeholder:text-brand-400 focus:ring-2 focus:ring-accent/30 outline-none"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 1: Crossings */}
        {step === 1 && (
          <div className="space-y-3">
            {/* Typology viewer button */}
            {project?.typologies && project.typologies.length > 0 && (
              <button
                onClick={() => setShowTypologyViewer(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-white rounded-xl shadow-card text-xs font-medium text-accent active:bg-accent/5 transition-colors"
              >
                <Eye size={14} />
                Visualizza tipologici ({project.typologies.length})
              </button>
            )}

            {crossings.map((crossing, i) => (
              <div key={crossing.id} className="bg-white rounded-2xl shadow-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-brand-600">Attraversamento {i + 1}</span>
                  {crossings.length > 1 && (
                    <button onClick={() => handleRemoveCrossing(i)} className="text-danger/60 hover:text-danger">
                      <X size={16} />
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-brand-500 mb-1">Supporto</label>
                    <div className="relative">
                      <select
                        value={crossing.supporto}
                        onChange={e => handleCrossingChange(i, 'supporto', e.target.value)}
                        className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-accent/30 outline-none"
                      >
                        <option value="">Seleziona...</option>
                        {SUPPORTO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-brand-500 mb-1">Tipo Supporto</label>
                    <div className="relative">
                      <select
                        value={crossing.tipoSupporto}
                        onChange={e => handleCrossingChange(i, 'tipoSupporto', e.target.value)}
                        className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-accent/30 outline-none"
                      >
                        <option value="">Seleziona...</option>
                        {TIPO_SUPPORTO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-brand-500 mb-1">Attraversamento</label>
                    <div className="relative">
                      <select
                        value={crossing.attraversamento}
                        onChange={e => handleCrossingChange(i, 'attraversamento', e.target.value)}
                        className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-accent/30 outline-none"
                      >
                        <option value="">Seleziona...</option>
                        {ATTRAVERSAMENTO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Typology selector */}
                  {project?.typologies && project.typologies.length > 0 && (
                    <div>
                      <label className="block text-[11px] font-medium text-brand-500 mb-1">Tipologico</label>
                      <div className="relative">
                        <select
                          value={crossing.tipologicoId || ''}
                          onChange={e => {
                            const tipId = e.target.value;
                            const updated = [...crossings];
                            updated[i] = { ...updated[i], tipologicoId: tipId || undefined };
                            if (tipId) {
                              const tip = project.typologies.find(t => t.id === tipId);
                              if (tip) {
                                updated[i].supporto = tip.supporto;
                                updated[i].tipoSupporto = tip.tipoSupporto;
                                updated[i].attraversamento = tip.attraversamento;
                              }
                            }
                            setCrossings(updated);
                          }}
                          className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-accent/30 outline-none"
                        >
                          <option value="">Nessuno</option>
                          {project.typologies.sort((a, b) => a.number - b.number).map(t => {
                            const products = t.prodottiSelezionati && t.prodottiSelezionati.length > 0
                              ? t.prodottiSelezionati.join(', ')
                              : '';
                            const brand = t.marcaProdottoUtilizzato || '';
                            const info = [brand, products].filter(Boolean).join(' - ');
                            return (
                              <option key={t.id} value={t.id}>
                                #{t.number} - {t.supporto} / {t.attraversamento}
                                {info ? ` (${info})` : ''}
                              </option>
                            );
                          })}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                      </div>
                      {/* Show linked typology info */}
                      {crossing.tipologicoId && (() => {
                        const tip = project.typologies.find(t => t.id === crossing.tipologicoId);
                        if (!tip || (!tip.marcaProdottoUtilizzato && (!tip.prodottiSelezionati || tip.prodottiSelezionati.length === 0))) return null;
                        return (
                          <div className="mt-1.5 px-3 py-2 bg-accent/5 rounded-lg border border-accent/10">
                            {tip.marcaProdottoUtilizzato && (
                              <div className="text-[11px] text-brand-600">
                                <span className="font-medium text-brand-500">Marca:</span> {tip.marcaProdottoUtilizzato}
                              </div>
                            )}
                            {tip.prodottiSelezionati && tip.prodottiSelezionati.length > 0 && (
                              <div className="text-[11px] text-brand-600 mt-0.5">
                                <span className="font-medium text-brand-500">Prodotti:</span> {tip.prodottiSelezionati.join(', ')}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-brand-500 mb-1">Quantità</label>
                      <input
                        type="number"
                        value={crossing.quantita || ''}
                        onChange={e => handleCrossingChange(i, 'quantita', parseInt(e.target.value))}
                        placeholder="Qt."
                        className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm focus:ring-2 focus:ring-accent/30 outline-none"
                      />
                    </div>
                    {needsDiametro(crossing.attraversamento) && (
                      <div>
                        <label className="block text-[11px] font-medium text-brand-500 mb-1">Diametro (mm)</label>
                        <input
                          type="text"
                          value={crossing.diametro || ''}
                          onChange={e => handleCrossingChange(i, 'diametro', e.target.value)}
                          className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm focus:ring-2 focus:ring-accent/30 outline-none"
                        />
                      </div>
                    )}
                    {needsDimensioni(crossing.attraversamento) && (
                      <div>
                        <label className="block text-[11px] font-medium text-brand-500 mb-1">Dimensioni</label>
                        <input
                          type="text"
                          value={crossing.dimensioni || ''}
                          onChange={e => handleCrossingChange(i, 'dimensioni', e.target.value)}
                          className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm focus:ring-2 focus:ring-accent/30 outline-none"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-brand-500 mb-1">Note</label>
                    <input
                      type="text"
                      value={crossing.notes || ''}
                      onChange={e => handleCrossingChange(i, 'notes', e.target.value)}
                      placeholder="Note opzionali..."
                      className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm placeholder:text-brand-400 focus:ring-2 focus:ring-accent/30 outline-none"
                    />
                  </div>

                  {/* In asola toggle */}
                  <div className="border-t border-brand-100 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-brand-600">In asola</span>
                      <button
                        type="button"
                        onClick={() => {
                          const newVal = !crossing.inAsola;
                          const updated = [...crossings];
                          updated[i] = {
                            ...updated[i],
                            inAsola: newVal,
                            asolaB: newVal ? updated[i].asolaB : undefined,
                            asolaH: newVal ? updated[i].asolaH : undefined,
                          };
                          setCrossings(updated);
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${crossing.inAsola ? 'bg-accent' : 'bg-brand-200'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${crossing.inAsola ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                    {crossing.inAsola && (
                      <div className="mt-2.5 space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-medium text-brand-500 mb-1">Larghezza B (cm)</label>
                            <input
                              type="number"
                              min="1"
                              step="0.1"
                              value={crossing.asolaB ?? ''}
                              onChange={e => handleCrossingChange(i, 'asolaB', parseFloat(e.target.value))}
                              placeholder="es. 40"
                              className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm placeholder:text-brand-400 focus:ring-2 focus:ring-accent/30 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-brand-500 mb-1">Altezza H (cm)</label>
                            <input
                              type="number"
                              min="1"
                              step="0.1"
                              value={crossing.asolaH ?? ''}
                              onChange={e => handleCrossingChange(i, 'asolaH', parseFloat(e.target.value))}
                              placeholder="es. 30"
                              className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm placeholder:text-brand-400 focus:ring-2 focus:ring-accent/30 outline-none"
                            />
                          </div>
                        </div>
                        {(() => {
                          const hasSize = crossing.asolaB && crossing.asolaH;
                          const realMq = hasSize ? (crossing.asolaB! * crossing.asolaH!) / 10000 : 0;
                          const mq = hasSize ? calcAsolaMq(crossing.asolaB!, crossing.asolaH!) : 0.2;
                          const isMin = !hasSize || realMq < 0.2;
                          return (
                            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${isMin ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
                              <span>Area asola: {mq.toFixed(2)} mq</span>
                              {isMin && <span className="text-[10px] opacity-75">(min 0,2 applicato)</span>}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={handleAddCrossing}
              className="w-full py-3 border-2 border-dashed border-brand-300 rounded-2xl text-sm font-medium text-brand-500 flex items-center justify-center gap-2 active:bg-brand-50"
            >
              <Plus size={16} />
              Aggiungi attraversamento
            </button>
          </div>
        )}

        {/* STEP 2: Photos & Floor Plan */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Photo buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 bg-accent text-white rounded-2xl py-4 flex flex-col items-center gap-2 active:scale-[0.98] transition-transform shadow-card"
              >
                <Camera size={24} />
                <span className="text-sm font-semibold">Scatta Foto</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 bg-white text-brand-700 rounded-2xl py-4 flex flex-col items-center gap-2 active:scale-[0.98] transition-transform shadow-card border border-brand-200"
              >
                <Image size={24} />
                <span className="text-sm font-semibold">Sfoglia</span>
              </button>
            </div>

            {/* Photo grid */}
            {photoPreviews.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {photoPreviews.map((preview, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-brand-50">
                    <img
                      src={preview}
                      alt={`Foto ${i + 1}`}
                      onClick={() => setSelectedPhotoPreview({ url: preview, alt: `Foto ${i + 1}` })}
                      className="w-full h-full object-cover cursor-pointer"
                    />
                    <button
                      onClick={() => handleRemovePhoto(i)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Floor plan button */}
            {currentFloorPlan && (
              <button
                onClick={handleOpenFloorPlanEditor}
                className="w-full bg-white rounded-2xl shadow-card p-4 flex items-center gap-3 active:scale-[0.99] transition-transform"
              >
                <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
                  <MapPin size={18} className="text-success" />
                </div>
                <div className="text-left flex-1">
                  <div className="text-sm font-semibold text-brand-700">
                    {editingEntry ? 'Modifica punto su planimetria' : 'Posiziona su planimetria'}
                  </div>
                  <div className="text-xs text-brand-500">Piano {floor}</div>
                </div>
              </button>
            )}

            {/* To complete checkbox */}
            <label className="flex items-center gap-3 bg-white rounded-2xl shadow-card p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={toComplete}
                onChange={e => setToComplete(e.target.checked)}
                className="w-5 h-5 rounded-md border-2 border-brand-300 text-accent accent-accent"
              />
              <div>
                <div className="text-sm font-medium text-brand-700">Da completare</div>
                <div className="text-xs text-brand-500">Segna come mappatura incompleta</div>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Bottom action buttons */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-brand-200 px-4 py-3 pb-safe-bottom z-40">
        <div className="flex gap-3 max-w-lg mx-auto">
          {step > 0 && (
            <button
              onClick={() => setStep((step - 1) as Step)}
              className="flex-1 py-3.5 bg-brand-100 text-brand-700 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
            >
              <ArrowLeft size={16} />
              Indietro
            </button>
          )}
          {step < 2 ? (
            <button
              onClick={() => setStep((step + 1) as Step)}
              className="flex-1 py-3.5 bg-accent text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              Avanti
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 py-3.5 bg-success text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              <Check size={16} />
              {compressionProgress || (isSubmitting ? 'Salvataggio...' : editingEntry ? 'Aggiorna' : 'Salva')}
            </button>
          )}
        </div>
      </div>

      {/* Photo preview modal */}
      {selectedPhotoPreview && (
        <PhotoPreviewModal
          imageUrl={selectedPhotoPreview.url}
          altText={selectedPhotoPreview.alt}
          onClose={() => setSelectedPhotoPreview(null)}
        />
      )}

      {/* Typology viewer modal */}
      {showTypologyViewer && project && (
        <TypologyViewerModal
          project={project}
          onClose={() => setShowTypologyViewer(false)}
        />
      )}
    </div>
  );
};

export default MappingWizard;
