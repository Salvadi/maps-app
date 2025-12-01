import React, { useState, useRef, useEffect } from 'react';
import imageCompression from 'browser-image-compression';
import {
  Project,
  Crossing,
  User,
  MappingEntry,
  createMappingEntry,
  getMappingEntriesForProject,
  updateMappingEntry,
  getPhotosForMapping
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
          {project.typologies.map((tip) => (
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

const MappingPage: React.FC<MappingPageProps> = ({ project, currentUser, onBack, editingEntry }) => {
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);

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
  const [roomNumber, setRoomNumber] = useState<string>(editingEntry?.roomOrIntervention || '');
  const [interventionNumber, setInterventionNumber] = useState<number>(
    editingEntry ? parseInt(editingEntry.roomOrIntervention) || 1 : 1
  );
  const [sigillature, setSigillature] = useState<Crossing[]>(
    editingEntry && editingEntry.crossings.length > 0
      ? editingEntry.crossings
      : [{ id: `${Date.now()}-0`, supporto: '', tipoSupporto: '', attraversamento: '', tipologicoId: undefined, notes: '' }]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showTypologyViewer, setShowTypologyViewer] = useState(false);

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

  // Helper function to sort typologies with matching one first
  const getSortedTypologies = (crossing: Crossing) => {
    if (!project?.typologies) return [];

    const matchingTypology = findMatchingTypology(crossing);
    if (!matchingTypology) return project.typologies;

    // Put matching typology first
    return [
      matchingTypology,
      ...project.typologies.filter(t => t.id !== matchingTypology.id)
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

          setPhotoPreviews(previews);
          setPhotoFiles(files);
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
            const num = parseInt(mapping.roomOrIntervention);
            return !isNaN(num) && num > max ? num : max;
          }, 0);
          setInterventionNumber(maxNumber + 1);
        } catch (error) {
          console.error('Failed to calculate intervention number:', error);
        }
      }
    };

    if (project) {
      calculateNextInterventionNumber();
    }
  }, [project, editingEntry]);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);

      // Store original files
      setPhotoFiles(prev => [...prev, ...files]);

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
    setPhotoFiles(prev => prev.filter((_, i) => i !== index));
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index));
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
    value: string
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

      // Comprimi le foto solo se ce ne sono
      if (photoFiles.length > 0) {
        compressedBlobs = await Promise.all(
          photoFiles.map(async (file) => {
            const options = {
              maxSizeMB: 1,
              maxWidthOrHeight: 1920,
              useWebWorker: true,
            };

            const compressedFile = await imageCompression(file, options);
            return compressedFile as Blob;
          })
        );

        console.log(`Compresse ${photoFiles.length} foto`);
      }

      // Determine room/intervention value
      let roomOrIntervention = '';
      if (project.useInterventionNumbering) {
        roomOrIntervention = interventionNumber.toString();
      } else if (project.useRoomNumbering) {
        roomOrIntervention = roomNumber;
      }

      if (editingEntry) {
        // Update existing entry
        await updateMappingEntry(
          editingEntry.id,
          {
            floor,
            roomOrIntervention,
            crossings: sigillature.map((s, index) => ({
              ...s,
              id: s.id || `${Date.now()}-${index}`,
            })),
          },
          currentUser.id
        );

        console.log('Mappatura aggiornata:', editingEntry.id);
        alert('Mappatura aggiornata con successo!');

        // Go back to view
        onBack();
      } else {
        // Create new entry
        const mappingEntry = await createMappingEntry(
          {
            projectId: project.id,
            floor,
            roomOrIntervention,
            crossings: sigillature.map((s, index) => ({
              ...s,
              id: `${Date.now()}-${index}`,
            })),
            createdBy: currentUser.id,
          },
          compressedBlobs
        );

        console.log('Mappatura creata:', mappingEntry.id);
        alert('Mappatura salvata con successo!');

        // Reset form
        setPhotoFiles([]);
        setPhotoPreviews([]);
        setRoomNumber('');
        if (project.useInterventionNumbering) {
          setInterventionNumber(prev => prev + 1);
        }
        setSigillature([{ id: `${Date.now()}-0`, supporto: '', tipoSupporto: '', attraversamento: '', tipologicoId: undefined, notes: '' }]);

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
      <div className="mapping-container">
        <h1 className="mapping-title">{editingEntry ? 'Modifica Mappatura' : 'Mappatura'}</h1>

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
                    style={{
                      width: '100%',
                      height: '120px',
                      objectFit: 'cover',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemovePhoto(index)}
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
                project.floors.map((f) => (
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
                type="number"
                value={interventionNumber}
                onChange={(e) => setInterventionNumber(parseInt(e.target.value) || 1)}
                className="mapping-input"
                min="1"
              />
            </div>
          )}

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

                    {project?.typologies && project.typologies.length > 0 && (
                      <>
                        <div className="crossing-field tipologico-field">
                          <label className="crossing-label">Tipologico</label>
                          <div className="tipologico-input-wrapper">
                            <select
                              value={sig.tipologicoId || ''}
                              onChange={(e) =>
                                handleSigillaturaChange(index, 'tipologicoId', e.target.value)
                              }
                              className="crossing-select tipologico-select"
                            >
                              <option value=""></option>
                              {getSortedTypologies(sig).map((tip) => {
                                const isMatching = findMatchingTypology(sig)?.id === tip.id;
                                return (
                                  <option key={tip.id} value={tip.id}>
                                    {isMatching ? '⭐ ' : ''}Tip. {tip.number} - {tip.supporto} {tip.tipoSupporto}
                                  </option>
                                );
                              })}
                            </select>
                            <button
                              type="button"
                              className="eye-btn"
                              onClick={() => setShowTypologyViewer(true)}
                              title="Visualizza tutti i tipologici"
                            >
                              <EyeIcon className="eye-icon" />
                            </button>
                          </div>
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
    </div>
  );
};

export default MappingPage;
