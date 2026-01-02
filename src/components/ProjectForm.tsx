import React, { useState, useEffect } from 'react';
import { Project, Typology, User, createProject, updateProject, archiveProject, unarchiveProject, getAllUsers, FloorPlan, createFloorPlan, getFloorPlansByProject, deleteFloorPlan, getFloorPlanBlobUrl, hasFloorPlan } from '../db';
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

  // Admin-only: User sharing
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    project?.accessibleUsers || [currentUser.id]
  );
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  // Floor Plans state
  const [floorPlans, setFloorPlans] = useState<Map<string, FloorPlan>>(new Map());
  const [loadingFloorPlans, setLoadingFloorPlans] = useState(false);

  // Load all users if current user is admin
  useEffect(() => {
    const loadUsers = async () => {
      if (currentUser.role === 'admin') {
        console.log('👑 Current user is admin, loading all users for sharing...');
        console.log('👤 Current user details:', {
          id: currentUser.id,
          email: currentUser.email,
          role: currentUser.role
        });

        setIsLoadingUsers(true);
        try {
          const users = await getAllUsers();
          setAllUsers(users);
          console.log(`✅ Loaded ${users.length} users for sharing`);

          if (users.length === 0) {
            console.warn('⚠️  No users loaded! Check:');
            console.warn('   1. Supabase RLS policies allow admin to view profiles');
            console.warn('   2. Admin user has role="admin" in profiles table');
            console.warn('   3. There are other users in the profiles table');
            console.warn('   See browser console for detailed error messages');
          }
        } catch (err) {
          console.error('❌ Failed to load users:', err);
          setError('Failed to load users. Check console for details.');
        } finally {
          setIsLoadingUsers(false);
        }
      } else {
        console.log('👤 Current user is not admin, skipping user list load');
      }
    };

    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.role]);

  // Load floor plans for existing project
  useEffect(() => {
    if (project?.id) {
      loadFloorPlans();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const loadFloorPlans = async () => {
    if (!project) return;

    setLoadingFloorPlans(true);
    try {
      const plans = await getFloorPlansByProject(project.id);
      const planMap = new Map<string, FloorPlan>();
      plans.forEach(plan => {
        planMap.set(plan.floor, plan);
      });
      setFloorPlans(planMap);
    } catch (error) {
      console.error('Error loading floor plans:', error);
    } finally {
      setLoadingFloorPlans(false);
    }
  };

  const handleFloorPlanUpload = async (floor: string, file: File) => {
    if (!project) return;

    try {
      // Check if floor plan already exists
      const existing = await hasFloorPlan(project.id, floor);
      if (existing) {
        if (!window.confirm('Esiste già una planimetria per questo piano. Sostituire?')) {
          return;
        }
        // Delete existing
        const existingPlan = floorPlans.get(floor);
        if (existingPlan) {
          await deleteFloorPlan(existingPlan.id);
        }
      }

      // Create new floor plan
      const floorPlan = await createFloorPlan(
        project.id,
        floor,
        file,
        currentUser.id
      );

      // Update state
      setFloorPlans(prev => {
        const newMap = new Map(prev);
        newMap.set(floor, floorPlan);
        return newMap;
      });

      alert('Planimetria caricata con successo!');
    } catch (error) {
      console.error('Error uploading floor plan:', error);
      alert('Errore nel caricamento della planimetria');
    }
  };

  const handleFloorPlanDelete = async (floor: string) => {
    const floorPlan = floorPlans.get(floor);
    if (!floorPlan) return;

    if (!window.confirm('Sei sicuro di voler eliminare questa planimetria?')) {
      return;
    }

    try {
      await deleteFloorPlan(floorPlan.id);

      // Update state
      setFloorPlans(prev => {
        const newMap = new Map(prev);
        newMap.delete(floor);
        return newMap;
      });

      alert('Planimetria eliminata');
    } catch (error) {
      console.error('Error deleting floor plan:', error);
      alert('Errore nell\'eliminazione della planimetria');
    }
  };

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

  const handleUserToggle = (userId: string) => {
    if (selectedUserIds.includes(userId)) {
      // Don't allow removing the owner
      if (userId === (project?.ownerId || currentUser.id)) {
        return;
      }
      setSelectedUserIds(selectedUserIds.filter(id => id !== userId));
    } else {
      setSelectedUserIds([...selectedUserIds, userId]);
    }
  };

  const handleSelectAllUsers = () => {
    setSelectedUserIds(allUsers.map(u => u.id));
  };

  const handleDeselectAllUsers = () => {
    // Keep only the owner
    const ownerId = project?.ownerId || currentUser.id;
    setSelectedUserIds([ownerId]);
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

      // Sort typologies by number before saving
      const sortedTypologies = showTipologici
        ? [...typologies].sort((a, b) => a.number - b.number)
        : (project?.typologies || []);

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
          typologies: sortedTypologies,
          accessibleUsers: currentUser.role === 'admin' ? selectedUserIds : project.accessibleUsers,
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
          typologies: showTipologici ? sortedTypologies : [],
          ownerId: currentUser.id,
          accessibleUsers: currentUser.role === 'admin' ? selectedUserIds : [currentUser.id],
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

          {/* Admin-only: Share Project Section */}
          {currentUser.role === 'admin' && (
            <section className="form-section">
              <label className="section-label">
                Condividi Progetto
                <span className="label-badge">ADMIN</span>
              </label>
              {isLoadingUsers ? (
                <div className="loading-users">Caricamento utenti...</div>
              ) : (
                <>
                  <div className="user-select-actions">
                    <button
                      type="button"
                      className="select-action-btn"
                      onClick={handleSelectAllUsers}
                    >
                      Seleziona Tutti
                    </button>
                    <button
                      type="button"
                      className="select-action-btn"
                      onClick={handleDeselectAllUsers}
                    >
                      Deseleziona Tutti
                    </button>
                    <span className="selected-count">
                      {selectedUserIds.length} di {allUsers.length} selezionati
                    </span>
                  </div>
                  <div className="user-select-list">
                    {allUsers.map((user) => {
                      const isOwner = user.id === (project?.ownerId || currentUser.id);
                      const isSelected = selectedUserIds.includes(user.id);

                      return (
                        <label
                          key={user.id}
                          className={`user-select-item ${isSelected ? 'selected' : ''} ${isOwner ? 'owner' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleUserToggle(user.id)}
                            disabled={isOwner}
                            className="user-checkbox"
                          />
                          <div className="user-info">
                            <span className="user-email">{user.email}</span>
                            <span className="user-meta">
                              {user.role === 'admin' && <span className="user-badge admin">Admin</span>}
                              {isOwner && <span className="user-badge owner">Proprietario</span>}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {allUsers.length === 0 && (
                    <div className="no-users-message">
                      Nessun utente disponibile
                    </div>
                  )}
                </>
              )}
            </section>
          )}

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

                {[...typologies].sort((a, b) => a.number - b.number).map((typology) => (
                  <div key={typology.id} className="table-row">
                    <div className="table-row-mobile-first">
                      <div className="table-cell table-cell-number">
                        <input
                          type="number"
                          value={typology.number}
                          onChange={(e) =>
                            handleTypologyChange(typology.id, 'number', parseInt(e.target.value) || 1)
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
                      {typology.attraversamento === 'Altro' && (
                        <input
                          type="text"
                          value={typology.attraversamentoCustom || ''}
                          onChange={(e) =>
                            handleTypologyChange(typology.id, 'attraversamentoCustom', e.target.value)
                          }
                          className="table-input"
                          placeholder="Specifica tipo..."
                          style={{ marginTop: '4px' }}
                        />
                      )}
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

          {/* Floor Plans Section */}
          {project && (
            <section className="form-section">
              <label className="section-label">Planimetrie</label>

              {project?.floors && project.floors.length > 0 ? (
                <div className="floor-plans-list">
                  {loadingFloorPlans ? (
                    <p className="form-note">Caricamento planimetrie...</p>
                  ) : (
                    [...project.floors].sort((a, b) => parseFloat(a) - parseFloat(b)).map(floor => {
                      const floorPlan = floorPlans.get(floor);

                      return (
                        <div key={floor} className="floor-plan-item">
                          <div className="floor-plan-info">
                            <span className="floor-label">Piano {floor}</span>
                            {floorPlan && (
                              <span className="floor-plan-status">✓ Planimetria caricata</span>
                            )}
                          </div>

                          <div className="floor-plan-actions">
                            {floorPlan ? (
                              <>
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => {
                                    if (!floorPlan.imageBlob) {
                                      alert('Immagine planimetria non disponibile. Prova a sincronizzare il progetto.');
                                      return;
                                    }
                                    const url = getFloorPlanBlobUrl(floorPlan.imageBlob);
                                    window.open(url, '_blank');
                                  }}
                                >
                                  Visualizza
                                </button>
                                <button
                                  type="button"
                                  className="btn-danger"
                                  onClick={() => handleFloorPlanDelete(floor)}
                                >
                                  Elimina
                                </button>
                              </>
                            ) : (
                              <label className="btn-primary">
                                Aggiungi Planimetria
                                <input
                                  type="file"
                                  accept="application/pdf,image/*"
                                  style={{ display: 'none' }}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      handleFloorPlanUpload(floor, file);
                                      e.target.value = ''; // Reset input
                                    }
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <p className="form-note">
                  Configura i piani sopra per caricare le planimetrie
                </p>
              )}
            </section>
          )}

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
