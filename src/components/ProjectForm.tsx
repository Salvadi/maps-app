import React, { useState, useEffect } from 'react';
import { ArrowLeft, RefreshCw, Plus, Trash2, Upload, Eye, Check } from 'lucide-react';
import { Project, Typology, User, createProject, updateProject, archiveProject, unarchiveProject, getAllUsers, FloorPlan, createFloorPlan, getFloorPlansByProject, deleteFloorPlan, getFloorPlanBlobUrl, hasFloorPlan, getMappingEntriesForProject, updateMappingEntry } from '../db';
import { updateFloorPlanLabelsForMapping } from '../db/floorPlans';
import ProductSelector from './ProductSelector';
import { useDropdownOptions, useBrandOptions } from '../hooks/useDropdownOptions';
import { validateFileSignature } from '../utils/validation';

/**
 * ProjectForm
 * Componente per la creazione e modifica di un progetto (cantiere).
 * Gestisce i dati anagrafici, i tipologici, le planimetrie e gli accessi utente.
 */

// ============================================
// SEZIONE: Interfacce e stato
// Tipi per le props, lo stato del form e le strutture dei tipologici.
// ============================================

interface ProjectFormProps {
  project: Project | null;
  currentUser: User;
  onSave: () => void;
  onCancel: () => void;
  onSync?: () => void;
  isSyncing?: boolean;
}

const ProjectForm: React.FC<ProjectFormProps> = ({ project, currentUser, onSave, onCancel, onSync, isSyncing }) => {
  const SUPPORTO_OPTIONS = useDropdownOptions('supporto');
  const TIPO_SUPPORTO_OPTIONS = useDropdownOptions('tipo_supporto');
  const ATTRAVERSAMENTO_OPTIONS = useDropdownOptions('attraversamento');
  const MARCA_PRODOTTO_OPTIONS = useBrandOptions();

  const [title, setTitle] = useState(project?.title || '');
  const [client, setClient] = useState(project?.client || '');
  const [address, setAddress] = useState(project?.address || '');
  const [notes, setNotes] = useState(project?.notes || '');
  const [floorsInput, setFloorsInput] = useState(
    project?.floors.join(', ') || '-1, 0, 1, 2, 3'
  );
  const [floorsEnabled, setFloorsEnabled] = useState(
    project?.floors
      ? project.floors.length > 1 || project.floors[0] !== '0'
      : false
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

  // ============================================
  // SEZIONE: Gestione planimetrie
  // Funzioni per caricare, eliminare e gestire le planimetrie del progetto.
  // ============================================

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

    // Validate file signature (magic bytes)
    const { valid } = await validateFileSignature(file);
    if (!valid) {
      alert('Formato file non valido. Sono accettati solo immagini (JPEG, PNG, WebP) e PDF.');
      return;
    }

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

  // ============================================
  // SEZIONE: Gestione tipologici
  // Funzioni per aggiungere, modificare ed eliminare i tipologici del progetto.
  // ============================================

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

  // ============================================
  // SEZIONE: Gestione accessi utente
  // Funzioni per aggiungere e rimuovere utenti con accesso al progetto.
  // ============================================

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

  const cascadeTypologyChangesToMappings = async (
    projectId: string,
    oldTypologies: Typology[],
    newTypologies: Typology[],
    userId: string
  ) => {
    // Find typologies that were modified (same id but different fields)
    const modifiedTypologies: Array<{ old: Typology; new_: Typology }> = [];
    for (const newTyp of newTypologies) {
      const oldTyp = oldTypologies.find(t => t.id === newTyp.id);
      if (oldTyp && (
        oldTyp.supporto !== newTyp.supporto ||
        oldTyp.tipoSupporto !== newTyp.tipoSupporto ||
        oldTyp.attraversamento !== newTyp.attraversamento ||
        oldTyp.attraversamentoCustom !== newTyp.attraversamentoCustom
      )) {
        modifiedTypologies.push({ old: oldTyp, new_: newTyp });
      }
    }

    if (modifiedTypologies.length === 0) return;

    // Get all mapping entries for this project
    const mappings = await getMappingEntriesForProject(projectId);
    if (mappings.length === 0) return;

    // For each modified typology, find affected mappings
    for (const { new_: modifiedTyp } of modifiedTypologies) {
      const affectedMappings = mappings.filter(m =>
        m.crossings.some(c => c.tipologicoId === modifiedTyp.id)
      );

      if (affectedMappings.length === 0) continue;

      const shouldUpdate = window.confirm(
        `Hai modificato il tipologico N. ${modifiedTyp.number}. Ci sono ${affectedMappings.length} mappature che lo usano.\nVuoi aggiornare anche le mappature esistenti con i nuovi dati del tipologico?`
      );

      if (!shouldUpdate) continue;

      for (const mapping of affectedMappings) {
        const updatedCrossings = mapping.crossings.map(c => {
          if (c.tipologicoId === modifiedTyp.id) {
            return {
              ...c,
              supporto: modifiedTyp.supporto,
              tipoSupporto: modifiedTyp.tipoSupporto,
              attraversamento: modifiedTyp.attraversamento,
              attraversamentoCustom: modifiedTyp.attraversamentoCustom,
            };
          }
          return c;
        });

        await updateMappingEntry(mapping.id, { crossings: updatedCrossings }, userId);

        // Update floor plan labels
        try {
          await updateFloorPlanLabelsForMapping(mapping.id, () => {
            // Generate simple label - the full label will be regenerated when MappingView opens
            const tipNumbers = updatedCrossings
              .map(c => {
                if (c.tipologicoId) {
                  const tip = newTypologies.find(t => t.id === c.tipologicoId);
                  return tip ? tip.number : null;
                }
                return null;
              })
              .filter((n): n is number => n !== null)
              .filter((v, i, a) => a.indexOf(v) === i)
              .sort((a, b) => a - b)
              .join(' - ');
            const tipLine = tipNumbers ? `tip. ${tipNumbers}` : '';
            return [mapping.id.substring(0, 8), tipLine].filter(Boolean);
          });
        } catch (labelErr) {
          console.warn('Failed to update labels for mapping:', mapping.id, labelErr);
        }
      }

      console.log(`Updated ${affectedMappings.length} mappings for typology ${modifiedTyp.number}`);
    }
  };

  // ============================================
  // SEZIONE: Salvataggio e submit
  // Validazione del form e salvataggio del progetto su IndexedDB con sync.
  // ============================================

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
        // Detect modified typologies before saving
        const oldTypologies = project.typologies || [];

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

        // Check if any typologies were modified and cascade to existing mappings
        if (showTipologici) {
          await cascadeTypologyChangesToMappings(project.id, oldTypologies, sortedTypologies, currentUser.id);
        }
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

  // ============================================
  // SEZIONE: Render form
  // JSX del form con sezioni: info progetto, tipologici, planimetrie e accessi.
  // ============================================

  const inputCls = 'w-full px-4 py-3 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-800 placeholder-brand-400 focus:outline-none focus:border-accent';
  const selectCls = 'w-full px-3 py-2.5 bg-brand-50 border border-brand-200 rounded-xl text-xs text-brand-800 focus:outline-none focus:border-accent';

  const Toggle: React.FC<{ value: boolean; onChange: () => void }> = ({ value, onChange }) => (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${value ? 'bg-accent' : 'bg-brand-200'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );

  return (
    <div className="flex flex-col h-full bg-brand-100">
      {/* Header */}
      <div className="bg-white shadow-card z-10 flex-shrink-0 flex items-center gap-3 px-4 py-4">
        <button
          onClick={onCancel}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-brand-600 hover:bg-brand-50 active:bg-brand-100"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="flex-1 text-lg font-bold text-brand-800">
          {project ? 'Modifica Cantiere' : 'Nuovo Cantiere'}
        </h1>
        {onSync && (
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-brand-500 hover:bg-brand-50 disabled:opacity-50"
          >
            <RefreshCw size={18} className={isSyncing ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* Scrollable form */}
      <form id="project-form" onSubmit={handleSubmit} className="flex-1 overflow-auto">
        <div className="px-4 py-4 space-y-4 pb-6">

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          {/* Nome Cantiere */}
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-100">
              <h2 className="text-sm font-semibold text-brand-700">Nome Cantiere</h2>
            </div>
            <div className="px-4 py-4">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nome del cantiere"
                required
                className={inputCls}
              />
            </div>
          </div>

          {/* Anagrafica */}
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-100">
              <h2 className="text-sm font-semibold text-brand-700">Anagrafica</h2>
            </div>
            <div className="px-4 py-4 space-y-3">
              <input type="text" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Cliente" className={inputCls} />
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Indirizzo" className={inputCls} />
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note" rows={3} className={`${inputCls} resize-none`} />
            </div>
          </div>

          {/* Admin: Condividi Progetto */}
          {currentUser.role === 'admin' && (
            <div className="bg-white rounded-2xl shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-brand-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-brand-700">Condividi Progetto</h2>
                <span className="text-[11px] font-semibold bg-warning/10 text-warning px-2 py-0.5 rounded-full">ADMIN</span>
              </div>
              {isLoadingUsers ? (
                <div className="px-4 py-6 text-center text-brand-500 text-sm">Caricamento utenti...</div>
              ) : (
                <>
                  <div className="px-4 py-2.5 border-b border-brand-100 flex items-center gap-3">
                    <button type="button" onClick={handleSelectAllUsers} className="text-xs font-semibold text-accent">Seleziona tutti</button>
                    <span className="text-brand-300">·</span>
                    <button type="button" onClick={handleDeselectAllUsers} className="text-xs font-semibold text-brand-500">Deseleziona tutti</button>
                    <span className="ml-auto text-xs text-brand-500">{selectedUserIds.length} / {allUsers.length}</span>
                  </div>
                  <div className="divide-y divide-brand-100">
                    {allUsers.length === 0 ? (
                      <div className="px-4 py-6 text-center text-brand-500 text-sm">Nessun utente disponibile</div>
                    ) : allUsers.map(user => {
                      const isOwner = user.id === (project?.ownerId || currentUser.id);
                      const isSelected = selectedUserIds.includes(user.id);
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => handleUserToggle(user.id)}
                          disabled={isOwner}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50 active:bg-brand-100 transition-colors disabled:opacity-60 text-left"
                        >
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-accent border-accent' : 'border-brand-300'}`}>
                            {isSelected && <Check size={11} className="text-white" />}
                          </div>
                          <span className="flex-1 text-sm text-brand-700 truncate">{user.email}</span>
                          <div className="flex gap-1.5">
                            {user.role === 'admin' && <span className="text-[10px] font-semibold bg-warning/10 text-warning px-1.5 py-0.5 rounded-full">Admin</span>}
                            {isOwner && <span className="text-[10px] font-semibold bg-brand-100 text-brand-500 px-1.5 py-0.5 rounded-full">Owner</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Struttura */}
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-100">
              <h2 className="text-sm font-semibold text-brand-700">Struttura</h2>
            </div>
            <div className="px-4 py-4 space-y-3">
<div className="flex items-center justify-between">
                <span className="text-sm text-brand-700">Piani multipli</span>
                <Toggle value={floorsEnabled} onChange={() => setFloorsEnabled(!floorsEnabled)} />
              </div>
              {floorsEnabled && (
                <input type="text" value={floorsInput} onChange={(e) => setFloorsInput(e.target.value)} placeholder="-1, 0, 1, 2, 3..." className={inputCls} />
              )}
            </div>
          </div>

          {/* Numerazione interventi */}
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-100">
              <h2 className="text-sm font-semibold text-brand-700">Numerazione interventi</h2>
            </div>
            <div className="divide-y divide-brand-100">
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-sm text-brand-700">Stanza</span>
                <Toggle value={useRoomNumbering} onChange={() => setUseRoomNumbering(!useRoomNumbering)} />
              </div>
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-sm text-brand-700">Intervento n.</span>
                <Toggle value={useInterventionNumbering} onChange={() => setUseInterventionNumbering(!useInterventionNumbering)} />
              </div>
            </div>
          </div>

          {/* Tipologici */}
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-brand-700">Tipologici</h2>
              <button type="button" onClick={() => setShowTipologici(!showTipologici)} className="text-xs font-semibold text-accent">
                {showTipologici ? 'Nascondi' : 'Mostra'}
              </button>
            </div>

            {!showTipologici && (
              <div className="px-4 py-3 text-sm text-brand-500">
                {typologies.length} tipologic{typologies.length === 1 ? 'o' : 'i'} configurati
              </div>
            )}

            {showTipologici && (
              <div className="divide-y divide-brand-100">
                {[...typologies].sort((a, b) => a.number - b.number).map(typology => (
                  <div key={typology.id} className="px-4 py-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">N.</span>
                        <input
                          type="number"
                          value={typology.number}
                          onChange={(e) => handleTypologyChange(typology.id, 'number', parseInt(e.target.value) || 1)}
                          className="w-14 px-2 py-1.5 bg-brand-50 border border-brand-200 rounded-xl text-sm text-brand-800 text-center focus:outline-none focus:border-accent"
                          min="1" max="999"
                        />
                      </div>
                      {typologies.length > 1 && (
                        <button type="button" onClick={() => handleRemoveTypology(typology.id)} className="w-8 h-8 flex items-center justify-center text-danger hover:bg-red-50 rounded-xl">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-medium text-brand-500 mb-1 block">Supporto</label>
                        <select value={typology.supporto} onChange={(e) => handleTypologyChange(typology.id, 'supporto', e.target.value)} className={selectCls}>
                          {SUPPORTO_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-brand-500 mb-1 block">Tipo Supporto</label>
                        <select value={typology.tipoSupporto} onChange={(e) => handleTypologyChange(typology.id, 'tipoSupporto', e.target.value)} className={selectCls}>
                          {TIPO_SUPPORTO_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-brand-500 mb-1 block">Attraversamento</label>
                      <select value={typology.attraversamento} onChange={(e) => handleTypologyChange(typology.id, 'attraversamento', e.target.value)} className={selectCls}>
                        {ATTRAVERSAMENTO_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                      {typology.attraversamento === 'Altro' && (
                        <input type="text" value={typology.attraversamentoCustom || ''} onChange={(e) => handleTypologyChange(typology.id, 'attraversamentoCustom', e.target.value)} placeholder="Specifica tipo..." className={`${selectCls} mt-2`} />
                      )}
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-brand-500 mb-1 block">Marca prodotto</label>
                      <select value={typology.marcaProdottoUtilizzato} onChange={(e) => handleTypologyChange(typology.id, 'marcaProdottoUtilizzato', e.target.value)} className={selectCls}>
                        {MARCA_PRODOTTO_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-brand-500 mb-1 block">Materiali</label>
                      <ProductSelector
                        marca={typology.marcaProdottoUtilizzato}
                        selectedProducts={typology.prodottiSelezionati}
                        onChange={(products) => handleTypologyChange(typology.id, 'prodottiSelezionati', products)}
                      />
                    </div>
                  </div>
                ))}
                <div className="px-4 py-3">
                  <button type="button" onClick={handleAddTypology} className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-brand-300 rounded-xl text-sm font-medium text-brand-500 hover:border-accent hover:text-accent transition-colors">
                    <Plus size={16} /> Aggiungi tipologico
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Planimetrie (existing project) */}
          {project && (
            <div className="bg-white rounded-2xl shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-brand-100">
                <h2 className="text-sm font-semibold text-brand-700">Planimetrie</h2>
              </div>
              {project.floors && project.floors.length > 0 ? (
                <div className="divide-y divide-brand-100">
                  {loadingFloorPlans ? (
                    <div className="px-4 py-6 text-center text-brand-500 text-sm">Caricamento...</div>
                  ) : (
                    [...project.floors].sort((a, b) => parseFloat(a) - parseFloat(b)).map(floor => {
                      const floorPlan = floorPlans.get(floor);
                      return (
                        <div key={floor} className="flex items-center gap-3 px-4 py-3.5">
                          <div className="flex-1">
                            <span className="text-sm font-medium text-brand-700">Piano {floor}</span>
                            {floorPlan && <span className="ml-2 text-[11px] text-success font-medium">✓ caricata</span>}
                          </div>
                          <div className="flex gap-2">
                            {floorPlan ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = getFloorPlanBlobUrl(floorPlan.imageBlob, floorPlan.imageUrl);
                                    if (!url) { alert('Immagine non disponibile.'); return; }
                                    window.open(url, '_blank');
                                  }}
                                  className="flex items-center gap-1 px-3 py-1.5 bg-brand-100 text-brand-700 rounded-xl text-xs font-medium"
                                >
                                  <Eye size={13} /> Visualizza
                                </button>
                                <button type="button" onClick={() => handleFloorPlanDelete(floor)} className="w-8 h-8 flex items-center justify-center bg-red-50 text-danger rounded-xl">
                                  <Trash2 size={14} />
                                </button>
                              </>
                            ) : (
                              <label className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded-xl text-xs font-medium cursor-pointer">
                                <Upload size={13} /> Aggiungi
                                <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleFloorPlanUpload(floor, f); e.target.value = ''; } }} />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="px-4 py-6 text-center text-brand-500 text-sm">
                  Configura i piani per caricare le planimetrie
                </div>
              )}
            </div>
          )}

          {/* Archive / Unarchive */}
          {project && (
            <div className="bg-white rounded-2xl shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-brand-100">
                <h2 className="text-sm font-semibold text-brand-700">Zona pericolosa</h2>
              </div>
              <div className="px-4 py-4">
                {project.archived === 1 ? (
                  <button type="button" onClick={handleUnarchive} disabled={isSubmitting} className="w-full py-3 bg-success/10 text-success rounded-xl text-sm font-semibold disabled:opacity-50">
                    Riapri progetto
                  </button>
                ) : (
                  <button type="button" onClick={handleArchive} disabled={isSubmitting} className="w-full py-3 bg-warning/10 text-warning rounded-xl text-sm font-semibold disabled:opacity-50">
                    Archivia progetto
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </form>

      {/* Fixed bottom action bar */}
      <div className="flex-shrink-0 bg-white border-t border-brand-200 px-4 py-4 flex gap-3">
        <button type="button" onClick={onCancel} disabled={isSubmitting} className="flex-1 py-3 rounded-2xl border border-brand-200 text-brand-700 text-sm font-semibold disabled:opacity-50">
          Annulla
        </button>
        <button type="submit" form="project-form" disabled={isSubmitting || !title.trim()} className="flex-1 py-3 rounded-2xl bg-accent text-white text-sm font-semibold disabled:opacity-40">
          {isSubmitting ? 'Salvataggio...' : (project ? 'Salva' : 'Crea')}
        </button>
      </div>
    </div>
  );
};

export default ProjectForm;
