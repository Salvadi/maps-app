import React, { useState, useRef, useEffect } from 'react';
import imageCompression from 'browser-image-compression';
import {
  ArrowLeft, ArrowRight, Check, Camera,
  Plus, X, ChevronDown, Image, Eye
} from 'lucide-react';
import { validateFileSignature } from '../utils/validation';
import {
  Project, Structure, User, StructureEntry,
  createStructureEntry, getStructureEntriesForProject,
  updateStructureEntry, deleteStructureEntry, getPhotosForStructure, ensurePhotoBlob,
  addPhotosToStructure, removePhotoFromStructure,
} from '../db';
import { useDropdownOptions } from '../hooks/useDropdownOptions';
import PhotoPreviewModal from './PhotoPreviewModal';
import TypologyViewerModal from './TypologyViewerModal';

interface StructureWizardProps {
  project: Project | null;
  currentUser: User;
  onBack: () => void;
  editingEntry?: StructureEntry;
  onSync?: () => void;
  isSyncing?: boolean;
}

type Step = 0 | 1 | 2;

const STEP_LABELS = ['Posizione', 'Strutture', 'Foto'];

const StructureWizard: React.FC<StructureWizardProps> = ({
  project, currentUser, onBack, editingEntry, onSync, isSyncing
}) => {
  const STRUTTURA_OPTIONS = useDropdownOptions('struttura');
  const TIPO_STRUTTURA_OPTIONS = useDropdownOptions('tipo_struttura');

  const [step, setStep] = useState<Step>(0);

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
      ? editingEntry.structures
      : [{ id: `${Date.now()}-0`, struttura: '', tipoStruttura: '', tipologicoId: undefined, superficie: undefined, lunghezza: undefined, notes: '' }]
  );

  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoIds, setPhotoIds] = useState<(string | null)[]>([]);
  const [initialPhotoCount, setInitialPhotoCount] = useState(0);
  const [photosToRemove, setPhotosToRemove] = useState<string[]>([]);
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<{ url: string; alt: string } | null>(null);

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

  const structureTypologies = projectTypologies.filter(t => (t.category ?? 'attraversamento') === 'struttura');

  const addStructure = () => {
    setStructures(prev => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, struttura: '', tipoStruttura: '', tipologicoId: undefined, superficie: undefined, lunghezza: undefined, notes: '' }
    ]);
  };

  const removeStructure = (id: string) => {
    if (structures.length === 1) return;
    setStructures(prev => prev.filter(s => s.id !== id));
  };

  const updateStructure = (id: string, updates: Partial<Structure>) => {
    setStructures(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handlePhotoFiles = async (files: File[]) => {
    const validFiles: File[] = [];
    for (const file of files) {
      const validation = await validateFileSignature(file);
      if (!validation.valid) continue;
      validFiles.push(file);
    }
    if (validFiles.length === 0) return;

    setCompressionProgress('Compressione foto...');
    const compressed: File[] = [];
    for (const file of validFiles) {
      try {
        const compressedFile = await imageCompression(file, {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
          onProgress: (p) => setCompressionProgress(`Compressione ${Math.round(p)}%`),
        });
        compressed.push(new File([compressedFile], file.name, { type: compressedFile.type }));
      } catch {
        compressed.push(file);
      }
    }
    setCompressionProgress('');

    const newPreviews = await Promise.all(
      compressed.map(f => new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(f);
      }))
    );

    setPhotoFiles(prev => [...prev, ...compressed]);
    setPhotoPreviews(prev => [...prev, ...newPreviews]);
    setPhotoIds(prev => [...prev, ...compressed.map(() => null)]);
  };

  const removePhoto = (index: number) => {
    const existingId = photoIds[index];
    if (existingId) {
      setPhotosToRemove(prev => [...prev, existingId]);
    }
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
    setPhotoFiles(prev => prev.filter((_, i) => i !== index));
    setPhotoIds(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!project) return;
    setIsSubmitting(true);
    setError('');

    try {
      const newPhotoBlobs = photoFiles.slice(initialPhotoCount).map(f => f as unknown as Blob);
      const safeStructures = structures.map(s => ({
        ...s,
        superficie: s.superficie || undefined,
        lunghezza: s.lunghezza || undefined,
      }));

      if (editingEntry) {
        const updatedEntry = await updateStructureEntry(editingEntry.id, {
          floor,
          room: roomNumber || undefined,
          intervention: interventionNumber || undefined,
          structures: safeStructures,
          toComplete,
        }, currentUser.id);

        for (const photoId of photosToRemove) {
          await removePhotoFromStructure(editingEntry.id, photoId, currentUser.id);
        }

        if (newPhotoBlobs.length > 0) {
          await addPhotosToStructure(editingEntry.id, newPhotoBlobs, currentUser.id);
        }

        finalizedRef.current = true;
        savedDraftEntryRef.current = null;
        localStorage.setItem('lastUsedFloor', floor);
        onSync?.();
        onBack();
      } else {
        const entry = await createStructureEntry({
          projectId: project.id,
          floor,
          room: roomNumber || undefined,
          intervention: interventionNumber || undefined,
          structures: safeStructures,
          toComplete,
          createdBy: currentUser.id,
        }, newPhotoBlobs);

        finalizedRef.current = true;
        savedDraftEntryRef.current = null;
        localStorage.setItem('lastUsedFloor', floor);
        onSync?.();
        onBack();
      }
    } catch (err) {
      console.error('Failed to save structure entry:', err);
      setError('Errore nel salvataggio. Riprova.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceedStep0 = floor !== '';
  const canProceedStep1 = structures.every(s => s.struttura !== '');

  const selectCls = 'w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm appearance-none focus:ring-2 focus:ring-accent/30 outline-none';

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-brand-100">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-brand-800">
            {editingEntry ? 'Modifica Struttura' : 'Nuova Struttura'}
          </h1>
          <p className="text-xs text-brand-400">{project?.title}</p>
        </div>
        {onSync && (
          <button onClick={onSync} disabled={isSyncing} className="w-9 h-9 flex items-center justify-center rounded-full bg-brand-100 text-brand-600 disabled:opacity-40">
            <span className={`text-lg ${isSyncing ? 'animate-spin' : ''}`}>↻</span>
          </button>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-brand-50">
        {STEP_LABELS.map((label, idx) => (
          <React.Fragment key={label}>
            <div className={`flex items-center gap-1.5 ${idx <= step ? 'text-accent' : 'text-brand-300'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                idx < step ? 'bg-accent text-white' : idx === step ? 'bg-accent/20 text-accent' : 'bg-brand-100 text-brand-300'
              }`}>
                {idx < step ? <Check size={12} /> : idx + 1}
              </div>
              <span className="text-xs font-medium hidden sm:block">{label}</span>
            </div>
            {idx < STEP_LABELS.length - 1 && (
              <div className={`flex-1 h-px ${idx < step ? 'bg-accent' : 'bg-brand-100'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {/* STEP 0: Posizione */}
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-brand-700 mb-2">Piano *</label>
              <div className="relative">
                <select
                  value={floor}
                  onChange={e => setFloor(e.target.value)}
                  className={selectCls}
                >
                  {project?.floors.map(f => (
                    <option key={f} value={f}>{f === '0' ? 'PT (Piano Terra)' : `Piano ${f}`}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
              </div>
            </div>

            {project?.useRoomNumbering && (
              <div>
                <label className="block text-sm font-semibold text-brand-700 mb-2">Stanza / Locale</label>
                <input
                  type="text"
                  value={roomNumber}
                  onChange={e => setRoomNumber(e.target.value)}
                  placeholder="Es. 101, Corridoio A..."
                  className={`${selectCls} bg-brand-50`}
                />
              </div>
            )}

            {project?.useInterventionNumbering && (
              <div>
                <label className="block text-sm font-semibold text-brand-700 mb-2">N. Intervento</label>
                <input
                  type="text"
                  value={interventionNumber}
                  onChange={e => setInterventionNumber(e.target.value)}
                  placeholder="Es. 1, 2, 3..."
                  className={`${selectCls} bg-brand-50`}
                />
              </div>
            )}

            <div className="flex items-center gap-3 py-2">
              <button
                onClick={() => setToComplete(!toComplete)}
                className={`w-10 h-6 rounded-full transition-colors ${toComplete ? 'bg-warning' : 'bg-brand-200'}`}
              >
                <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform m-0.5 ${toComplete ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <span className="text-sm text-brand-700">Da completare</span>
            </div>
          </div>
        )}

        {/* STEP 1: Strutture */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-brand-700">Strutture ({structures.length})</h2>
              <button
                onClick={() => setShowTypologyViewer(true)}
                className="text-xs text-accent font-medium px-3 py-1.5 rounded-lg bg-accent/10 hover:bg-accent/20"
              >
                Tipologici
              </button>
            </div>

            {structures.map((s, idx) => (
              <div key={s.id} className="bg-brand-50 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-brand-500">Struttura {idx + 1}</span>
                  {structures.length > 1 && (
                    <button onClick={() => removeStructure(s.id)} className="text-danger p-1">
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-medium text-brand-500 mb-1 block">Struttura *</label>
                    <div className="relative">
                      <select
                        value={s.struttura}
                        onChange={e => updateStructure(s.id, { struttura: e.target.value })}
                        className={selectCls}
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
                        className={`${selectCls} mt-2`}
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-brand-500 mb-1 block">Tipo</label>
                    <div className="relative">
                      <select
                        value={s.tipoStruttura || ''}
                        onChange={e => updateStructure(s.id, { tipoStruttura: e.target.value })}
                        className={selectCls}
                      >
                        <option value="">Seleziona...</option>
                        {TIPO_STRUTTURA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Tipologico */}
                {structureTypologies.length > 0 && (
                  <div>
                    <label className="text-[11px] font-medium text-brand-500 mb-1 block">Tipologico</label>
                    <div className="relative">
                      <select
                        value={s.tipologicoId || ''}
                        onChange={e => updateStructure(s.id, { tipologicoId: e.target.value || undefined })}
                        className={selectCls}
                      >
                        <option value="">Nessun tipologico</option>
                        {structureTypologies.map(t => (
                          <option key={t.id} value={t.id}>
                            #{t.number} – {t.struttura || t.attraversamento || '—'}{t.marcaProdottoUtilizzato ? ` · ${t.marcaProdottoUtilizzato}` : ''}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none" />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-medium text-brand-500 mb-1 block">Superficie (mq)</label>
                    <input
                      type="number"
                      value={s.superficie ?? ''}
                      onChange={e => updateStructure(s.id, { superficie: e.target.value ? parseFloat(e.target.value) : undefined })}
                      placeholder="Es. 12.5"
                      min="0"
                      step="0.01"
                      className={`${selectCls} bg-white`}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-brand-500 mb-1 block">Lunghezza (ml)</label>
                    <input
                      type="number"
                      value={s.lunghezza ?? ''}
                      onChange={e => updateStructure(s.id, { lunghezza: e.target.value ? parseFloat(e.target.value) : undefined })}
                      placeholder="Es. 3.5"
                      min="0"
                      step="0.01"
                      className={`${selectCls} bg-white`}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-brand-500 mb-1 block">Note</label>
                  <input
                    type="text"
                    value={s.notes || ''}
                    onChange={e => updateStructure(s.id, { notes: e.target.value })}
                    placeholder="Note aggiuntive..."
                    className={`${selectCls} bg-white`}
                  />
                </div>
              </div>
            ))}

            <button
              onClick={addStructure}
              className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-brand-300 rounded-xl text-sm font-medium text-brand-500 hover:border-accent hover:text-accent transition-colors"
            >
              <Plus size={16} /> Aggiungi struttura
            </button>
          </div>
        )}

        {/* STEP 2: Foto */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-brand-500">Aggiungi foto per documentare le strutture.</p>

            {compressionProgress && (
              <div className="text-xs text-accent text-center py-2">{compressionProgress}</div>
            )}

            <div className="grid grid-cols-3 gap-2">
              {photoPreviews.map((preview, idx) => (
                <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-brand-100">
                  <img
                    src={preview}
                    alt={`Foto ${idx + 1}`}
                    className="w-full h-full object-cover cursor-pointer"
                    onClick={() => setSelectedPhotoPreview({ url: preview, alt: `Foto ${idx + 1}` })}
                  />
                  <button
                    onClick={() => removePhoto(idx)}
                    className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"
                  >
                    <X size={12} />
                  </button>
                  <button
                    onClick={() => setSelectedPhotoPreview({ url: preview, alt: `Foto ${idx + 1}` })}
                    className="absolute bottom-1 right-1 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"
                  >
                    <Eye size={10} />
                  </button>
                </div>
              ))}

              <button
                onClick={() => cameraInputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-brand-200 flex flex-col items-center justify-center gap-1 text-brand-400 hover:border-accent hover:text-accent transition-colors"
              >
                <Camera size={20} />
                <span className="text-[10px]">Foto</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-brand-200 flex flex-col items-center justify-center gap-1 text-brand-400 hover:border-accent hover:text-accent transition-colors"
              >
                <Image size={20} />
                <span className="text-[10px]">Galleria</span>
              </button>
            </div>

            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) handlePhotoFiles(files);
                e.target.value = '';
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) handlePhotoFiles(files);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-danger/10 text-danger text-sm rounded-xl">{error}</div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-brand-100 flex gap-3">
        {step > 0 && (
          <button
            onClick={() => setStep((step - 1) as Step)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-brand-200 text-brand-700 text-sm font-semibold"
          >
            <ArrowLeft size={16} /> Indietro
          </button>
        )}

        {step < 2 ? (
          <button
            onClick={() => setStep((step + 1) as Step)}
            disabled={step === 0 ? !canProceedStep0 : !canProceedStep1}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-40"
          >
            Avanti <ArrowRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-40"
          >
            {isSubmitting ? 'Salvataggio...' : <><Check size={16} /> {editingEntry ? 'Salva modifiche' : 'Salva struttura'}</>}
          </button>
        )}
      </div>

      {showTypologyViewer && project && (
        <TypologyViewerModal
          project={{ ...project, typologies: projectTypologies }}
          onClose={() => setShowTypologyViewer(false)}
          onTypologiesChanged={updated => setProjectTypologies(updated)}
        />
      )}

      {selectedPhotoPreview && (
        <PhotoPreviewModal
          imageUrl={selectedPhotoPreview.url}
          altText={selectedPhotoPreview.alt}
          onClose={() => setSelectedPhotoPreview(null)}
        />
      )}
    </div>
  );
};

export default StructureWizard;
