import React, { useState, useRef } from 'react';
import './MappingPage.css';

interface Crossing {
  id: number;
  supporto: string;
  attraversamento: string;
  tipologici: string;
}

const MappingPage: React.FC = () => {
  // Image state
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Form data state
  const [floor, setFloor] = useState<string>('');
  const [roomNumber, setRoomNumber] = useState<string>('');
  const [crossings, setCrossings] = useState<Crossing[]>([
    { id: Date.now(), supporto: '', attraversamento: '', tipologici: '' }
  ]);
  
  // Mock data for dropdowns
  const floorOptions = ['1st Floor', '2nd Floor', '3rd Floor', 'Basement'];
  const supportoOptions = ['Brick', 'Concrete', 'Wood'];
  const attraversamentoOptions = ['Horizontal', 'Vertical', 'Diagonal'];
  const tipologiciOptions = ['Type A', 'Type B', 'Type C'];

  // Handle image selection
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedImage(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Trigger file input for camera
  const handleCameraClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('capture', 'environment');
      fileInputRef.current.click();
    }
  };

  // Trigger file input for browse
  const handleBrowseClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute('capture');
      fileInputRef.current.click();
    }
  };

  // Add new crossing row
  const addCrossing = () => {
    setCrossings([
      ...crossings,
      { id: Date.now(), supporto: '', attraversamento: '', tipologici: '' }
    ]);
  };

  // Remove crossing row
  const removeCrossing = (id: number) => {
    if (crossings.length > 1) {
      setCrossings(crossings.filter(crossing => crossing.id !== id));
    }
  };

  // Update crossing data
  const updateCrossing = (id: number, field: keyof Crossing, value: string) => {
    setCrossings(
      crossings.map(crossing => 
        crossing.id === id ? { ...crossing, [field]: value } : crossing
      )
    );
  };

  // Handle form submission
  const handleSave = () => {
    const mappingData = {
      floor,
      roomNumber,
      photoURL: imagePreview,
      crossings,
      timestamp: new Date().toISOString(),
      projectId: 'project-123' // This would come from context in a real app
    };
    
    console.log('Mapping data:', mappingData);
    alert('Mapping saved! Check console for details.');
  };

  return (
    <div className="mapping-page">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageChange}
        accept="image/*"
        style={{ display: 'none' }}
      />
      
      {/* Header */}
      <header className="mapping-header">
        <h1>Mapping</h1>
      </header>
      
      {/* Image Input Section */}
      <section className="image-input-section">
        <div className="image-preview">
          {imagePreview ? (
            <img src={imagePreview} alt="Preview" />
          ) : (
            <div className="placeholder">No image selected</div>
          )}
        </div>
        
        <div className="image-buttons">
          <button className="camera-button" onClick={handleCameraClick}>
            Camera
          </button>
          <button className="browse-button" onClick={handleBrowseClick}>
            Browse
          </button>
        </div>
        
        {selectedImage && (
          <div className="file-name">
            Selected: {selectedImage.name}
          </div>
        )}
      </section>
      
      {/* Positioning/Metadata Section */}
      <section className="metadata-section">
        {/* Floor Selection */}
        <div className="form-group">
          <label htmlFor="floor">Floor</label>
          <select 
            id="floor" 
            value={floor} 
            onChange={(e) => setFloor(e.target.value)}
          >
            <option value="">Select a floor</option>
            {floorOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        
        {/* Room/Intervention Number */}
        <div className="form-group">
          <label htmlFor="roomNumber">Room or Intervention Number</label>
          <input
            type="text"
            id="roomNumber"
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            placeholder="Enter room or intervention number"
          />
        </div>
        
        {/* Attraversamenti Section */}
        <div className="attraversamenti-section">
          <h2>Attraversamenti</h2>
          <div className="crossings-table">
            <div className="table-header">
              <div>Supporto</div>
              <div>Attraversamento</div>
              <div>Tipologici</div>
              <div>Actions</div>
            </div>
            
            {crossings.map((crossing) => (
              <div className="table-row" key={crossing.id}>
                <div className="table-cell">
                  <select
                    value={crossing.supporto}
                    onChange={(e) => updateCrossing(crossing.id, 'supporto', e.target.value)}
                  >
                    <option value="">Select supporto</option>
                    {supportoOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="table-cell">
                  <select
                    value={crossing.attraversamento}
                    onChange={(e) => updateCrossing(crossing.id, 'attraversamento', e.target.value)}
                  >
                    <option value="">Select attraversamento</option>
                    {attraversamentoOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="table-cell">
                  <select
                    value={crossing.tipologici}
                    onChange={(e) => updateCrossing(crossing.id, 'tipologici', e.target.value)}
                  >
                    <option value="">Select tipologici</option>
                    {tipologiciOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="table-cell actions">
                  <button 
                    className="remove-button"
                    onClick={() => removeCrossing(crossing.id)}
                    disabled={crossings.length <= 1}
                  >
                    -
                  </button>
                  {crossings[crossings.length - 1].id === crossing.id && (
                    <button 
                      className="add-button"
                      onClick={addCrossing}
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      
      {/* Save Button */}
      <div className="save-button-container">
        <button className="save-button" onClick={handleSave}>
          Save Mapping
        </button>
      </div>
    </div>
  );
};

export default MappingPage;