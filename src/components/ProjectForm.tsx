import React, { useState } from 'react';
import './ProjectForm.css';

interface ProjectFormProps {
  project?: any;
  onSave: (project: any) => void;
  onCancel: () => void;
}

interface FormErrors {
  title?: string;
  anagrafica?: {
    nome?: string;
    indirizzo?: string;
    comune?: string;
    provincia?: string;
    cap?: string;
  };
  struttura?: {
    tipologia?: string;
    superficie?: string;
    piani?: string;
    pianoIntervento?: string;
    destinazioneUso?: string;
  };
  tipologici?: Array<{
    supporto?: string;
    elemento?: string;
    tipologia?: string;
    quantita?: string;
  }>;
}

const ProjectForm: React.FC<ProjectFormProps> = ({ project, onSave, onCancel }) => {
  // Title section state
  const [title, setTitle] = useState(project?.title || '');
  
  // Anagrafica section state
  const [anagrafica, setAnagrafica] = useState({
    nome: project?.anagrafica?.nome || '',
    indirizzo: project?.anagrafica?.indirizzo || '',
    comune: project?.anagrafica?.comune || '',
    provincia: project?.anagrafica?.provincia || '',
    cap: project?.anagrafica?.cap || '',
    telefono: project?.anagrafica?.telefono || '',
    email: project?.anagrafica?.email || '',
    codiceFiscale: project?.anagrafica?.codiceFiscale || '',
    partitaIVA: project?.anagrafica?.partitaIVA || ''
  });
  
  // Struttura section state
  const [struttura, setStruttura] = useState({
    tipologia: project?.struttura?.tipologia || '',
    annoCostruzione: project?.struttura?.annoCostruzione || '',
    superficie: project?.struttura?.superficie || '',
    piani: project?.struttura?.piani || '',
    pianoIntervento: project?.struttura?.pianoIntervento || '',
    destinazioneUso: project?.struttura?.destinazioneUso || '',
    allegato: project?.struttura?.allegato || null
  });
  
  // Numerazione interventi section state
  const [numerationMode, setNumerationMode] = useState<'room' | 'intervention'>(
    project?.numerationMode || 'room'
  );
  const [rooms, setRooms] = useState<any[]>(project?.rooms || [{ id: 1, name: '' }]);
  const [interventions, setInterventions] = useState<any[]>(project?.interventions || [{ id: 1, name: '' }]);
  
  // Tipologici section state
  const [tipologici, setTipologici] = useState<any[]>(project?.tipologici || [
    { id: 1, supporto: '', elemento: '', tipologia: '', quantita: '', unitaMisura: '' }
  ]);
  
  // Form errors state
  const [errors, setErrors] = useState<FormErrors>({});
  
  // Validate form
  const validateForm = () => {
    const newErrors: FormErrors = {};
    
    // Title validation
    if (!title.trim()) {
      newErrors.title = 'Il nome del progetto è obbligatorio';
    }
    
    // Anagrafica validation
    newErrors.anagrafica = {};
    if (!anagrafica.nome.trim()) {
      newErrors.anagrafica.nome = 'Il nome è obbligatorio';
    }
    if (!anagrafica.indirizzo.trim()) {
      newErrors.anagrafica.indirizzo = 'L\'indirizzo è obbligatorio';
    }
    if (!anagrafica.comune.trim()) {
      newErrors.anagrafica.comune = 'Il comune è obbligatorio';
    }
    if (!anagrafica.provincia.trim()) {
      newErrors.anagrafica.provincia = 'La provincia è obbligatoria';
    }
    if (!anagrafica.cap.trim()) {
      newErrors.anagrafica.cap = 'Il CAP è obbligatorio';
    } else if (!/^\d{5}$/.test(anagrafica.cap)) {
      newErrors.anagrafica.cap = 'Il CAP deve essere di 5 cifre';
    }
    
    // Check if there are anagrafica errors
    if (Object.keys(newErrors.anagrafica).length === 0) {
      delete newErrors.anagrafica;
    }
    
    // Struttura validation
    newErrors.struttura = {};
    if (!struttura.tipologia) {
      newErrors.struttura.tipologia = 'La tipologia è obbligatoria';
    }
    if (!struttura.superficie) {
      newErrors.struttura.superficie = 'La superficie è obbligatoria';
    } else if (parseFloat(struttura.superficie) <= 0) {
      newErrors.struttura.superficie = 'La superficie deve essere maggiore di 0';
    }
    if (!struttura.piani) {
      newErrors.struttura.piani = 'Il numero di piani è obbligatorio';
    } else if (parseInt(struttura.piani) <= 0) {
      newErrors.struttura.piani = 'Il numero di piani deve essere maggiore di 0';
    }
    if (!struttura.pianoIntervento) {
      newErrors.struttura.pianoIntervento = 'Il piano intervento è obbligatorio';
    } else if (parseInt(struttura.pianoIntervento) < 0) {
      newErrors.struttura.pianoIntervento = 'Il piano intervento non può essere negativo';
    }
    if (!struttura.destinazioneUso) {
      newErrors.struttura.destinazioneUso = 'La destinazione d\'uso è obbligatoria';
    }
    
    // Check if there are struttura errors
    if (Object.keys(newErrors.struttura).length === 0) {
      delete newErrors.struttura;
    }
    
    // Tipologici validation
    newErrors.tipologici = tipologici.map(item => {
      const itemErrors: any = {};
      if (!item.supporto) {
        itemErrors.supporto = 'Il supporto è obbligatorio';
      }
      if (!item.elemento) {
        itemErrors.elemento = 'L\'elemento è obbligatorio';
      }
      if (!item.tipologia) {
        itemErrors.tipologia = 'La tipologia è obbligatoria';
      }
      if (!item.quantita) {
        itemErrors.quantita = 'La quantità è obbligatoria';
      } else if (parseFloat(item.quantita) < 0) {
        itemErrors.quantita = 'La quantità non può essere negativa';
      }
      return itemErrors;
    });
    
    // Check if there are tipologici errors
    if (newErrors.tipologici.every(item => Object.keys(item).length === 0)) {
      delete newErrors.tipologici;
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (validateForm()) {
      const projectData = {
        title,
        anagrafica,
        struttura,
        numerationMode,
        rooms,
        interventions,
        tipologici
      };
      
      onSave(projectData);
    }
  };
  
  // Handle anagrafica changes
  const handleAnagraficaChange = (field: string, value: string) => {
    setAnagrafica(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (errors.anagrafica && errors.anagrafica[field as keyof typeof errors.anagrafica]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        if (newErrors.anagrafica) {
          delete newErrors.anagrafica[field as keyof typeof errors.anagrafica];
          if (Object.keys(newErrors.anagrafica).length === 0) {
            delete newErrors.anagrafica;
          }
        }
        return newErrors;
      });
    }
  };
  
  // Handle struttura changes
  const handleStrutturaChange = (field: string, value: string) => {
    setStruttura(prev => ({
      ...prev,
      [field]: value
    }));
    
    // Clear error when user starts typing
    if (errors.struttura && errors.struttura[field as keyof typeof errors.struttura]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        if (newErrors.struttura) {
          delete newErrors.struttura[field as keyof typeof errors.struttura];
          if (Object.keys(newErrors.struttura).length === 0) {
            delete newErrors.struttura;
          }
        }
        return newErrors;
      });
    }
  };
  
  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setStruttura(prev => ({
        ...prev,
        allegato: file.name
      }));
    }
  };
  
  // Handle room changes
  const handleRoomChange = (id: number, name: string) => {
    setRooms(prev => prev.map(room => 
      room.id === id ? { ...room, name } : room
    ));
  };
  
  // Add new room
  const addRoom = () => {
    const newId = rooms.length > 0 ? Math.max(...rooms.map(r => r.id)) + 1 : 1;
    setRooms(prev => [...prev, { id: newId, name: '' }]);
  };
  
  // Remove room
  const removeRoom = (id: number) => {
    if (rooms.length > 1) {
      setRooms(prev => prev.filter(room => room.id !== id));
    }
  };
  
  // Handle intervention changes
  const handleInterventionChange = (id: number, name: string) => {
    setInterventions(prev => prev.map(intervention => 
      intervention.id === id ? { ...intervention, name } : intervention
    ));
  };
  
  // Add new intervention
  const addIntervention = () => {
    const newId = interventions.length > 0 ? Math.max(...interventions.map(i => i.id)) + 1 : 1;
    setInterventions(prev => [...prev, { id: newId, name: '' }]);
  };
  
  // Remove intervention
  const removeIntervention = (id: number) => {
    if (interventions.length > 1) {
      setInterventions(prev => prev.filter(intervention => intervention.id !== id));
    }
  };
  
  // Handle tipologici changes
  const handleTipologiciChange = (id: number, field: string, value: string) => {
    setTipologici(prev => prev.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
    
    // Clear error when user starts typing
    if (errors.tipologici) {
      const itemIndex = tipologici.findIndex(item => item.id === id);
      if (itemIndex !== -1 && errors.tipologici[itemIndex] && errors.tipologici[itemIndex][field as keyof typeof errors.tipologici[0]]) {
        setErrors(prev => {
          const newErrors = { ...prev };
          if (newErrors.tipologici && newErrors.tipologici[itemIndex]) {
            delete newErrors.tipologici[itemIndex][field as keyof typeof errors.tipologici[0]];
            if (Object.keys(newErrors.tipologici[itemIndex]).length === 0) {
              delete newErrors.tipologici[itemIndex];
              if (newErrors.tipologici.every(item => Object.keys(item).length === 0)) {
                delete newErrors.tipologici;
              }
            }
          }
          return newErrors;
        });
      }
    }
  };
  
  // Add new tipologici row
  const addTipologiciRow = () => {
    const newId = tipologici.length > 0 ? Math.max(...tipologici.map(t => t.id)) + 1 : 1;
    setTipologici(prev => [...prev, { 
      id: newId, 
      supporto: '', 
      elemento: '', 
      tipologia: '', 
      quantita: '', 
      unitaMisura: '' 
    }]);
    
    // Add empty error object for the new row
    if (errors.tipologici) {
      setErrors(prev => ({
        ...prev,
        tipologici: [...(prev.tipologici || []), {}]
      }));
    }
  };
  
  // Remove tipologici row
  const removeTipologiciRow = (id: number) => {
    if (tipologici.length > 1) {
      const itemIndex = tipologici.findIndex(item => item.id === id);
      setTipologici(prev => prev.filter(item => item.id !== id));
      
      // Remove error object for the deleted row
      if (errors.tipologici && itemIndex !== -1) {
        setErrors(prev => {
          const newErrors = { ...prev };
          if (newErrors.tipologici) {
            newErrors.tipologici.splice(itemIndex, 1);
            if (newErrors.tipologici.every(item => Object.keys(item).length === 0)) {
              delete newErrors.tipologici;
            }
          }
          return newErrors;
        });
      }
    }
  };

  return (
    <div className="project-form-container">
      <form onSubmit={handleSubmit}>
        <div className="form-header">
          <h2>{project ? 'Modifica Progetto' : 'Nuovo Progetto'}</h2>
          <div className="form-actions">
            <button type="button" onClick={onCancel} className="cancel-button">
              Annulla
            </button>
            <button type="submit" className="save-button">
              Salva
            </button>
          </div>
        </div>

        {/* Title Section */}
        <div className="form-section">
          <h3>Titolo</h3>
          <div className="form-group">
            <label htmlFor="title">Nome Progetto *</label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            {errors.title && <div className="error-message">{errors.title}</div>}
          </div>
        </div>

        {/* Anagrafica Section */}
        <div className="form-section">
          <h3>Anagrafica</h3>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="nome">Nome e Cognome / Ragione Sociale *</label>
              <input
                type="text"
                id="nome"
                value={anagrafica.nome}
                onChange={(e) => handleAnagraficaChange('nome', e.target.value)}
                required
              />
              {errors.anagrafica?.nome && <div className="error-message">{errors.anagrafica.nome}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="indirizzo">Indirizzo *</label>
              <input
                type="text"
                id="indirizzo"
                value={anagrafica.indirizzo}
                onChange={(e) => handleAnagraficaChange('indirizzo', e.target.value)}
                required
              />
              {errors.anagrafica?.indirizzo && <div className="error-message">{errors.anagrafica.indirizzo}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="comune">Comune *</label>
              <input
                type="text"
                id="comune"
                value={anagrafica.comune}
                onChange={(e) => handleAnagraficaChange('comune', e.target.value)}
                required
              />
              {errors.anagrafica?.comune && <div className="error-message">{errors.anagrafica.comune}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="provincia">Provincia *</label>
              <input
                type="text"
                id="provincia"
                value={anagrafica.provincia}
                onChange={(e) => handleAnagraficaChange('provincia', e.target.value)}
                required
              />
              {errors.anagrafica?.provincia && <div className="error-message">{errors.anagrafica.provincia}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="cap">CAP *</label>
              <input
                type="text"
                id="cap"
                value={anagrafica.cap}
                onChange={(e) => handleAnagraficaChange('cap', e.target.value)}
                required
              />
              {errors.anagrafica?.cap && <div className="error-message">{errors.anagrafica.cap}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="telefono">Telefono</label>
              <input
                type="text"
                id="telefono"
                value={anagrafica.telefono}
                onChange={(e) => handleAnagraficaChange('telefono', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                value={anagrafica.email}
                onChange={(e) => handleAnagraficaChange('email', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="codiceFiscale">Codice Fiscale</label>
              <input
                type="text"
                id="codiceFiscale"
                value={anagrafica.codiceFiscale}
                onChange={(e) => handleAnagraficaChange('codiceFiscale', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="partitaIVA">Partita IVA</label>
              <input
                type="text"
                id="partitaIVA"
                value={anagrafica.partitaIVA}
                onChange={(e) => handleAnagraficaChange('partitaIVA', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Struttura Section */}
        <div className="form-section">
          <h3>Struttura</h3>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="tipologia">Tipologia *</label>
              <select
                id="tipologia"
                value={struttura.tipologia}
                onChange={(e) => handleStrutturaChange('tipologia', e.target.value)}
                required
              >
                <option value="">Seleziona una tipologia</option>
                <option value="abitativa">Abitativa</option>
                <option value="commerciale">Commerciale</option>
                <option value="industriale">Industriale</option>
                <option value="uffici">Uffici</option>
              </select>
              {errors.struttura?.tipologia && <div className="error-message">{errors.struttura.tipologia}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="annoCostruzione">Anno Costruzione</label>
              <input
                type="number"
                id="annoCostruzione"
                value={struttura.annoCostruzione}
                onChange={(e) => handleStrutturaChange('annoCostruzione', e.target.value)}
                min="1800"
                max={new Date().getFullYear()}
              />
            </div>
            <div className="form-group">
              <label htmlFor="superficie">Superficie (mq) *</label>
              <input
                type="number"
                id="superficie"
                value={struttura.superficie}
                onChange={(e) => handleStrutturaChange('superficie', e.target.value)}
                required
                min="0"
                step="0.01"
              />
              {errors.struttura?.superficie && <div className="error-message">{errors.struttura.superficie}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="piani">N. Piani *</label>
              <input
                type="number"
                id="piani"
                value={struttura.piani}
                onChange={(e) => handleStrutturaChange('piani', e.target.value)}
                required
                min="1"
              />
              {errors.struttura?.piani && <div className="error-message">{errors.struttura.piani}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="pianoIntervento">Piano Intervento *</label>
              <input
                type="number"
                id="pianoIntervento"
                value={struttura.pianoIntervento}
                onChange={(e) => handleStrutturaChange('pianoIntervento', e.target.value)}
                required
                min="0"
              />
              {errors.struttura?.pianoIntervento && <div className="error-message">{errors.struttura.pianoIntervento}</div>}
            </div>
            <div className="form-group">
              <label htmlFor="destinazioneUso">Destinazione d'Uso *</label>
              <select
                id="destinazioneUso"
                value={struttura.destinazioneUso}
                onChange={(e) => handleStrutturaChange('destinazioneUso', e.target.value)}
                required
              >
                <option value="">Seleziona una destinazione</option>
                <option value="residenziale">Residenziale</option>
                <option value="commerciale">Commerciale</option>
                <option value="industriale">Industriale</option>
                <option value="uffici">Uffici</option>
              </select>
              {errors.struttura?.destinazioneUso && <div className="error-message">{errors.struttura.destinazioneUso}</div>}
            </div>
            <div className="form-group full-width">
              <label htmlFor="allegato">Allegato</label>
              <input
                type="file"
                id="allegato"
                onChange={handleFileUpload}
              />
              {struttura.allegato && (
                <div className="file-info">
                  File selezionato: {struttura.allegato}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Numerazione Interventi Section */}
        <div className="form-section">
          <h3>Numerazione Interventi</h3>
          <div className="form-group">
            <label>Modalità di Numerazione:</label>
            <div className="toggle-group">
              <button
                type="button"
                className={`toggle-button ${numerationMode === 'room' ? 'active' : ''}`}
                onClick={() => setNumerationMode('room')}
              >
                Per Stanze
              </button>
              <button
                type="button"
                className={`toggle-button ${numerationMode === 'intervention' ? 'active' : ''}`}
                onClick={() => setNumerationMode('intervention')}
              >
                Per Intervento N...
              </button>
            </div>
          </div>

          {numerationMode === 'room' ? (
            <div className="numbering-section">
              <h4>Stanze</h4>
              {rooms.map((room) => (
                <div key={room.id} className="form-row">
                  <div className="form-group">
                    <label htmlFor={`room-${room.id}`}>Stanza {room.id}</label>
                    <input
                      type="text"
                      id={`room-${room.id}`}
                      value={room.name}
                      onChange={(e) => handleRoomChange(room.id, e.target.value)}
                      placeholder="Nome stanza"
                    />
                  </div>
                  <div className="row-actions">
                    {rooms.length > 1 && (
                      <button
                        type="button"
                        className="remove-button"
                        onClick={() => removeRoom(room.id)}
                      >
                        Rimuovi
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" className="add-button" onClick={addRoom}>
                Aggiungi Stanza
              </button>
            </div>
          ) : (
            <div className="numbering-section">
              <h4>Interventi</h4>
              {interventions.map((intervention) => (
                <div key={intervention.id} className="form-row">
                  <div className="form-group">
                    <label htmlFor={`intervention-${intervention.id}`}>Intervento N. {intervention.id}</label>
                    <input
                      type="text"
                      id={`intervention-${intervention.id}`}
                      value={intervention.name}
                      onChange={(e) => handleInterventionChange(intervention.id, e.target.value)}
                      placeholder="Descrizione intervento"
                    />
                  </div>
                  <div className="row-actions">
                    {interventions.length > 1 && (
                      <button
                        type="button"
                        className="remove-button"
                        onClick={() => removeIntervention(intervention.id)}
                      >
                        Rimuovi
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" className="add-button" onClick={addIntervention}>
                Aggiungi Intervento
              </button>
            </div>
          )}
        </div>

        {/* Tipologici Section */}
        <div className="form-section">
          <h3>Tipologici</h3>
          <div className="tipologici-table">
            <div className="table-header">
              <div className="table-cell">Supporto</div>
              <div className="table-cell">Elemento</div>
              <div className="table-cell">Tipologia</div>
              <div className="table-cell">Quantità</div>
              <div className="table-cell">Unità di Misura</div>
              <div className="table-cell actions">Azioni</div>
            </div>
            {tipologici.map((item, index) => (
              <div key={item.id} className="table-row">
                <div className="table-cell">
                  <select
                    value={item.supporto}
                    onChange={(e) => handleTipologiciChange(item.id, 'supporto', e.target.value)}
                  >
                    <option value="">Seleziona supporto</option>
                    <option value="brick">Brick</option>
                    <option value="concrete">Concrete</option>
                    <option value="wood">Wood</option>
                    <option value="steel">Steel</option>
                  </select>
                  {errors.tipologici?.[index]?.supporto && <div className="error-message">{errors.tipologici[index].supporto}</div>}
                </div>
                <div className="table-cell">
                  <select
                    value={item.elemento}
                    onChange={(e) => handleTipologiciChange(item.id, 'elemento', e.target.value)}
                  >
                    <option value="">Seleziona elemento</option>
                    <option value="wall">Wall</option>
                    <option value="floor">Floor</option>
                    <option value="ceiling">Ceiling</option>
                    <option value="roof">Roof</option>
                  </select>
                  {errors.tipologici?.[index]?.elemento && <div className="error-message">{errors.tipologici[index].elemento}</div>}
                </div>
                <div className="table-cell">
                  <select
                    value={item.tipologia}
                    onChange={(e) => handleTipologiciChange(item.id, 'tipologia', e.target.value)}
                  >
                    <option value="">Seleziona tipologia</option>
                    <option value="structural">Structural</option>
                    <option value="non-structural">Non-Structural</option>
                    <option value="facade">Facade</option>
                  </select>
                  {errors.tipologici?.[index]?.tipologia && <div className="error-message">{errors.tipologici[index].tipologia}</div>}
                </div>
                <div className="table-cell">
                  <input
                    type="number"
                    value={item.quantita}
                    onChange={(e) => handleTipologiciChange(item.id, 'quantita', e.target.value)}
                    min="0"
                    step="0.01"
                  />
                  {errors.tipologici?.[index]?.quantita && <div className="error-message">{errors.tipologici[index].quantita}</div>}
                </div>
                <div className="table-cell">
                  <select
                    value={item.unitaMisura}
                    onChange={(e) => handleTipologiciChange(item.id, 'unitaMisura', e.target.value)}
                  >
                    <option value="">Seleziona unità</option>
                    <option value="m2">m²</option>
                    <option value="m">m</option>
                    <option value="pcs">pcs</option>
                    <option value="kg">kg</option>
                  </select>
                </div>
                <div className="table-cell actions">
                  {tipologici.length > 1 && (
                    <button
                      type="button"
                      className="remove-button"
                      onClick={() => removeTipologiciRow(item.id)}
                    >
                      Rimuovi
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="add-button" onClick={addTipologiciRow}>
            Aggiungi Riga
          </button>
        </div>

        <div className="form-footer">
          <button type="button" onClick={onCancel} className="cancel-button">
            Annulla
          </button>
          <button type="submit" className="save-button">
            Salva Progetto
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProjectForm;