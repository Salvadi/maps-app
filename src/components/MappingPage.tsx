import React, { useState, useRef } from 'react';
import imageCompression from 'browser-image-compression';
import { Project, Crossing, User, createMappingEntry } from '../db';
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
  const [floor, setFloor] = useState<string>(project?.floors[0] || '0');
  const [roomOrIntervention, setRoomOrIntervention] = useState<string>('');
  const [crossings, setCrossings] = useState<Omit<Crossing, 'id'>[]>([
    { supporto: '', attraversamento: '', tipologicoId: undefined }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!project) {
      setError('No project selected');
      return;
    }

    if (photoFiles.length === 0) {
      setError('Please capture at least one photo');
      return;
    }

    setIsSubmitting(true);

    try {
      // Compress photos
      const compressedBlobs: Blob[] = await Promise.all(
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

      console.log(`Compressed ${photoFiles.length} photos`);

      // Save mapping entry to IndexedDB
      const mappingEntry = await createMappingEntry(
        {
          projectId: project.id,
          floor,
          roomOrIntervention,
          crossings: crossings.map((c, index) => ({
            ...c,
            id: `${Date.now()}-${index}`,
          })),
          createdBy: currentUser.id,
        },
        compressedBlobs
      );

      console.log('Mapping entry created:', mappingEntry.id);
      alert('Mapping saved successfully!');

      // Reset form
      setPhotoFiles([]);
      setPhotoPreviews([]);
      setRoomOrIntervention('');
      setCrossings([{ supporto: '', attraversamento: '', tipologicoId: undefined }]);

      // Reset file inputs
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    } catch (err) {
      console.error('Failed to save mapping:', err);
      setError('Failed to save mapping. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mapping-page">
      <div className="mapping-container">
        <h1 className="mapping-title">Mapping</h1>

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
              Browse
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
                    alt={`Preview ${index + 1}`}
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
            <button
              type="button"
              className="back-btn"
              onClick={onBack}
              disabled={isSubmitting}
            >
              Back
            </button>
            <button
              type="submit"
              className="save-btn"
              disabled={isSubmitting || photoFiles.length === 0}
            >
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MappingPage;
