import React, { useState, useRef, useEffect } from 'react';
import imageCompression from 'browser-image-compression';
import { Project, Crossing, User, createMappingEntry, getMappingEntriesForProject } from '../db';
import { SUPPORTO_OPTIONS } from '../config/supporto';
import { TIPO_SUPPORTO_OPTIONS } from '../config/tipoSupporto';
import { ATTRAVERSAMENTO_OPTIONS } from '../config/attraversamento';
import './MappingPage.css';

interface MappingPageProps {
  project: Project | null;
  currentUser: User;
  onBack: () => void;
}

// Camera Icon Component
const CameraIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M23 19C23 19.5304 22.7893 20.0391 22.4142 20.4142C22.0391 20.7893 21.5304 21 21 21H3C2.46957 21 1.96086 20.7893 1.58579 20.4142C1.21071 20.0391 1 19.5304 1 19V8C1 7.46957 1.21071 6.96086 1.58579 6.58579C1.96086 6.21071 2.46957 6 3 6H7L9 3H15L17 6H21C21.5304 6 22.0391 6.21071 22.4142 6.58579C22.7893 6.96086 23 7.46957 23 8V19Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const MappingPage: React.FC<MappingPageProps> = ({ project, currentUser, onBack }) => {
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);

  // Recupera l'ultimo piano usato da localStorage
  const getLastUsedFloor = () => {
    const lastFloor = localStorage.getItem('lastUsedFloor');
    if (lastFloor && project?.floors.includes(lastFloor)) {
      return lastFloor;
    }
    return project?.floors[0] || '0';
  };

  const [floor, setFloor] = useState<string>(getLastUsedFloor());
  const [roomNumber, setRoomNumber] = useState<string>('');
  const [interventionNumber, setInterventionNumber] = useState<number>(1);
  const [sigillature, setSigillature] = useState<Omit<Crossing, 'id'>[]>([
    { supporto: '', tipoSupporto: '', attraversamento: '', tipologicoId: undefined, notes: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Auto-calculate next intervention number if enabled
  useEffect(() => {
    const calculateNextInterventionNumber = async () => {
      if (project?.useInterventionNumbering) {
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
  }, [project]);

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

      // Save mapping entry to IndexedDB
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
      setSigillature([{ supporto: '', tipoSupporto: '', attraversamento: '', tipologicoId: undefined, notes: '' }]);

      // Reset file inputs
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
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
        <h1 className="mapping-title">Mappatura</h1>

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

                    <div className="crossing-field">
                      <label className="crossing-label">Attraversamento</label>
                      <select
                        value={sig.attraversamento}
                        onChange={(e) =>
                          handleSigillaturaChange(index, 'attraversamento', e.target.value)
                        }
                        className="crossing-select"
                      >
                        {ATTRAVERSAMENTO_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    {project?.typologies && project.typologies.length > 0 && (
                      <div className="crossing-field tipologico-field">
                        <label className="crossing-label">Tipologico</label>
                        <select
                          value={sig.tipologicoId || ''}
                          onChange={(e) =>
                            handleSigillaturaChange(index, 'tipologicoId', e.target.value)
                          }
                          className="crossing-select tipologico-select"
                        >
                          <option value=""></option>
                          {project.typologies.map((tip) => (
                            <option key={tip.id} value={tip.id}>
                              Tip. {tip.number} - {tip.supporto} {tip.tipoSupporto}
                            </option>
                          ))}
                        </select>
                      </div>
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
              {isSubmitting ? 'Salvataggio...' : 'Salva'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MappingPage;
