import React, { useState } from 'react';
import { Project, Typology, User, createProject, updateProject, archiveProject, unarchiveProject } from '../db';
import NavigationBar from './NavigationBar';
import ProductSelector from './ProductSelector';
import { SUPPORTO_OPTIONS } from '../config/supporto';
import { TIPO_SUPPORTO_OPTIONS } from '../config/tipoSupporto';
import { ATTRAVERSAMENTO_OPTIONS } from '../config/attraversamento';
import { MARCA_PRODOTTO_OPTIONS } from '../config/marcaProdotto';
import './ProjectForm.css';

interface ProjectFormProps {
  project: Project | null;
  currentUser: User;
  onSave: () => void;
  onCancel: () => void;
  onSync?: () => void;
  isSyncing?: boolean;
}

const ProjectForm: React.FC<ProjectFormProps> = ({ project, currentUser, onSave, onCancel, onSync, isSyncing }) => {
  const [title, setTitle] = useState(project?.title || '');
  const [client, setClient] = useState(project?.client || '');
  const [address, setAddress] = useState(project?.address || '');
  const [notes, setNotes] = useState(project?.notes || '');
  const [floorsInput, setFloorsInput] = useState(
    project?.floors.join(', ') || '-1, 0, 1, 2, 3'
  );
  const [floorsEnabled, setFloorsEnabled] = useState(
    project?.floors && project.floors.length > 0 && project.floors[0] !== '0'
  );
  const [useRoomNumbering, setUseRoomNumbering] = useState(
    project?.useRoomNumbering || false
  );
  const [useInterventionNumbering, setUseInterventionNumbering] = useState(
    project?.useInterventionNumbering || false
  );
  const [showTipologici, setShowTipologici] = useState(
    project?.typologies && project.typologies.length > 0
  );
  const [typologies, setTypologies] = useState<Typology[]>(
    project?.typologies && project.typologies.length > 0
      ? project.typologies
      : [
          {
            id: Date.now().toString(),
            number: 1,
            supporto: '',
            tipoSupporto: '',
            attraversamento: '',
            marcaProdottoUtilizzato: '',
            prodottiSelezionati: [],
          },
        ]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleAddTypology = () => {
    const maxNumber = Math.max(...typologies.map((t) => t.number), 0);
    setTypologies([
      ...typologies,
      {
        id: Date.now().toString(),
        number: maxNumber + 1,
        supporto: '',
        tipoSupporto: '',
        attraversamento: '',
        marcaProdottoUtilizzato: '',
        prodottiSelezionati: [],
      },
    ]);
  };

  const handleRemoveTypology = (id: string) => {
    if (typologies.length > 1) {
      setTypologies(typologies.filter((t) => t.id !== id));
    }
  };

  const handleTypologyChange = (
    id: string,
    field: keyof Omit<Typology, 'id'>,
    value: string | number | string[]
  ) => {
    setTypologies(
      typologies.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const floorsArray = floorsEnabled
        ? floorsInput
            .split(',')
            .map((f) => f.trim())
            .filter((f) => f !== '')
        : ['0'];

      if (project) {
        // Update existing project
        await updateProject(project.id, {
          title,
          client,
          address,
          notes,
          floors: floorsArray,
          useRoomNumbering,
          useInterventionNumbering,
          typologies: showTipologici ? typologies : [],
        });
        console.log('Project updated:', project.id);
      } else {
        // Create new project
        const newProject = await createProject({
          title,
          client,
          address,
          notes,
          floors: floorsArray,
          plans: [],
          useRoomNumbering,
          useInterventionNumbering,
          typologies: showTipologici ? typologies : [],
          ownerId: currentUser.id,
          accessibleUsers: [currentUser.id],
        });
        console.log('Project created:', newProject.id);
      }

      onSave();
    } catch (err) {
      console.error('Failed to save project:', err);
      setError('Failed to save project. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!project) return;

    if (window.confirm(`Archiviare il progetto "${project.title}"? Non sarà più visibile nella home page.`)) {
      setIsSubmitting(true);
      try {
        await archiveProject(project.id);
        console.log('Project archived:', project.id);
        onSave(); // Return to home
      } catch (err) {
        console.error('Failed to archive project:', err);
        setError('Failed to archive project. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleUnarchive = async () => {
    if (!project) return;

    if (window.confirm(`Riaprire il progetto "${project.title}"? Sarà nuovamente visibile nella home page.`)) {
      setIsSubmitting(true);
      try {
        await unarchiveProject(project.id);
        console.log('Project unarchived:', project.id);
        onSave(); // Return to home
      } catch (err) {
        console.error('Failed to unarchive project:', err);
        setError('Failed to unarchive project. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="project-form-page">
      <NavigationBar
        title={project ? 'Modifica Dati Cantiere' : 'Dati Cantiere'}
        onBack={onCancel}
        onSync={onSync}
        isSyncing={isSyncing}
      />
      <div className="project-form-container">
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

        <form onSubmit={handleSubmit} className="project-form">
          {/* Title Section */}
          <section className="form-section">
            <label className="section-label">Nome Cantiere</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input"
              required
            />
          </section>

          {/* Anagrafica Section */}
          <section className="form-section">
            <label className="section-label">Anagrafica</label>
            <input
              type="text"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Client"
              className="form-input"
            />
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
              className="form-input"
            />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              className="form-textarea"
              rows={3}
            />
          </section>

          {/* Struttura Section */}
          <section className="form-section">
            <label className="section-label">Struttura</label>
            <button type="button" className="upload-button">
              Carica pianta
            </button>
            <div className="floors-input-group">
              <div className="switch-container">
                <div
                  className={`switch ${floorsEnabled ? 'active' : ''}`}
                  onClick={() => setFloorsEnabled(!floorsEnabled)}
                >
                  <div className="switch-thumb"></div>
                </div>
                <label className="switch-label" onClick={() => setFloorsEnabled(!floorsEnabled)}>
                  Piani
                </label>
              </div>
              {floorsEnabled && (
                <input
                  type="text"
                  value={floorsInput}
                  onChange={(e) => setFloorsInput(e.target.value)}
                  placeholder="-1, 0, 1, 2, 3..."
                  className="form-input floors-input"
                />
              )}
            </div>
          </section>

          {/* Numerazione interventi Section */}
          <section className="form-section">
            <label className="section-label">Numerazione interventi</label>
            <div className="intervention-switches">
              <div className="switch-container">
                <div
                  className={`switch ${useRoomNumbering ? 'active' : ''}`}
                  onClick={() => setUseRoomNumbering(!useRoomNumbering)}
                >
                  <div className="switch-thumb"></div>
                </div>
                <label className="switch-label" onClick={() => setUseRoomNumbering(!useRoomNumbering)}>
                  Stanza
                </label>
              </div>
              <div className="switch-container">
                <div
                  className={`switch ${useInterventionNumbering ? 'active' : ''}`}
                  onClick={() => setUseInterventionNumbering(!useInterventionNumbering)}
                >
                  <div className="switch-thumb"></div>
                </div>
                <label className="switch-label" onClick={() => setUseInterventionNumbering(!useInterventionNumbering)}>
                  Intervento n.
                </label>
              </div>
            </div>
          </section>

          {/* Tipologici Section */}
          <section className="form-section tipologici-section">
            <div className="tipologici-header">
              <label className="section-label">Tipologici</label>
              <button
                type="button"
                className="toggle-button"
                onClick={() => setShowTipologici(!showTipologici)}
              >
                {showTipologici ? 'Hide' : 'Show'}
              </button>
            </div>

            {showTipologici && (
              <div className="tipologici-table">
                <div className="table-header">
                  <div className="table-cell table-cell-number">N.</div>
                  <div className="table-cell">Supporto</div>
                  <div className="table-cell">Tipo Supporto</div>
                  <div className="table-cell">Attraversamento</div>
                  <div className="table-cell">Marca prodotto</div>
                  <div className="table-cell">Materiali</div>
                </div>

                {typologies.map((typology) => (
                  <div key={typology.id} className="table-row">
                    <div className="table-row-mobile-first">
                      <div className="table-cell table-cell-number">
                        <input
                          type="number"
                          value={typology.number}
                          readOnly
                          className="table-input table-input-number"
                          min="1"
                          max="999"
                        />
                      </div>
                      <div className="table-cell">
                        <select
                          value={typology.supporto}
                          onChange={(e) =>
                            handleTypologyChange(typology.id, 'supporto', e.target.value)
                          }
                          className="table-select"
                        >
                          {SUPPORTO_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="table-cell">
                        <select
                          value={typology.tipoSupporto}
                          onChange={(e) =>
                            handleTypologyChange(typology.id, 'tipoSupporto', e.target.value)
                          }
                          className="table-select"
                        >
                          {TIPO_SUPPORTO_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="table-cell">
                      <select
                        value={typology.attraversamento}
                        onChange={(e) =>
                          handleTypologyChange(typology.id, 'attraversamento', e.target.value)
                        }
                        className="table-select"
                      >
                        {ATTRAVERSAMENTO_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="table-cell">
                      <select
                        value={typology.marcaProdottoUtilizzato}
                        onChange={(e) =>
                          handleTypologyChange(
                            typology.id,
                            'marcaProdottoUtilizzato',
                            e.target.value
                          )
                        }
                        className="table-select"
                      >
                        {MARCA_PRODOTTO_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="table-cell">
                      <ProductSelector
                        marca={typology.marcaProdottoUtilizzato}
                        selectedProducts={typology.prodottiSelezionati}
                        onChange={(products) =>
                          handleTypologyChange(typology.id, 'prodottiSelezionati', products)
                        }
                      />
                    </div>
                    <div className="table-cell actions">
                      {typologies.length > 1 && (
                        <button
                          type="button"
                          className="remove-row-btn"
                          onClick={() => handleRemoveTypology(typology.id)}
                        >
                          −
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="add-row-btn"
                  onClick={handleAddTypology}
                >
                  + Add row
                </button>
              </div>
            )}
          </section>

          {/* Form Actions */}
          <div className="form-actions">
            <button
              type="button"
              className="cancel-btn"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="create-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : (project ? 'Save' : 'Create')}
            </button>
          </div>

          {/* Archive/Unarchive Button - only for existing projects */}
          {project && (
            <div className="archive-section">
              {project.archived === 1 ? (
                <button
                  type="button"
                  className="unarchive-btn"
                  onClick={handleUnarchive}
                  disabled={isSubmitting}
                >
                  Riapri
                </button>
              ) : (
                <button
                  type="button"
                  className="archive-btn"
                  onClick={handleArchive}
                  disabled={isSubmitting}
                >
                  Archivia
                </button>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default ProjectForm;
