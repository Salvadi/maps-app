import React, { useState, useRef, useEffect } from 'react';
import imageCompression from 'browser-image-compression';
import NavigationBar from './NavigationBar';
import FloorPlanEditor from './FloorPlanEditor';
import PhotoPreviewModal from './PhotoPreviewModal';
import type { CanvasPoint, GridConfig } from './FloorPlanCanvas';
import {
  Project,
  Crossing,
  User,
  MappingEntry,
  createMappingEntry,
  getMappingEntriesForProject,
  updateMappingEntry,
  getPhotosForMapping,
  addPhotosToMapping,
  removePhotoFromMapping,
  FloorPlan,
  FloorPlanPoint,
  getFloorPlanByProjectAndFloor,
  getFloorPlanPointByMappingEntry,
  createFloorPlanPoint,
  updateFloorPlanPoint,
  updateFloorPlan,
  getFloorPlanBlobUrl
} from '../db';
import { SUPPORTO_OPTIONS } from '../config/supporto';
import { TIPO_SUPPORTO_OPTIONS } from '../config/tipoSupporto';
import { ATTRAVERSAMENTO_OPTIONS } from '../config/attraversamento';
import './MappingPage.css';

interface MappingPageProps {
  project: Project | null;
  currentUser: User;
  onBack: () => void;
  editingEntry?: MappingEntry;
  onSync?: () => void;
  isSyncing?: boolean;
}

// Camera Icon Component
const CameraIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M23 19C23 19.5304 22.7893 20.0391 22.4142 20.4142C22.0391 20.7893 21.5304 21 21 21H3C2.46957 21 1.96086 20.7893 1.58579 20.4142C1.21071 20.0391 1 19.5304 1 19V8C1 7.46957 1.21071 6.96086 1.58579 6.58579C1.96086 6.21071 2.46957 6 3 6H7L9 3H15L17 6H21C21.5304 6 22.0391 6.21071 22.4142 6.58579C22.7893 6.96086 23 7.46957 23 8V19Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Eye Icon Component
const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Typology Viewer Modal Component
interface TypologyViewerModalProps {
  project: Project;
  onClose: () => void;
}

const TypologyViewerModal: React.FC<TypologyViewerModalProps> = ({ project, onClose }) => {
  // Helper function to get label from options
  const getLabel = (options: { value: string; label: string }[], value: string) => {
    const option = options.find(opt => opt.value === value);
    return option?.label || value;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content typology-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Tipologici del Progetto</h2>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {[...project.typologies].sort((a, b) => a.number - b.number).map((tip) => (
            <div key={tip.id} className="typology-card">
              <h3 className="typology-card-title">Tipologico {tip.number}</h3>
              <div className="typology-card-fields">
                <div className="typology-card-field">
                  <span className="typology-card-label">Supporto:</span>
                  <span className="typology-card-value">{getLabel(SUPPORTO_OPTIONS, tip.supporto)}</span>
                </div>
                <div className="typology-card-field">
                  <span className="typology-card-label">Tipo Supporto:</span>
                  <span className="typology-card-value">{getLabel(TIPO_SUPPORTO_OPTIONS, tip.tipoSupporto)}</span>
                </div>
                <div className="typology-card-field">
                  <span className="typology-card-label">Attraversamento:</span>
                  <span className="typology-card-value">{getLabel(ATTRAVERSAMENTO_OPTIONS, tip.attraversamento)}</span>
                </div>
                <div className="typology-card-field">
                  <span className="typology-card-label">Marca Prodotto:</span>
                  <span className="typology-card-value">{tip.marcaProdottoUtilizzato}</span>
                </div>
                {tip.prodottiSelezionati.length > 0 && (
                  <div className="typology-card-field">
                    <span className="typology-card-label">Prodotti:</span>
                    <ul className="typology-card-products">
                      {tip.prodottiSelezionati.map((prod, idx) => (
                        <li key={idx}>{prod}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const MappingPage: React.FC<MappingPageProps> = ({ project, currentUser, onBack, editingEntry, onSync, isSyncing }) => {
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoIds, setPhotoIds] = useState<(string | null)[]>([]); // Track photo IDs (null for new photos)
  const [initialPhotoCount, setInitialPhotoCount] = useState<number>(0);
  const [photosToRemove, setPhotosToRemove] = useState<string[]>([]); // Track existing photos to remove
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<{ url: string; alt: string } | null>(null);

  // Floor Plan state
  const [showFloorPlanEditor, setShowFloorPlanEditor] = useState(false);
  const [currentFloorPlan, setCurrentFloorPlan] = useState<FloorPlan | null>(null);
  const [currentFloorPlanPoint, setCurrentFloorPlanPoint] = useState<FloorPlanPoint | null>(null);
  const [floorPlanImageUrl, setFloorPlanImageUrl] = useState<string | null>(null);

  // Track auto-saved draft entry (when user adds point before saving)
  const [savedDraftEntry, setSavedDraftEntry] = useState<MappingEntry | null>(null);

  // Recupera l'ultimo piano usato da localStorage o dall'entry in modifica
  const getLastUsedFloor = () => {
    if (editingEntry) {
      return editingEntry.floor;
    }
    const lastFloor = localStorage.getItem('lastUsedFloor');
    if (lastFloor && project?.floors.includes(lastFloor)) {
      return lastFloor;
    }
    return project?.floors[0] || '0';
  };

  const [floor, setFloor] = useState<string>(getLastUsedFloor());
  const [roomNumber, setRoomNumber] = useState<string>(editingEntry?.room || '');
  const [interventionNumber, setInterventionNumber] = useState<string>(editingEntry?.intervention || '');
  const [toComplete, setToComplete] = useState<boolean>(editingEntry?.toComplete || false);
  const [sigillature, setSigillature] = useState<Crossing[]>(
    editingEntry && editingEntry.crossings.length > 0
      ? editingEntry.crossings
      : [{ id: `${Date.now()}-0`, supporto: '', tipoSupporto: '', attraversamento: '', tipologicoId: undefined, quantita: undefined, diametro: undefined, dimensioni: undefined, notes: '' }]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showTypologyViewer, setShowTypologyViewer] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string>('');

  // Helper function to find matching typology based on crossing fields
  const findMatchingTypology = (crossing: Crossing) => {
    if (!project?.typologies || !crossing.supporto || !crossing.tipoSupporto || !crossing.attraversamento) {
      return null;
    }

    return project.typologies.find(tip =>
      tip.supporto === crossing.supporto &&
      tip.tipoSupporto === crossing.tipoSupporto &&
      tip.attraversamento === crossing.attraversamento
    );
  };

  // Helper function to sort typologies with matching one first, then by number
  const getSortedTypologies = (crossing: Crossing) => {
    if (!project?.typologies) return [];

    // First, sort all typologies by number
    const sortedByNumber = [...project.typologies].sort((a, b) => a.number - b.number);

    const matchingTypology = findMatchingTypology(crossing);
    if (!matchingTypology) return sortedByNumber;

    // Put matching typology first, keeping others sorted by number
    return [
      matchingTypology,
      ...sortedByNumber.filter(t => t.id !== matchingTypology.id)
    ];
  };

  // Helper function to check if selected typology is coherent
  const isTypologyCoherent = (crossing: Crossing) => {
    if (!crossing.tipologicoId || !project?.typologies) return true;

    const selectedTypology = project.typologies.find(t => t.id === crossing.tipologicoId);
    if (!selectedTypology) return true;

    return (
      selectedTypology.supporto === crossing.supporto &&
      selectedTypology.tipoSupporto === crossing.tipoSupporto &&
      selectedTypology.attraversamento === crossing.attraversamento
    );
  };

  // Helper function to check if attraversamento needs diametro field
  const needsDiametro = (attraversamento: string) => {
    return attraversamento.toLowerCase().includes('tubo');
  };

  // Helper function to check if attraversamento needs dimensioni field
  const needsDimensioni = (attraversamento: string) => {
    const dimTypes = ['canalina', 'serranda', 'canala', 'asola', 'altro'];
    return dimTypes.some(type => attraversamento.toLowerCase().includes(type));
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Load existing photos if editing
  useEffect(() => {
    const loadExistingPhotos = async () => {
      if (editingEntry) {
        try {
          const photos = await getPhotosForMapping(editingEntry.id);

          // Convert photos to previews and files
          const previews = await Promise.all(
            photos.map(photo => {
              return new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(photo.blob);
              });
            })
          );

          // Convert Blobs to Files for consistency
          const files = photos.map((photo, idx) =>
            new File([photo.blob], `photo-${idx}.jpg`, { type: photo.blob.type })
          );

          // Track photo IDs for deletion
          const ids = photos.map(photo => photo.id);

          setPhotoPreviews(previews);
          setPhotoFiles(files);
          setPhotoIds(ids);
          setInitialPhotoCount(files.length);
        } catch (error) {
          console.error('Failed to load existing photos:', error);
        }
      }
    };

    loadExistingPhotos();
  }, [editingEntry]);

  // Auto-calculate next intervention number if enabled (only for new entries)
  useEffect(() => {
    const calculateNextInterventionNumber = async () => {
      if (!editingEntry && project?.useInterventionNumbering) {
        try {
          const existingMappings = await getMappingEntriesForProject(project.id);
          const maxNumber = existingMappings.reduce((max, mapping) => {
            const num = parseInt(mapping.intervention || '0');
            return !isNaN(num) && num > max ? num : max;
          }, 0);
          setInterventionNumber((maxNumber + 1).toString());
        } catch (error) {
          console.error('Failed to calculate intervention number:', error);
        }
      }
    };

    if (project) {
      calculateNextInterventionNumber();
    }
  }, [project, editingEntry]);

  // Load floor plan for current floor
  useEffect(() => {
    loadFloorPlan();
    return () => {
      // Cleanup blob URL
      if (floorPlanImageUrl) {
        URL.revokeObjectURL(floorPlanImageUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, project?.id]);

  // Check for duplicate entries
  useEffect(() => {
    const checkDuplicates = async () => {
      if (!project || !floor) {
        setDuplicateWarning('');
        return;
      }

      try {
        const existingMappings = await getMappingEntriesForProject(project.id);

        // Filter out the current entry if we're editing
        const otherMappings = editingEntry
          ? existingMappings.filter(m => m.id !== editingEntry.id)
          : existingMappings;

        // Check for duplicates based on floor, room, and intervention
        const hasDuplicate = otherMappings.some(mapping => {
          const floorMatch = mapping.floor === floor;
          // Normalize empty values: treat undefined and "" as equivalent
          const roomMatch = project.useRoomNumbering
            ? (mapping.room || '') === (roomNumber || '')
            : true;
          const interventionMatch = project.useInterventionNumbering
            ? (mapping.intervention || '') === (interventionNumber || '')
            : true;

          return floorMatch && roomMatch && interventionMatch;
        });

        if (hasDuplicate && (project.useInterventionNumbering && interventionNumber)) {
          // Find next available intervention number
          const interventionNumbers = otherMappings
            .filter(m => {
              const floorMatch = m.floor === floor;
              // Normalize empty values: treat undefined and "" as equivalent
              const roomMatch = project.useRoomNumbering
                ? (m.room || '') === (roomNumber || '')
                : true;
              return floorMatch && roomMatch;
            })
            .map(m => parseInt(m.intervention || '0'))
            .filter(n => !isNaN(n));

          const maxNumber = interventionNumbers.length > 0 ? Math.max(...interventionNumbers) : 0;
          const suggestedNumber = maxNumber + 1;

          setDuplicateWarning(`⚠️ Esiste già una mappatura con questa combinazione Piano/Stanza/Intervento. Numero intervento suggerito: ${suggestedNumber}`);
        } else if (hasDuplicate) {
          setDuplicateWarning('⚠️ Esiste già una mappatura con questa combinazione Piano/Stanza/Intervento.');
        } else {
          setDuplicateWarning('');
        }
      } catch (error) {
        console.error('Error checking duplicates:', error);
      }
    };

    checkDuplicates();
  }, [floor, roomNumber, interventionNumber, project, editingEntry]);

  const loadFloorPlan = async () => {
    if (!project || !floor) return;

    try {
      const floorPlan = await getFloorPlanByProjectAndFloor(project.id, floor);
      setCurrentFloorPlan(floorPlan || null);

      if (floorPlan) {
        // Check if imageBlob is available
        if (floorPlan.imageBlob) {
          // Create blob URL for display
          const url = getFloorPlanBlobUrl(floorPlan.imageBlob);
          setFloorPlanImageUrl(url);
        } else {
          console.warn('Floor plan found but imageBlob is missing');
          setFloorPlanImageUrl(null);
        }
      } else {
        setFloorPlanImageUrl(null);
      }
    } catch (error) {
      console.error('Error loading floor plan:', error);
    }
  };

  const handleOpenFloorPlanEditor = async () => {
    if (!currentFloorPlan || !project) return;

    // Get the current mapping entry (either editing or draft)
    const currentEntry = editingEntry || savedDraftEntry;

    // If no entry exists yet, create a draft entry
    if (!currentEntry) {
      try {
        setIsSubmitting(true);

        // Create draft entry with current form data
        const draftEntry = await createMappingEntry(
          {
            projectId: project.id,
            floor,
            room: project.useRoomNumbering ? roomNumber : undefined,
            intervention: project.useInterventionNumbering ? interventionNumber : undefined,
            toComplete: true, // Mark as "to complete" since it's a draft
            crossings: sigillature.map((s, index) => ({
              ...s,
              id: s.id || `${Date.now()}-${index}`,
            })),
            createdBy: currentUser.id,
          },
          [] // No photos yet
        );

        setSavedDraftEntry(draftEntry);
        console.log('Bozza mappatura salvata automaticamente:', draftEntry.id);
      } catch (error) {
        console.error('Error saving draft mapping:', error);
        alert('Errore nel salvataggio automatico. Riprova.');
        setIsSubmitting(false);
        return;
      } finally {
        setIsSubmitting(false);
      }
    }

    // Load existing point if editing or draft exists
    const entryToCheck = editingEntry || savedDraftEntry;
    if (entryToCheck) {
      const point = await getFloorPlanPointByMappingEntry(entryToCheck.id);
      setCurrentFloorPlanPoint(point || null);
    }

    setShowFloorPlanEditor(true);
  };

  const handleSaveFloorPlanPoint = async (points: CanvasPoint[], gridConfig: GridConfig) => {
    if (!currentFloorPlan) {
      alert('Errore: planimetria non trovata');
      return;
    }

    // Get the current mapping entry (either editing or draft)
    const currentEntry = editingEntry || savedDraftEntry;

    if (!currentEntry) {
      // This should never happen since we create a draft in handleOpenFloorPlanEditor
      alert('Errore: nessuna mappatura trovata. Riprova.');
      setShowFloorPlanEditor(false);
      return;
    }

    try {
      // We expect only one point per mapping entry
      const point = points[0];
      if (!point) {
        alert('Nessun punto aggiunto');
        setShowFloorPlanEditor(false);
        return;
      }

      if (currentFloorPlanPoint) {
        // Update existing point
        await updateFloorPlanPoint(currentFloorPlanPoint.id, {
          pointType: point.type,
          pointX: point.pointX,
          pointY: point.pointY,
          labelX: point.labelX,
          labelY: point.labelY,
          perimeterPoints: point.perimeterPoints,
          customText: point.customText,
        });
      } else {
        // Create new point
        await createFloorPlanPoint(
          currentFloorPlan.id,
          currentEntry.id,
          point.type,
          point.pointX,
          point.pointY,
          point.labelX,
          point.labelY,
          currentUser.id,
          {
            perimeterPoints: point.perimeterPoints,
            customText: point.customText,
          }
        );
      }

      // Save grid configuration to floor plan
      await updateFloorPlan(currentFloorPlan.id, {
        gridEnabled: gridConfig.enabled,
        gridConfig: {
          rows: gridConfig.rows,
          cols: gridConfig.cols,
          offsetX: gridConfig.offsetX,
          offsetY: gridConfig.offsetY,
        }
      });

      // Update local state
      setCurrentFloorPlan({
        ...currentFloorPlan,
        gridEnabled: gridConfig.enabled,
        gridConfig: {
          rows: gridConfig.rows,
          cols: gridConfig.cols,
          offsetX: gridConfig.offsetX,
          offsetY: gridConfig.offsetY,
        }
      });

      alert('Punto salvato sulla planimetria!');
      setShowFloorPlanEditor(false);
    } catch (error) {
      console.error('Error saving floor plan point:', error);
      alert('Errore nel salvataggio del punto');
    }
  };

  const generateLabelText = (): string[] => {
    // Line 1: Photo name
    const photoName = generatePhotoPrefix(floor, roomNumber, interventionNumber) + '01';

    // Line 2: Tipologici numbers - get all unique tipologici, sorted by number
    const tipNumbers = sigillature
      .map(sig => {
        if (sig.tipologicoId) {
          const tip = project?.typologies.find(t => t.id === sig.tipologicoId);
          return tip ? tip.number : null;
        }
        return null;
      })
      .filter((n): n is number => n !== null)
      .filter((value, index, self) => self.indexOf(value) === index) // Remove duplicates
      .sort((a, b) => a - b) // Sort ascending
      .join(' - ');

    const tipLine = tipNumbers ? `tip. ${tipNumbers}` : '';

    return [photoName, tipLine].filter(Boolean);
  };

  const generatePhotoPrefix = (floorNum: string, room?: string, intervention?: string): string => {
    const parts: string[] = [];

    if (project?.floors && project.floors.length > 1) {
      parts.push(`P${floorNum}`);
    }

    if (project?.useRoomNumbering && room) {
      parts.push(`S${room}`);
    }

    if (project?.useInterventionNumbering && intervention) {
      parts.push(`Int${intervention}`);
    }

    return parts.length > 0 ? parts.join('_') + '_' : '';
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);

      // Store original files
      setPhotoFiles(prev => [...prev, ...files]);

      // Add null IDs for new photos (they don't have IDs yet)
      setPhotoIds(prev => [...prev, ...files.map(() => null)]);

      // Generate previews
      const previews = await Promise.all(
        files.map(file => {
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
        })
      );

      setPhotoPreviews(prev => [...prev, ...previews]);
    }
  };

  const handleRemovePhoto = (index: number) => {
    // If this is an existing photo (has an ID), mark it for removal
    const photoId = photoIds[index];
    if (photoId) {
      setPhotosToRemove(prev => [...prev, photoId]);
      // Decrement initial count since we're removing an existing photo
      setInitialPhotoCount(prev => prev - 1);
    }

    // Remove from UI arrays
    setPhotoFiles(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
    setPhotoIds(prev => prev.filter((_, i) => i !== index));
  };

  const handleCameraClick = () => {
    if (cameraInputRef.current) {
      cameraInputRef.current.click();
    }
  };

  const handleBrowseClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleAddSigillatura = () => {
    // Pre-compila con i valori dell'ultima riga
    const lastSig = sigillature[sigillature.length - 1];
    setSigillature([
      ...sigillature,
      {
        id: `${Date.now()}-${sigillature.length}`,
        supporto: lastSig?.supporto || '',
        tipoSupporto: lastSig?.tipoSupporto || '',
        attraversamento: '',
        tipologicoId: undefined,
        quantita: undefined,
        diametro: undefined,
        dimensioni: undefined,
        notes: ''
      }
    ]);
  };

  const handleRemoveSigillatura = (index: number) => {
    if (sigillature.length > 1) {
      setSigillature(sigillature.filter((_, i) => i !== index));
    }
  };

  const handleSigillaturaChange = (
    index: number,
    field: keyof Omit<Crossing, 'id'>,
    value: string | number
  ) => {
    const updatedSigillature = [...sigillature];
    updatedSigillature[index] = {
      ...updatedSigillature[index],
      [field]: value || undefined
    };
    setSigillature(updatedSigillature);
  };

  const handleFloorChange = (newFloor: string) => {
    setFloor(newFloor);
    // Salva in localStorage
    localStorage.setItem('lastUsedFloor', newFloor);
  };

  const handleCopyPrevious = async () => {
    if (!project) return;

    try {
      const lastEntryJson = localStorage.getItem('lastMappingEntry');
      if (!lastEntryJson) {
        alert('Nessuna mappatura precedente trovata');
        return;
      }

      const lastEntry = JSON.parse(lastEntryJson);

      // Copy all fields except intervention number (which should be progressive)
      setFloor(lastEntry.floor || floor);
      setRoomNumber(lastEntry.room || '');
      setSigillature(lastEntry.crossings || [{ id: `${Date.now()}-0`, supporto: '', tipoSupporto: '', attraversamento: '', tipologicoId: undefined, quantita: undefined, diametro: undefined, dimensioni: undefined, notes: '' }]);

      // Calculate next intervention number
      if (project.useInterventionNumbering) {
        const existingMappings = await getMappingEntriesForProject(project.id);
        const maxNumber = existingMappings.reduce((max, mapping) => {
          const num = parseInt(mapping.intervention || '0');
          return !isNaN(num) && num > max ? num : max;
        }, 0);
        setInterventionNumber((maxNumber + 1).toString());
      }

      alert('Campi copiati dalla mappatura precedente');
    } catch (error) {
      console.error('Error copying previous entry:', error);
      alert('Errore nel caricamento della mappatura precedente');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!project) {
      setError('Nessun progetto selezionato');
      return;
    }

    setIsSubmitting(true);

    try {
      let compressedBlobs: Blob[] = [];

      // Comprimi solo le nuove foto (se stiamo modificando/aggiornando draft) o tutte (se stiamo creando)
      const existingEntryForCompression = editingEntry || savedDraftEntry;
      const photosToCompress = existingEntryForCompression
        ? photoFiles.slice(initialPhotoCount)
        : photoFiles;

      if (photosToCompress.length > 0) {
        compressedBlobs = await Promise.all(
          photosToCompress.map(async (file) => {
            const options = {
              maxSizeMB: 1,
              maxWidthOrHeight: 1920,
              useWebWorker: true,
            };

            const compressedFile = await imageCompression(file, options);
            return compressedFile as Blob;
          })
        );

        console.log(`Compresse ${photosToCompress.length} foto`);
      }

      // Determine if we're updating an existing entry or a draft
      const existingEntry = editingEntry || savedDraftEntry;

      if (existingEntry) {
        // Check if there are photos remaining after removals
        const finalPhotoCount = photoFiles.length;
        const shouldMarkToComplete = finalPhotoCount === 0;

        // Update existing entry (or draft)
        await updateMappingEntry(
          existingEntry.id,
          {
            floor,
            room: project.useRoomNumbering ? roomNumber : undefined,
            intervention: project.useInterventionNumbering ? interventionNumber : undefined,
            toComplete: shouldMarkToComplete || toComplete,
            crossings: sigillature.map((s, index) => ({
              ...s,
              id: s.id || `${Date.now()}-${index}`,
            })),
          },
          currentUser.id
        );

        // Remove photos that were marked for deletion
        if (photosToRemove.length > 0) {
          for (const photoId of photosToRemove) {
            await removePhotoFromMapping(existingEntry.id, photoId, currentUser.id);
          }
          console.log(`Rimosse ${photosToRemove.length} foto dalla mappatura`);
        }

        // Add new photos if any were added
        if (compressedBlobs.length > 0) {
          await addPhotosToMapping(existingEntry.id, compressedBlobs, currentUser.id);
          console.log(`Aggiunte ${compressedBlobs.length} nuove foto alla mappatura`);
        }

        console.log('Mappatura aggiornata:', existingEntry.id);
        alert('Mappatura aggiornata con successo!');

        // Clear draft state if it was a draft
        if (savedDraftEntry) {
          setSavedDraftEntry(null);
        }

        // Go back to view
        onBack();
      } else {
        // Check if there are no photos - auto-flag as "da completare"
        const shouldMarkToComplete = compressedBlobs.length === 0;

        // Create new entry
        const mappingEntry = await createMappingEntry(
          {
            projectId: project.id,
            floor,
            room: project.useRoomNumbering ? roomNumber : undefined,
            intervention: project.useInterventionNumbering ? interventionNumber : undefined,
            toComplete: shouldMarkToComplete || toComplete,
            crossings: sigillature.map((s, index) => ({
              ...s,
              id: `${Date.now()}-${index}`,
            })),
            createdBy: currentUser.id,
          },
          compressedBlobs
        );

        // Save to localStorage for "Copia prec." functionality
        const lastEntryData = {
          floor,
          room: project.useRoomNumbering ? roomNumber : undefined,
          intervention: project.useInterventionNumbering ? interventionNumber : undefined,
          crossings: sigillature.map((s, index) => ({
            ...s,
            id: `${Date.now()}-${index}`,
          })),
        };
        localStorage.setItem('lastMappingEntry', JSON.stringify(lastEntryData));

        console.log('Mappatura creata:', mappingEntry.id);
        alert('Mappatura salvata con successo!');

        // Reset form
        setPhotoFiles([]);
        setPhotoPreviews([]);
        setPhotoIds([]);
        setRoomNumber('');
        setToComplete(false);
        if (project.useInterventionNumbering) {
          const nextNum = parseInt(interventionNumber) + 1;
          setInterventionNumber(nextNum.toString());
        }
        setSigillature([{ id: `${Date.now()}-0`, supporto: '', tipoSupporto: '', attraversamento: '', tipologicoId: undefined, quantita: undefined, diametro: undefined, dimensioni: undefined, notes: '' }]);

        // Reset file inputs
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (cameraInputRef.current) cameraInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Errore nel salvataggio della mappatura:', err);
      setError('Errore nel salvataggio. Riprova.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mapping-page">
      <NavigationBar
        title={editingEntry ? 'Modifica Mappatura' : 'Mappatura'}
        onBack={onBack}
        onSync={onSync}
        isSyncing={isSyncing}
        onCopyPrevious={!editingEntry ? handleCopyPrevious : undefined}
      />
      <div className="mapping-container">
        {error && (
          <div style={{
            padding: '12px',
            marginBottom: '16px',
            backgroundColor: '#FEE2E2',
            color: '#991B1B',
            borderRadius: '8px',
            fontSize: '0.875rem'
          }}>
            {error}
          </div>
        )}

        {duplicateWarning && (
          <div style={{
            padding: '12px',
            marginBottom: '16px',
            backgroundColor: '#FEF3C7',
            color: '#92400E',
            borderRadius: '8px',
            fontSize: '0.875rem',
            fontWeight: '500'
          }}>
            {duplicateWarning}
          </div>
        )}

        {/* Hidden file inputs */}
        <input
          type="file"
          ref={cameraInputRef}
          onChange={handleImageChange}
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: 'none' }}
        />
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImageChange}
          accept="image/*"
          multiple
          style={{ display: 'none' }}
        />

        <form onSubmit={handleSubmit} className="mapping-form">
          {/* Image Input Section */}
          <div className="image-buttons">
            <button type="button" className="camera-btn" onClick={handleCameraClick}>
              <CameraIcon className="camera-icon" />
            </button>
            <button type="button" className="browse-btn" onClick={handleBrowseClick}>
              Sfoglia
            </button>
            {/* Floor Plan Point Button */}
            {currentFloorPlan && (
              <button
                type="button"
                className="floor-plan-btn"
                onClick={handleOpenFloorPlanEditor}
                title="Aggiungi punto sulla planimetria"
              >
                <span className="btn-icon">📍</span>
                {editingEntry ? 'Modifica Punto' : 'Aggiungi Punto'}
              </button>
            )}
          </div>

          {photoPreviews.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: '12px',
              marginTop: '16px'
            }}>
              {photoPreviews.map((preview, index) => (
                <div key={index} style={{ position: 'relative' }}>
                  <img
                    src={preview}
                    alt={`Anteprima ${index + 1}`}
                    onClick={() => setSelectedPhotoPreview({ url: preview, alt: `Anteprima ${index + 1}` })}
                    style={{
                      width: '100%',
                      height: '120px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)',
                      cursor: 'pointer'
                    }}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePhoto(index);
                    }}
                    style={{
                      position: 'absolute',
                      top: '4px',
                      right: '4px',
                      backgroundColor: 'rgba(0,0,0,0.6)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '50%',
                      width: '24px',
                      height: '24px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16px',
                      lineHeight: '1'
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Floor Selection */}
          <div className="form-field">
            <label className="field-label">Piano</label>
            <select
              value={floor}
              onChange={(e) => handleFloorChange(e.target.value)}
              className="mapping-select"
            >
              {project?.floors && project.floors.length > 0 ? (
                [...project.floors].sort((a, b) => parseFloat(a) - parseFloat(b)).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))
              ) : (
                <option value="0">0</option>
              )}
            </select>
          </div>

          {/* Room/Intervention Input - Conditional */}
          {project?.useRoomNumbering && (
            <div className="form-field">
              <label className="field-label">Stanza</label>
              <input
                type="text"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                className="mapping-input"
                placeholder="Es: A1, B2, Cucina..."
              />
            </div>
          )}

          {project?.useInterventionNumbering && (
            <div className="form-field">
              <label className="field-label">Intervento n.</label>
              <input
                type="text"
                value={interventionNumber}
                onChange={(e) => setInterventionNumber(e.target.value)}
                className="mapping-input"
                placeholder="Es: 1, 2, A1..."
              />
            </div>
          )}

          {/* Da Completare Switch */}
          <div className="form-field">
            <div className="switch-container">
              <div
                className={`switch ${toComplete ? 'active' : ''}`}
                onClick={() => setToComplete(!toComplete)}
              >
                <div className="switch-thumb"></div>
              </div>
              <label className="switch-label" onClick={() => setToComplete(!toComplete)}>
                Da Completare
              </label>
            </div>
          </div>

          {/* Sigillature Section */}
          <div className="crossings-section">
            <label className="section-label">Sigillature</label>

            <div className="crossings-list">
              {sigillature.map((sig, index) => (
                <div key={index} className="crossing-row sigillatura-row">
                  <div className="crossing-fields">
                    <div className="crossing-field">
                      <label className="crossing-label">Supporto</label>
                      <select
                        value={sig.supporto}
                        onChange={(e) =>
                          handleSigillaturaChange(index, 'supporto', e.target.value)
                        }
                        className="crossing-select"
                      >
                        {SUPPORTO_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="crossing-field">
                      <label className="crossing-label">Tipo Supporto</label>
                      <select
                        value={sig.tipoSupporto}
                        onChange={(e) =>
                          handleSigillaturaChange(index, 'tipoSupporto', e.target.value)
                        }
                        className="crossing-select"
                      >
                        {TIPO_SUPPORTO_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="crossing-field attraversamento-field">
                      <label className="crossing-label">Attraversamento</label>
                      <select
                        value={sig.attraversamento}
                        onChange={(e) =>
                          handleSigillaturaChange(index, 'attraversamento', e.target.value)
                        }
                        className="crossing-select attraversamento-select"
                      >
                        {ATTRAVERSAMENTO_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Custom text input for "Altro" */}
                    {sig.attraversamento === 'Altro' && (
                      <div className="crossing-field">
                        <label className="crossing-label">Specifica tipo attraversamento</label>
                        <input
                          type="text"
                          value={sig.attraversamentoCustom || ''}
                          onChange={(e) =>
                            handleSigillaturaChange(index, 'attraversamentoCustom', e.target.value)
                          }
                          className="crossing-input"
                          placeholder="Es: Tubo in acciaio, Filo di rame, ecc..."
                        />
                      </div>
                    )}

                    {/* Quantità - shown for all attraversamenti when not empty */}
                    {sig.attraversamento && (
                      <div className="crossing-field">
                        <label className="crossing-label">Quantità</label>
                        <input
                          type="number"
                          value={sig.quantita || ''}
                          onChange={(e) =>
                            handleSigillaturaChange(index, 'quantita', e.target.value ? parseInt(e.target.value) : '')
                          }
                          className="crossing-input"
                          placeholder="N. attraversamenti"
                          min="1"
                        />
                      </div>
                    )}

                    {/* Diametro - shown for tubo types */}
                    {sig.attraversamento && needsDiametro(sig.attraversamento) && (
                      <div className="crossing-field">
                        <label className="crossing-label">Diametro</label>
                        <input
                          type="text"
                          value={sig.diametro || ''}
                          onChange={(e) =>
                            handleSigillaturaChange(index, 'diametro', e.target.value)
                          }
                          className="crossing-input"
                          placeholder="Es: 50mm, 2 pollici..."
                        />
                      </div>
                    )}

                    {/* Dimensioni - shown for canalina, serranda, asola, canala, altro */}
                    {sig.attraversamento && needsDimensioni(sig.attraversamento) && (
                      <div className="crossing-field">
                        <label className="crossing-label">Dimensioni</label>
                        <input
                          type="text"
                          value={sig.dimensioni || ''}
                          onChange={(e) =>
                            handleSigillaturaChange(index, 'dimensioni', e.target.value)
                          }
                          className="crossing-input"
                          placeholder="Es: 30x40cm, 500x300mm..."
                        />
                      </div>
                    )}

                    {project?.typologies && project.typologies.length > 0 && (
                      <>
                        <div className="crossing-field tipologico-field">
                          <div className="tipologico-label-wrapper">
                            <label className="crossing-label">Tipologico</label>
                            <button
                              type="button"
                              className="eye-btn"
                              onClick={() => setShowTypologyViewer(true)}
                              title="Visualizza tutti i tipologici"
                            >
                              <EyeIcon className="eye-icon" />
                            </button>
                          </div>
                          <select
                            value={sig.tipologicoId || ''}
                            onChange={(e) => {
                              const selectedTipId = e.target.value;
                              const selectedTipologico = project?.typologies.find(t => t.id === selectedTipId);

                              if (selectedTipologico) {
                                // Auto-fill fields from tipologico
                                const updatedSigillature = [...sigillature];
                                updatedSigillature[index] = {
                                  ...updatedSigillature[index],
                                  tipologicoId: selectedTipId,
                                  supporto: selectedTipologico.supporto,
                                  tipoSupporto: selectedTipologico.tipoSupporto,
                                  attraversamento: selectedTipologico.attraversamento,
                                  attraversamentoCustom: selectedTipologico.attraversamentoCustom
                                };
                                setSigillature(updatedSigillature);
                              } else {
                                // Just update tipologicoId if cleared
                                handleSigillaturaChange(index, 'tipologicoId', selectedTipId);
                              }
                            }}
                            className="crossing-select tipologico-select"
                          >
                            <option value=""></option>
                            {getSortedTypologies(sig).map((tip) => {
                              const isMatching = findMatchingTypology(sig)?.id === tip.id;
                              const getLabel = (options: { value: string; label: string }[], value: string) => {
                                const option = options.find(opt => opt.value === value);
                                return option?.label || value;
                              };
                              return (
                                <option key={tip.id} value={tip.id}>
                                  {isMatching ? '⭐ ' : ''}Tip. {tip.number} - {getLabel(ATTRAVERSAMENTO_OPTIONS, tip.attraversamento)} - {tip.marcaProdottoUtilizzato}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        {sig.tipologicoId && !isTypologyCoherent(sig) && (
                          <div className="crossing-field full-width">
                            <div className="typology-warning">
                              ⚠️ Il tipologico selezionato non è coerente con i campi Supporto, Tipo Supporto e Attraversamento.
                              {findMatchingTypology(sig) && (
                                <span> Suggerito: <strong>Tip. {findMatchingTypology(sig)!.number}</strong></span>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    <div className="crossing-field full-width">
                      <label className="crossing-label">Note</label>
                      <textarea
                        value={sig.notes || ''}
                        onChange={(e) =>
                          handleSigillaturaChange(index, 'notes', e.target.value)
                        }
                        className="crossing-textarea"
                        placeholder="Note aggiuntive..."
                        rows={2}
                      />
                    </div>
                  </div>

                  {sigillature.length > 1 && (
                    <button
                      type="button"
                      className="remove-crossing-btn"
                      onClick={() => handleRemoveSigillatura(index)}
                    >
                      −
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              className="add-crossing-btn"
              onClick={handleAddSigillatura}
            >
              +
            </button>
          </div>

          {/* Actions */}
          <div className="mapping-actions">
            <button
              type="button"
              className="back-btn"
              onClick={onBack}
              disabled={isSubmitting}
            >
              Indietro
            </button>
            <button
              type="submit"
              className="save-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? (editingEntry ? 'Aggiornamento...' : 'Salvataggio...') : (editingEntry ? 'Aggiorna' : 'Salva')}
            </button>
          </div>
        </form>
      </div>

      {/* Typology Viewer Modal */}
      {showTypologyViewer && project && (
        <TypologyViewerModal
          project={project}
          onClose={() => setShowTypologyViewer(false)}
        />
      )}

      {/* Floor Plan Editor Modal */}
      {showFloorPlanEditor && floorPlanImageUrl && currentFloorPlanPoint !== undefined && (
        <div className="floor-plan-editor-overlay">
          <FloorPlanEditor
            imageUrl={floorPlanImageUrl}
            initialPoints={currentFloorPlanPoint ? [{
              id: currentFloorPlanPoint.id,
              type: currentFloorPlanPoint.pointType,
              pointX: currentFloorPlanPoint.pointX,
              pointY: currentFloorPlanPoint.pointY,
              labelX: currentFloorPlanPoint.labelX,
              labelY: currentFloorPlanPoint.labelY,
              labelText: generateLabelText(),
              perimeterPoints: currentFloorPlanPoint.perimeterPoints,
              customText: currentFloorPlanPoint.customText,
            }] : []}
            initialGridConfig={currentFloorPlan?.gridConfig ? {
              enabled: currentFloorPlan.gridEnabled || false,
              rows: currentFloorPlan.gridConfig.rows,
              cols: currentFloorPlan.gridConfig.cols,
              offsetX: currentFloorPlan.gridConfig.offsetX,
              offsetY: currentFloorPlan.gridConfig.offsetY,
            } : undefined}
            mode="mapping"
            maxPoints={1}
            onSave={handleSaveFloorPlanPoint}
            onClose={() => setShowFloorPlanEditor(false)}
          />
        </div>
      )}

      {/* Photo Preview Modal */}
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

export default MappingPage;
