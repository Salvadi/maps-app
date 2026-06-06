import React, { useState, useRef, useEffect } from 'react';
import imageCompression from 'browser-image-compression';
import {
  ArrowLeft, ArrowRight, Check, Camera, MapPin,
  Plus, X, ChevronDown, Image, AlertTriangle, Eye
} from 'lucide-react';
import { validateFileSignature } from '../utils/validation';
import {
  Project, Structure, StrutturaParte, User, StructureEntry, generateId,
  createStructureEntry, getMappingEntriesForProject,
  updateStructureEntry, deleteStructureEntry, getPhotosForStructure, ensurePhotoBlob,
  addPhotosToStructure, removePhotoFromStructure,
  FloorPlan, FloorPlanPoint, getFloorPlanByProjectAndFloor, getFloorPlanBlobUrl,
  ensureFloorPlanAsset, getFloorPlanPoints, getFloorPlanPointByMappingEntry,
  createFloorPlanPoint, updateFloorPlanPoint, updateFloorPlan,
  updateFloorPlanLabelsForMapping, getStructureEntriesForProject,
} from '../db';
import { useDropdownOptions } from '../hooks/useDropdownOptions';
import { MeasureUnit } from '../config/units';
import PhotoPreviewModal from './PhotoPreviewModal';
import TypologyViewerModal from './TypologyViewerModal';
import FloorPlanEditor from './FloorPlanEditor';
import type { CanvasPoint, GridConfig } from './FloorPlanCanvas';
import { EiRating } from './FloorPlanCanvas';

interface StructureWizardProps {
  project: Project | null;
  currentUser: User;
  onBack: () => void;
  onSaved?: () => void;
  editingEntry?: StructureEntry;
  onSync?: () => void;
  isSyncing?: boolean;
  initialStep?: Step;
}

type Step = 0 | 1 | 2;

const STEP_LABELS = ['Posizione', 'Strutture', 'Foto'];

const StructureWizard: React.FC<StructureWizardProps> = ({
  project, currentUser, onBack, onSaved, editingEntry, initialStep,
}) => {
  const STRUTTURA_OPTIONS = useDropdownOptions('struttura');
  const TIPO_STRUTTURA_OPTIONS = useDropdownOptions('tipo_struttura');

  const [step, setStep] = useState<Step>(initialStep ?? 0);

  useEffect(() => {
    window.history.pushState(
      { ...(window.history.state || {}), __wizardStep: step },
      ''
    );
  }, [step]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { view?: string; __wizardStep?: number } | null;
      if (state?.view === 'structure' && state.__wizardStep !== undefined) {
        setStep(state.__wizardStep as Step);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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

  const [structures, setStructures] = useState<Structure[]>(
    editingEntry && editingEntry.structures.length > 0
      // Migrazione: strutture legacy senza `parti` → seed da base/altezza esistenti.
      ? editingEntry.structures.map(s => ({
          ...s,
          parti: s.parti && s.parti.length > 0
            ? s.parti
            : [{ id: generateId(), base: s.base, altezza: s.altezza }],
        }))
      : [{ id: generateId(), struttura: '', tipoStruttura: '', tipologicoId: undefined, parti: [{ id: generateId() }], notes: '' }]
  );

  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoIds, setPhotoIds] = useState<(string | null)[]>([]);
  const [initialPhotoCount, setInitialPhotoCount] = useState(0);
  const [photosToRemove, setPhotosToRemove] = useState<string[]>([]);
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<{ url: string; alt: string } | null>(null);
  const [eiRating, setEiRating] = useState<EiRating | undefined>(undefined);
  const [showFloorPlanEditor, setShowFloorPlanEditor] = useState(false);
  const [currentFloorPlan, setCurrentFloorPlan] = useState<FloorPlan | null>(null);
  const [currentFloorPlanPoint, setCurrentFloorPlanPoint] = useState<FloorPlanPoint | null>(null);
  const [floorPlanImageUrl, setFloorPlanImageUrl] = useState<string | null>(null);
  const [readOnlyPoints, setReadOnlyPoints] = useState<CanvasPoint[]>([]);
  const [savedDraftEntry, setSavedDraftEntry] = useState<StructureEntry | null>(null);

  const [showTypologyViewer, setShowTypologyViewer] = useState(false);
  const [projectTypologies, setProjectTypologies] = useState(project?.typologies || []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState('');
  const [error, setError] = useState('');

  const finalizedRef = useRef(false);
  const savedDraftEntryRef = useRef<StructureEntry | null>(null);

  useEffect(() => {
    return () => {
      if (savedDraftEntryRef.current && !finalizedRef.current) {
        deleteStructureEntry(savedDraftEntryRef.current.id).catch(console.error);
      }
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Load existing photos if editing
  useEffect(() => {
    if (editingEntry) {
      (async () => {
        const photos = await getPhotosForStructure(editingEntry.id);
        const hydratedPhotos = await Promise.all(photos.map(photo => ensurePhotoBlob(photo.id)));
        const usablePhotos = hydratedPhotos.filter((photo): photo is NonNullable<typeof photo> => Boolean(photo?.blob));
        const previews = await Promise.all(
          usablePhotos.map(p => new Promise<string>(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(p.blob!);
          }))
        );
        const files = usablePhotos.map((p, i) => new File([p.blob!], `photo-${i}.jpg`, { type: p.blob!.type }));
        setPhotoPreviews(previews);
        setPhotoFiles(files);
        setPhotoIds(usablePhotos.map(p => p.id));
        setInitialPhotoCount(files.length);
      })();
    }
  }, [editingEntry]);

  // Auto-calculate intervention number (shared counter with mapping entries, per floor)
  useEffect(() => {
    if (!editingEntry && project?.useInterventionNumbering) {
      (async () => {
        const [mappingEntries, structureEntries] = await Promise.all([
          getMappingEntriesForProject(project.id),
          getStructureEntriesForProject(project.id),
        ]);
        const floorEntries = [...mappingEntries, ...structureEntries].filter(e => e.floor === floor);
        const max = floorEntries.reduce((m, e) => {
          const n = parseInt(e.intervention || '0');
          return !isNaN(n) && n > m ? n : m;
        }, 0);
        setInterventionNumber((max + 1).toString());
      })();
    }
  }, [project, editingEntry, floor]);

  useEffect(() => {
    if (!project || !floor) return;
    (async () => {
      const fp = await getFloorPlanByProjectAndFloor(project.id, floor);
      setCurrentFloorPlan(fp || null);
      setFloorPlanImageUrl(getFloorPlanBlobUrl(fp?.imageBlob, fp?.imageUrl));
    })();
  }, [floor, project]);

  const structureTypologies = projectTypologies.filter(t => (t.category ?? 'attraversamento') === 'struttura');

  const generateLabelText = (): string[] => {
    const labelParts: string[] = [];
    if (project && project.floors && project.floors.length > 1) labelParts.push(`P${floor}`);
    if (project?.useRoomNumbering && roomNumber) labelParts.push(`S${roomNumber}`);
    if (project?.useInterventionNumbering && interventionNumber) labelParts.push(`Int${interventionNumber}`);
    const firstLine = labelParts.join('_') || 'Struttura';
    const tipNumbers = structures
      .map(s => s.tipologicoId ? projectTypologies.find(t => t.id === s.tipologicoId)?.number : null)
      .filter((n): n is number => n !== null)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b);
    return [firstLine, tipNumbers.length > 0 ? `Tip. ${tipNumbers.join(' - ')}` : ''].filter(Boolean);
  };

  const handleFloorChange = (v: string) => {
    setFloor(v);
    localStorage.setItem('lastUsedFloor', v);
  };

  const addStructure = () => {
    setStructures(prev => [
      ...prev,
      { id: generateId(), struttura: '', tipoStruttura: '', tipologicoId: undefined, parti: [{ id: generateId() }], notes: '' }
    ]);
  };

  const removeStructure = (id: string) => {
    if (structures.length === 1) return;
    setStructures(prev => prev.filter(s => s.id !== id));
  };

  const updateStructure = (id: string, updates: Partial<Structure>) => {
    setStructures(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  // Unità della voce struttura selezionata (default 'mq'); guida i campi input.
  const unitOf = (s: Structure): MeasureUnit =>
    STRUTTURA_OPTIONS.find(o => o.value === s.struttura)?.unit ?? 'mq';

  // Superficie totale (mq) = somma base×altezza di tutte le parti.
  const superficieOf = (s: Structure): number =>
    (s.parti || []).reduce((sum, p) => sum + ((p.base || 0) * (p.altezza || 0)), 0);

  // Gestione parti (solo unit 'mq': muro ad angolo = più righe base×altezza sommate).
  const addParte = (structureId: string) => {
    setStructures(prev => prev.map(s => s.id === structureId
      ? { ...s, parti: [...(s.parti || []), { id: generateId() }] }
      : s));
  };

  const removeParte = (structureId: string, parteId: string) => {
    setStructures(prev => prev.map(s => s.id === structureId
      ? { ...s, parti: (s.parti || []).filter(p => p.id !== parteId) }
      : s));
  };

  const updateParte = (structureId: string, parteId: string, updates: Partial<StrutturaParte>) => {
    setStructures(prev => prev.map(s => s.id === structureId
      ? { ...s, parti: (s.parti || []).map(p => p.id === parteId ? { ...p, ...updates } : p) }
      : s));
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const allFiles = Array.from(e.target.files);

    const validFiles: File[] = [];
    for (const file of allFiles) {
      const { valid } = await validateFileSignature(file);
      if (valid) validFiles.push(file);
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
    e.target.value = '';
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

  const handleSubmit = async () => {
    if (!project) { setError('Nessun progetto selezionato'); return; }
    if (finalizedRef.current) return; // guardia re-entrancy
    // CLAIM prima delle await: impedisce al cleanup di unmount di cancellare
    // la draft mentre il salvataggio è ancora in corso (race condition).
    finalizedRef.current = true;
    setIsSubmitting(true);
    setError('');

    try {
      const photosToCompress = photoFiles.slice(initialPhotoCount);
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

      const safeStructures = structures.map(s => {
        const unit = unitOf(s);
        if (unit === 'mq') {
          const parti = (s.parti || []).map(p => ({
            id: p.id,
            base: p.base || undefined,
            altezza: p.altezza || undefined,
          }));
          const totalMq = parti.reduce((sum, p) => sum + ((p.base || 0) * (p.altezza || 0)), 0);
          return {
            ...s,
            unit,
            parti,
            // mirror legacy base/altezza dalla prima parte (compat con vecchi lettori)
            base: parti[0]?.base,
            altezza: parti[0]?.altezza,
            superficie: totalMq > 0 ? parseFloat(totalMq.toFixed(4)) : undefined,
            lunghezza: undefined,
            quantita: undefined,
          };
        }
        if (unit === 'ml' || unit === 'm') {
          return {
            ...s, unit, parti: undefined, base: undefined, altezza: undefined,
            superficie: undefined, lunghezza: s.lunghezza || undefined, quantita: undefined,
          };
        }
        // pz
        return {
          ...s, unit, parti: undefined, base: undefined, altezza: undefined,
          superficie: undefined, lunghezza: undefined, quantita: s.quantita || undefined,
        };
      });

      if (editingEntry) {
        await updateStructureEntry(editingEntry.id, {
          floor,
          room: project.useRoomNumbering ? roomNumber : undefined,
          intervention: project.useInterventionNumbering ? interventionNumber : undefined,
          structures: safeStructures,
          toComplete,
        }, currentUser.id);

        try { await updateFloorPlanLabelsForMapping(editingEntry.id, () => generateLabelText()); } catch {}

        for (const photoId of photosToRemove) {
          await removePhotoFromStructure(editingEntry.id, photoId, currentUser.id);
        }
        if (compressedBlobs.length > 0) {
          await addPhotosToStructure(editingEntry.id, compressedBlobs, currentUser.id);
        }
        alert('Struttura aggiornata!');
      } else if (savedDraftEntry) {
        // A draft was created when the floor plan editor was opened; finalize it in place
        // to avoid leaving an orphaned draft alongside the new entry.
        await updateStructureEntry(savedDraftEntry.id, {
          floor,
          room: project.useRoomNumbering ? roomNumber : undefined,
          intervention: project.useInterventionNumbering ? interventionNumber : undefined,
          structures: safeStructures,
          toComplete,
        }, currentUser.id);
        try { await updateFloorPlanLabelsForMapping(savedDraftEntry.id, () => generateLabelText()); } catch {}
        if (compressedBlobs.length > 0) {
          await addPhotosToStructure(savedDraftEntry.id, compressedBlobs, currentUser.id);
        }
        alert('Struttura salvata!');
      } else {
        await createStructureEntry({
          projectId: project.id,
          floor,
          room: project.useRoomNumbering ? roomNumber : undefined,
          intervention: project.useInterventionNumbering ? interventionNumber : undefined,
          structures: safeStructures,
          toComplete,
          createdBy: currentUser.id,
        }, compressedBlobs);
        alert('Struttura salvata!');
      }

      savedDraftEntryRef.current = null;
      localStorage.setItem('lastUsedFloor', floor);
      if (editingEntry) { onBack(); } else { onSaved ? onSaved() : onBack(); }
    } catch (err) {
      console.error('Failed to save structure entry:', err);
      finalizedRef.current = false; // RELEASE su errore: permette retry del cleanup
      setError('Errore nel salvataggio. Riprova.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenFloorPlanEditor = async () => {
    if (!currentFloorPlan || !project) return;
    const hydratedFloorPlan = await ensureFloorPlanAsset(currentFloorPlan.id, 'full') || currentFloorPlan;
    const hydratedImageUrl = getFloorPlanBlobUrl(hydratedFloorPlan.imageBlob, hydratedFloorPlan.imageUrl);
    if (!hydratedImageUrl) {
      alert('Immagine planimetria non disponibile. Verifica la connessione e riprova.');
      return;
    }
    setCurrentFloorPlan(hydratedFloorPlan);
    setFloorPlanImageUrl(hydratedImageUrl);
    const currentEntry = editingEntry || savedDraftEntry;
    if (!currentEntry) {
      setIsSubmitting(true);
      try {
        const draft = await createStructureEntry({
          projectId: project.id,
          floor,
          room: roomNumber || undefined,
          intervention: interventionNumber || undefined,
          structures,
          toComplete: true,
          createdBy: currentUser.id,
        }, []);
        setSavedDraftEntry(draft);
        savedDraftEntryRef.current = draft;
      } catch { return; } finally { setIsSubmitting(false); }
    }
    const entryToCheck = editingEntry || savedDraftEntryRef.current;
    if (entryToCheck) {
      const pt = await getFloorPlanPointByMappingEntry(entryToCheck.id);
      setCurrentFloorPlanPoint(pt || null);
      if (pt?.eiRating) setEiRating(pt.eiRating as EiRating);
    }
    try {
      const allPts = await getFloorPlanPoints(hydratedFloorPlan.id);
      const cid = entryToCheck?.id;
      setReadOnlyPoints(allPts.filter(p => p.mappingEntryId !== cid).map(p => ({
        id: p.id, type: p.pointType as CanvasPoint['type'],
        pointX: p.pointX, pointY: p.pointY, labelX: p.labelX, labelY: p.labelY,
        labelText: p.metadata?.labelText || ['Punto'], perimeterPoints: p.perimeterPoints,
        mappingEntryId: p.mappingEntryId, eiRating: p.eiRating,
      })));
    } catch { setReadOnlyPoints([]); }
    setShowFloorPlanEditor(true);
  };

  const handleSaveFloorPlanPoint = async (points: CanvasPoint[], gridConfig: GridConfig) => {
    if (!currentFloorPlan) return;
    const entry = editingEntry || savedDraftEntryRef.current;
    if (!entry) return;
    const point = points[0];
    if (!point) { setShowFloorPlanEditor(false); return; }
    try {
      const labelText = generateLabelText();
      if (currentFloorPlanPoint) {
        await updateFloorPlanPoint(currentFloorPlanPoint.id, {
          pointType: point.type,
          pointX: point.pointX,
          pointY: point.pointY,
          labelX: point.labelX,
          labelY: point.labelY,
          perimeterPoints: point.perimeterPoints,
          customText: point.customText,
          eiRating: point.eiRating,
          metadata: { ...currentFloorPlanPoint.metadata, labelText },
        });
      } else {
        await createFloorPlanPoint(
          currentFloorPlan.id,
          entry.id,
          point.type,
          point.pointX,
          point.pointY,
          point.labelX,
          point.labelY,
          currentUser.id,
          { perimeterPoints: point.perimeterPoints, customText: point.customText, eiRating: point.eiRating, metadata: { labelText } }
        );
      }
      await updateFloorPlan(currentFloorPlan.id, {
        gridEnabled: gridConfig.enabled,
        gridConfig: { rows: gridConfig.rows, cols: gridConfig.cols, offsetX: gridConfig.offsetX, offsetY: gridConfig.offsetY },
      });
      alert('Punto salvato sulla planimetria!');
    } catch {
      alert('Errore nel salvataggio del punto');
    }
  };

  if (showFloorPlanEditor && currentFloorPlan && floorPlanImageUrl) {
    const initialPoint = currentFloorPlanPoint ? [{
      id: currentFloorPlanPoint.id,
      type: currentFloorPlanPoint.pointType as CanvasPoint['type'],
      pointX: currentFloorPlanPoint.pointX, pointY: currentFloorPlanPoint.pointY,
      labelX: currentFloorPlanPoint.labelX, labelY: currentFloorPlanPoint.labelY,
      labelText: currentFloorPlanPoint.metadata?.labelText || ['Struttura'],
      perimeterPoints: currentFloorPlanPoint.perimeterPoints,
      mappingEntryId: currentFloorPlanPoint.mappingEntryId,
      eiRating: currentFloorPlanPoint.eiRating,
    }] : [];

    return (
      <FloorPlanEditor
        imageUrl={floorPlanImageUrl}
        initialPoints={initialPoint}
        mode="mapping"
        maxPoints={1}
        readOnlyPoints={readOnlyPoints}
        onSave={handleSaveFloorPlanPoint}
        onClose={() => setShowFloorPlanEditor(false)}
        initialActiveTool="perimetro"
        initialEiRating={eiRating}
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
            {editingEntry ? 'Modifica Struttura' : 'Nuova Struttura'}
          </h1>
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

        {/* STEP 0: Posizione */}
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

        {/* STEP 1: Strutture */}
        {step === 1 && (
          <div className="space-y-3">
            {/* Typology viewer button - always visible to allow adding */}
            <button
              onClick={() => setShowTypologyViewer(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-white rounded-xl shadow-card text-xs font-medium text-accent active:bg-accent/5 transition-colors"
            >
              <Eye size={14} />
              {structureTypologies.length > 0
                ? `Gestisci tipologici (${structureTypologies.length})`
                : 'Aggiungi tipologici'}
            </button>

            {structures.map((s, i) => (
              <div key={s.id} className="bg-white rounded-2xl shadow-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-brand-600">Struttura {i + 1}</span>
                  {structures.length > 1 && (
                    <button onClick={() => removeStructure(s.id)} className="text-danger/60 hover:text-danger">
                      <X size={16} />
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {/* Typology selector (first menu) */}
                  {structureTypologies.length > 0 && (
                    <div>
                      <label className="block text-[11px] font-medium text-brand-500 mb-1">Tipologico</label>
                      <div className="relative">
                        <select
                          value={s.tipologicoId || ''}
                          onChange={e => {
                            const tipId = e.target.value;
                            const updates: Partial<Structure> = { tipologicoId: tipId || undefined };
                            if (tipId) {
                              const tip = structureTypologies.find(t => t.id === tipId);
                              if (tip) {
                                updates.struttura = tip.struttura ?? '';
                                updates.strutturaCustom = undefined;
                                updates.tipoStruttura = tip.tipoStruttura ?? '';
                              }
                            }
                            updateStructure(s.id, updates);
                          }}
                          className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-accent/30 outline-none"
                        >
                          <option value="">Nessuno</option>
                          {[...structureTypologies].sort((a, b) => a.number - b.number).map(t => {
                            const products = t.prodottiSelezionati && t.prodottiSelezionati.length > 0
                              ? t.prodottiSelezionati.join(', ')
                              : '';
                            const brand = t.marcaProdottoUtilizzato || '';
                            const info = [brand, products].filter(Boolean).join(' - ');
                            const label = t.struttura || t.attraversamento || '—';
                            const sub = t.tipoStruttura ? ` / ${t.tipoStruttura}` : '';
                            return (
                              <option key={t.id} value={t.id}>
                                #{t.number} - {label}{sub}
                                {info ? ` (${info})` : ''}
                              </option>
                            );
                          })}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                      </div>
                      {/* Show linked typology info */}
                      {s.tipologicoId && (() => {
                        const tip = structureTypologies.find(t => t.id === s.tipologicoId);
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

                  <div>
                    <label className="block text-[11px] font-medium text-brand-500 mb-1">Struttura</label>
                    <div className="relative">
                      <select
                        value={s.struttura}
                        onChange={e => updateStructure(s.id, { struttura: e.target.value })}
                        className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-accent/30 outline-none"
                      >
                        <option value="">Seleziona...</option>
                        {STRUTTURA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                    </div>
                    {s.struttura === 'Altro' && (
                      <input
                        type="text"
                        value={s.strutturaCustom || ''}
                        onChange={e => updateStructure(s.id, { strutturaCustom: e.target.value })}
                        placeholder="Specifica..."
                        className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm placeholder:text-brand-400 focus:ring-2 focus:ring-accent/30 outline-none mt-2"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-brand-500 mb-1">Tipo</label>
                    <div className="relative">
                      <select
                        value={s.tipoStruttura || ''}
                        onChange={e => updateStructure(s.id, { tipoStruttura: e.target.value })}
                        className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-accent/30 outline-none"
                      >
                        <option value="">Seleziona...</option>
                        {TIPO_STRUTTURA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                    </div>
                  </div>

                  {/* Misura guidata dall'unità della voce struttura */}
                  {(() => {
                    const unit = unitOf(s);
                    if (unit === 'mq') {
                      const totalMq = superficieOf(s);
                      return (
                        <div className="space-y-2">
                          <label className="block text-[11px] font-medium text-brand-500">Misure (Base × Altezza)</label>
                          {(s.parti || []).map(parte => (
                            <div key={parte.id} className="flex items-center gap-2">
                              <input
                                type="number"
                                value={parte.base ?? ''}
                                onChange={e => updateParte(s.id, parte.id, { base: e.target.value ? parseFloat(e.target.value) : undefined })}
                                placeholder="Base (m)"
                                min="0"
                                step="0.01"
                                className="flex-1 min-w-0 px-3 py-2.5 bg-brand-50 rounded-xl text-sm focus:ring-2 focus:ring-accent/30 outline-none"
                              />
                              <span className="text-brand-400 text-sm">×</span>
                              <input
                                type="number"
                                value={parte.altezza ?? ''}
                                onChange={e => updateParte(s.id, parte.id, { altezza: e.target.value ? parseFloat(e.target.value) : undefined })}
                                placeholder="Altezza (m)"
                                min="0"
                                step="0.01"
                                className="flex-1 min-w-0 px-3 py-2.5 bg-brand-50 rounded-xl text-sm focus:ring-2 focus:ring-accent/30 outline-none"
                              />
                              {(s.parti?.length || 0) > 1 && (
                                <button
                                  onClick={() => removeParte(s.id, parte.id)}
                                  className="w-9 h-9 flex items-center justify-center text-danger/60 hover:text-danger rounded-lg flex-shrink-0"
                                  title="Rimuovi parte"
                                >
                                  <X size={16} />
                                </button>
                              )}
                            </div>
                          ))}
                          <button
                            onClick={() => addParte(s.id)}
                            className="w-full py-2 border-2 border-dashed border-brand-200 rounded-xl text-xs font-medium text-brand-500 flex items-center justify-center gap-1.5 active:bg-brand-50"
                          >
                            <Plus size={14} />
                            Aggiungi parte
                          </button>
                          {totalMq > 0 && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-accent/10 rounded-xl">
                              <span className="text-[11px] font-medium text-brand-500">Superficie totale:</span>
                              <span className="text-sm font-semibold text-accent">{totalMq.toFixed(2)} mq</span>
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (unit === 'ml' || unit === 'm') {
                      return (
                        <div>
                          <label className="block text-[11px] font-medium text-brand-500 mb-1">Lunghezza ({unit})</label>
                          <input
                            type="number"
                            value={s.lunghezza ?? ''}
                            onChange={e => updateStructure(s.id, { lunghezza: e.target.value ? parseFloat(e.target.value) : undefined })}
                            placeholder="Es. 3.5"
                            min="0"
                            step="0.01"
                            className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm focus:ring-2 focus:ring-accent/30 outline-none"
                          />
                        </div>
                      );
                    }
                    return (
                      <div>
                        <label className="block text-[11px] font-medium text-brand-500 mb-1">Quantità (pz)</label>
                        <input
                          type="number"
                          value={s.quantita ?? ''}
                          onChange={e => updateStructure(s.id, { quantita: e.target.value ? parseInt(e.target.value) : undefined })}
                          placeholder="Es. 2"
                          min="0"
                          step="1"
                          className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm focus:ring-2 focus:ring-accent/30 outline-none"
                        />
                      </div>
                    );
                  })()}

                  <div>
                    <label className="block text-[11px] font-medium text-brand-500 mb-1">Note</label>
                    <input
                      type="text"
                      value={s.notes || ''}
                      onChange={e => updateStructure(s.id, { notes: e.target.value })}
                      placeholder="Note opzionali..."
                      className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm placeholder:text-brand-400 focus:ring-2 focus:ring-accent/30 outline-none"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={addStructure}
              className="w-full py-3 border-2 border-dashed border-brand-300 rounded-2xl text-sm font-medium text-brand-500 flex items-center justify-center gap-2 active:bg-brand-50"
            >
              <Plus size={16} />
              Aggiungi struttura
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
                <div className="text-xs text-brand-500">Segna come struttura incompleta</div>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Bottom action buttons */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-brand-200 px-4 pt-3 z-40" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
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

      {/* Typology viewer/editor modal */}
      {showTypologyViewer && project && (
        <TypologyViewerModal
          project={{ ...project, typologies: projectTypologies }}
          onClose={() => setShowTypologyViewer(false)}
          onTypologiesChanged={setProjectTypologies}
        />
      )}
    </div>
  );
};

export default StructureWizard;
