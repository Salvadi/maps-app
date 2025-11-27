import React, { useState, useRef } from 'react';
import { Project, Crossing, MappingEntry } from '../App';
import './MappingPage.css';

interface MappingPageProps {
  project: Project | null;
  onSave: (mapping: Omit<MappingEntry, 'id' | 'timestamp'>) => void;
  onBack: () => void;
}

// Camera Icon Component
const CameraIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M23 19C23 19.5304 22.7893 20.0391 22.4142 20.4142C22.0391 20.7893 21.5304 21 21 21H3C2.46957 21 1.96086 20.7893 1.58579 20.4142C1.21071 20.0391 1 19.5304 1 19V8C1 7.46957 1.21071 6.96086 1.58579 6.58579C1.96086 6.21071 2.46957 6 3 6H7L9 3H15L17 6H21C21.5304 6 22.0391 6.21071 22.4142 6.58579C22.7893 6.96086 23 7.46957 23 8V19Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const MappingPage: React.FC<MappingPageProps> = ({ project, onSave, onBack }) => {
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [floor, setFloor] = useState<string>(project?.floors[0] || '0');
  const [roomOrIntervention, setRoomOrIntervention] = useState<string>('');
  const [crossings, setCrossings] = useState<Omit<Crossing, 'id'>[]>([
    { supporto: '', attraversamento: '', tipologicoId: undefined }
  ]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedImage(file);

      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
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

  const handleAddCrossing = () => {
    setCrossings([
      ...crossings,
      { supporto: '', attraversamento: '', tipologicoId: undefined }
    ]);
  };

  const handleRemoveCrossing = (index: number) => {
    if (crossings.length > 1) {
      setCrossings(crossings.filter((_, i) => i !== index));
    }
  };

  const handleCrossingChange = (
    index: number,
    field: keyof Omit<Crossing, 'id'>,
    value: string
  ) => {
    const updatedCrossings = [...crossings];
    updatedCrossings[index] = {
      ...updatedCrossings[index],
      [field]: value || undefined
    };
    setCrossings(updatedCrossings);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!project) {
      alert('No project selected');
      return;
    }

    const mappingData: Omit<MappingEntry, 'id' | 'timestamp'> = {
      projectId: project.id,
      floor,
      roomOrIntervention,
      photoURL: imagePreview || '',
      crossings: crossings.map((c, index) => ({
        ...c,
        id: `${Date.now()}-${index}`
      }))
    };

    onSave(mappingData);
    alert('Mapping saved successfully!');

    // Reset form
    setSelectedImage(null);
    setImagePreview(null);
    setRoomOrIntervention('');
    setCrossings([{ supporto: '', attraversamento: '', tipologicoId: undefined }]);
  };

  return (
    <div className="mapping-page">
      <div className="mapping-container">
        <h1 className="mapping-title">Mapping</h1>

        {/* Hidden file inputs */}
        <input
          type="file"
          ref={cameraInputRef}
          onChange={handleImageChange}
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
        />
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImageChange}
          accept="image/*"
          style={{ display: 'none' }}
        />

        <form onSubmit={handleSubmit} className="mapping-form">
          {/* Image Input Section */}
          <div className="image-buttons">
            <button type="button" className="camera-btn" onClick={handleCameraClick}>
              <CameraIcon className="camera-icon" />
            </button>
            <button type="button" className="browse-btn" onClick={handleBrowseClick}>
              Browse
            </button>
          </div>

          {imagePreview && (
            <div className="image-preview">
              <img src={imagePreview} alt="Preview" />
            </div>
          )}

          {/* Floor Selection */}
          <div className="form-field">
            <label className="field-label">Floor</label>
            <select
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
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

          {/* Room/Intervention Input */}
          <div className="form-field">
            <label className="field-label">Room</label>
            <input
              type="text"
              value={roomOrIntervention}
              onChange={(e) => setRoomOrIntervention(e.target.value)}
              className="mapping-input"
            />
          </div>

          {/* Crossings Section */}
          <div className="crossings-section">
            <label className="section-label">Crossings</label>

            <div className="crossings-list">
              {crossings.map((crossing, index) => (
                <div key={index} className="crossing-row">
                  <div className="crossing-fields">
                    <div className="crossing-field">
                      <label className="crossing-label">Support</label>
                      <select
                        value={crossing.supporto}
                        onChange={(e) =>
                          handleCrossingChange(index, 'supporto', e.target.value)
                        }
                        className="crossing-select"
                      >
                        <option value=""></option>
                        <option value="brick">Brick</option>
                        <option value="concrete">Concrete</option>
                        <option value="wood">Wood</option>
                        <option value="steel">Steel</option>
                      </select>
                    </div>
                    <div className="crossing-field">
                      <label className="crossing-label">Crossing</label>
                      <select
                        value={crossing.attraversamento}
                        onChange={(e) =>
                          handleCrossingChange(index, 'attraversamento', e.target.value)
                        }
                        className="crossing-select"
                      >
                        <option value=""></option>
                        <option value="horizontal">Horizontal</option>
                        <option value="vertical">Vertical</option>
                        <option value="diagonal">Diagonal</option>
                      </select>
                    </div>
                  </div>

                  {crossings.length > 1 && (
                    <button
                      type="button"
                      className="remove-crossing-btn"
                      onClick={() => handleRemoveCrossing(index)}
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
              onClick={handleAddCrossing}
            >
              +
            </button>
          </div>

          {/* Actions */}
          <div className="mapping-actions">
            <button type="button" className="back-btn" onClick={onBack}>
              Back
            </button>
            <button type="submit" className="save-btn">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MappingPage;
