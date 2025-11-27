import React, { useState } from 'react';
import { Project, Typology, User, createProject, updateProject } from '../db';
import './ProjectForm.css';

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
  const [interventionMode, setInterventionMode] = useState<'room' | 'intervento'>(
    project?.interventionMode || 'room'
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
      const floorsArray = floorsInput
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f !== '');

      if (project) {
        // Update existing project
        await updateProject(project.id, {
          title,
          client,
          address,
          notes,
          floors: floorsArray,
          interventionMode,
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
          interventionMode,
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
        <h1 className="form-title">{project ? 'Edit Project' : 'Create Project'}</h1>

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
            <label className="section-label">Title</label>
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
              Upload floor plan
            </button>
            <div className="floors-input-group">
              <label className="field-label">Floors</label>
              <input
                type="text"
                value={floorsInput}
                onChange={(e) => setFloorsInput(e.target.value)}
                placeholder="-1, 0, 1, 2, 3..."
                className="form-input floors-input"
              />
            </div>
          </section>

          {/* Numerazione interventi Section */}
          <section className="form-section">
            <label className="section-label">Numerazione interventi</label>
            <div className="radio-group">
              <label className="radio-label">
                <input
                  type="radio"
                  name="interventionMode"
                  value="room"
                  checked={interventionMode === 'room'}
                  onChange={() => setInterventionMode('room')}
                  className="radio-input"
                />
                <span className="radio-text">Room</span>
              </label>
              <label className="radio-label">
                <input
                  type="radio"
                  name="interventionMode"
                  value="intervento"
                  checked={interventionMode === 'intervento'}
                  onChange={() => setInterventionMode('intervento')}
                  className="radio-input"
                />
                <span className="radio-text">Intervention N...</span>
              </label>
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
                  <div className="table-cell">Number</div>
                  <div className="table-cell">Support</div>
                  <div className="table-cell">Materials</div>
                  <div className="table-cell">Crossing</div>
                </div>

                {typologies.map((typology) => (
                  <div key={typology.id} className="table-row">
                    <div className="table-cell">
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
                        className="table-input"
                        min="1"
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
                        <option value=""></option>
                        <option value="brick">Brick</option>
                        <option value="concrete">Concrete</option>
                        <option value="wood">Wood</option>
                        <option value="steel">Steel</option>
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
                        <option value=""></option>
                        <option value="plastic">Plastic</option>
                        <option value="metal">Metal</option>
                        <option value="fiber">Fiber</option>
                        <option value="composite">Composite</option>
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
                        <option value=""></option>
                        <option value="horizontal">Horizontal</option>
                        <option value="vertical">Vertical</option>
                        <option value="diagonal">Diagonal</option>
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
