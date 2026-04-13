import React, { useState, useEffect, useCallback } from 'react';
import { Project, User, Sal, MappingEntry } from '../db';
import {
  getSalsForProject,
  createSal,
  updateSal,
  deleteSal,
  assignCrossingsToSal,
  getMappingEntriesForProject,
} from '../db';
import { PlusCircle, ClipboardList, Edit, Link, Trash, Check, X, Info } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';

interface SalTabProps {
  project: Project;
  currentUser: User;
}

const SalTab: React.FC<SalTabProps> = ({ project, currentUser }) => {
  const [sals, setSals] = useState<Sal[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [salCrossingsMap, setSalCrossingsMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDate, setFormDate] = useState(''); // ISO date string "YYYY-MM-DD"
  const [formNotes, setFormNotes] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const mappings = useLiveQuery(
    () => getMappingEntriesForProject(project.id),
    [project.id]
  ) || [];

  const loadData = useCallback(async () => {
    setLoading(true);
    const projectSals = await getSalsForProject(project.id);
    setSals(projectSals.sort((a, b) => (b.date || 0) - (a.date || 0)));

    const allMappings = mappings; // already filtered by project.id by useLiveQuery
    const allCrossings = allMappings.flatMap(m => m.crossings || []);
    const unassigned = allCrossings.filter(c => !c.salId).length;
    setUnassignedCount(unassigned);

    const salMap: Record<string, number> = {};
    for (const sal of projectSals) {
      salMap[sal.id] = allCrossings.filter(c => c.salId === sal.id).length;
    }
    setSalCrossingsMap(salMap);
    setLoading(false);
  }, [project.id, mappings]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setFormName('');
    setFormDate('');
    setFormNotes('');
    setEditingId(null);
    setShowForm(false);
  };

  const handleCreateOrUpdateSal = async () => {
    setSaving(true);
    const dateTimestamp = formDate ? new Date(formDate).getTime() : Date.now();
    try {
      if (editingId) {
        await updateSal(editingId, {
          name: formName,
          date: dateTimestamp,
          notes: formNotes,
        });
      } else {
        await createSal(
          project.id,
          formName || undefined,
          dateTimestamp,
          formNotes || undefined
        );
      }
      resetForm();
      await loadData();
    } catch (error) {
      console.error('Error saving SAL:', error);
      // TODO: show error message to user
    } finally {
      setSaving(false);
    }
  };

  const handleEditClick = (sal: Sal) => {
    setEditingId(sal.id);
    setFormName(sal.name || '');
    setFormDate(sal.date ? new Date(sal.date).toISOString().split('T')[0] : '');
    setFormNotes(sal.notes || '');
    setShowForm(true);
  };

  const handleDeleteSal = async (salId: string) => {
    setSaving(true);
    try {
      await deleteSal(salId, project.id, currentUser.id);
      setConfirmDeleteId(null);
      await loadData();
    } catch (error) {
      console.error('Error deleting SAL:', error);
      // TODO: show error message to user
    } finally {
      setSaving(false);
    }
  };

  const handleAssignCrossings = async (salId: string) => {
    setAssigning(salId);
    try {
      await assignCrossingsToSal(project.id, salId, currentUser.id);
      await loadData();
    } catch (error) {
      console.error('Error assigning crossings:', error);
      // TODO: show error message to user
    } finally {
      setAssigning(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <p>Caricamento SAL...</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-24 space-y-4">
      {unassignedCount > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-3 flex items-center space-x-2">
          <Info size={20} className="text-yellow-600" />
          <p className="text-sm text-yellow-800">
            {unassignedCount} crossing non contabilizzati
          </p>
        </div>
      )}

      <button
        onClick={() => {
          resetForm();
          setShowForm(true);
        }}
        className="px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium flex items-center space-x-2"
      >
        <PlusCircle size={16} />
        <span>Nuovo SAL</span>
      </button>

      {(showForm || editingId) && (
        <div className="bg-white rounded-2xl shadow-card p-4 space-y-3">
          <h3 className="text-lg font-bold">
            {editingId ? 'Modifica SAL' : 'Nuovo SAL'}
          </h3>
          <div>
            <label htmlFor="salName" className="block text-sm font-medium text-gray-700">
              Nome (opz.)
            </label>
            <input
              type="text"
              id="salName"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div>
            <label htmlFor="salDate" className="block text-sm font-medium text-gray-700">
              Data
            </label>
            <input
              type="date"
              id="salDate"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div>
            <label htmlFor="salNotes" className="block text-sm font-medium text-gray-700">
              Note (opz.)
            </label>
            <textarea
              id="salNotes"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2.5 bg-brand-50 rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/30"
            ></textarea>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={handleCreateOrUpdateSal}
              disabled={saving}
              className="px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium flex items-center space-x-2 disabled:opacity-50"
            >
              {saving ? 'Salvataggio...' : 'Salva'}
            </button>
            <button
              onClick={resetForm}
              disabled={saving}
              className="px-3 py-2 text-brand-600 hover:bg-brand-50 rounded-xl text-sm disabled:opacity-50"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {sals.length === 0 && !showForm && (
        <div className="bg-white rounded-2xl shadow-card p-4 text-center text-gray-500">
          <p>Nessun SAL creato. Premi "+ Nuovo SAL" per iniziare.</p>
        </div>
      )}

      <div className="space-y-3">
        {sals.map((sal) => (
          <div key={sal.id} className="bg-white rounded-2xl shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-brand-100 flex items-center justify-between">
              <h4 className="text-base font-bold">SAL {sal.number}</h4>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleEditClick(sal)}
                  className="px-3 py-2 text-brand-600 hover:bg-brand-50 rounded-xl text-sm flex items-center space-x-1"
                >
                  <Edit size={16} />
                  <span>Modifica</span>
                </button>
                <button
                  onClick={() => handleAssignCrossings(sal.id)}
                  disabled={unassignedCount === 0 || assigning === sal.id}
                  className="px-3 py-2 text-accent hover:bg-brand-50 rounded-xl text-sm flex items-center space-x-1 disabled:opacity-50"
                >
                  {assigning === sal.id ? (
                    'Assegnazione...'
                  ) : (
                    <>
                      <Link size={16} />
                      <span>Assegna</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setConfirmDeleteId(sal.id)}
                  className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-xl text-sm flex items-center space-x-1"
                >
                  <Trash size={16} />
                </button>
              </div>
            </div>
            <div className="p-4 space-y-2">
              {sal.name && <p className="text-sm">Nome: {sal.name}</p>}
              <p className="text-sm">
                Data:{' '}
                {sal.date
                  ? new Date(sal.date).toLocaleDateString('it-IT')
                  : 'Non specificata'}
              </p>
              <p className="text-sm">
                {salCrossingsMap[sal.id] || 0} crossing assegnati
              </p>
              {sal.notes && <p className="text-sm">Note: {sal.notes}</p>}

              {confirmDeleteId === sal.id && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                  <p className="text-sm text-red-800">
                    Eliminare SAL {sal.number}? I crossing assegnati torneranno non
                    contabilizzati.
                  </p>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleDeleteSal(sal.id)}
                      disabled={saving}
                      className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                    >
                      {saving ? 'Eliminazione...' : 'Conferma'}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={saving}
                      className="px-3 py-2 text-red-600 hover:bg-red-100 rounded-xl text-sm disabled:opacity-50"
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SalTab;
