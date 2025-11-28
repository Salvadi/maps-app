import React, { useState } from 'react';
import { Project, Typology, User, createProject, updateProject } from '../db';
import './ProjectForm.css';

// Costanti per i menu dei Tipologici
const SUPPORTO_OPTIONS = [
  { value: '', label: '' },
  { value: 'brick', label: 'Mattoni' },
  { value: 'concrete', label: 'Cemento' },
  { value: 'wood', label: 'Legno' },
  { value: 'steel', label: 'Acciaio' },
];

const MATERIALI_OPTIONS = [
  { value: '', label: '' },
  { value: 'plastic', label: 'Plastica' },
  { value: 'metal', label: 'Metallo' },
  { value: 'fiber', label: 'Fibra' },
  { value: 'composite', label: 'Composito' },
];

const ATTRAVERSAMENTO_OPTIONS = [
  { value: '', label: '' },
  { value: 'horizontal', label: 'Orizzontale' },
  { value: 'vertical', label: 'Verticale' },
  { value: 'diagonal', label: 'Diagonale' },
];

interface ProjectFormProps {
  project: Project | null;
  currentUser: User;
  onSave: () => void;
  onCancel: () => void;
}

const ProjectForm: React.FC<ProjectFormProps> = ({ project, currentUser, onSave, onCancel }) => {
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
            materiali: '',
            attraversamento: '',
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
        materiali: '',
        attraversamento: '',
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
    value: string | number
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

  return (
    <div className="project-form-page">
      <div className="project-form-container">
        <h1 className="form-title">{project ? 'Modifica Dati Cantiere' : 'Dati Cantiere'}</h1>

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
                  <div className="table-cell">Materiali</div>
                  <div className="table-cell">Attraversamento</div>
                </div>

                {typologies.map((typology) => (
                  <div key={typology.id} className="table-row">
                    <div className="table-cell table-cell-number">
                      <input
                        type="number"
                        value={typology.number}
                        onChange={(e) =>
                          handleTypologyChange(
                            typology.id,
                            'number',
                            parseInt(e.target.value) || 1
                          )
                        }
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
                        value={typology.materiali}
                        onChange={(e) =>
                          handleTypologyChange(typology.id, 'materiali', e.target.value)
                        }
                        className="table-select"
                      >
                        {MATERIALI_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="table-cell">
                      <select
                        value={typology.attraversamento}
                        onChange={(e) =>
                          handleTypologyChange(
                            typology.id,
                            'attraversamento',
                            e.target.value
                          )
                        }
                        className="table-select"
                      >
                        {ATTRAVERSAMENTO_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
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
        </form>
      </div>
    </div>
  );
};

export default ProjectForm;
