import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  Project,
  MappingEntry,
  Photo,
  User,
  getMappingEntriesForProject,
  getPhotosForMapping,
} from '../db';
import './MappingView.css';

interface MappingViewProps {
  project: Project;
  currentUser: User;
  onBack: () => void;
  onAddMapping: () => void;
}

// Icon Components
const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 15V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const PlusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5V19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M5 12H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const BackIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 12H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 19L5 12L12 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ImageIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8.5 10C9.32843 10 10 9.32843 10 8.5C10 7.67157 9.32843 7 8.5 7C7.67157 7 7 7.67157 7 8.5C7 9.32843 7.67157 10 8.5 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const MappingView: React.FC<MappingViewProps> = ({
  project,
  currentUser,
  onBack,
  onAddMapping,
}) => {
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMapping, setSelectedMapping] = useState<string | null>(null);
  const [mappingPhotos, setMappingPhotos] = useState<Record<string, Photo[]>>({});
  const [isExporting, setIsExporting] = useState(false);

  // Load mappings
  useEffect(() => {
    const loadMappings = async () => {
      try {
        setIsLoading(true);
        const entries = await getMappingEntriesForProject(project.id);
        setMappings(entries);

        // Load photos for all mappings
        const photosMap: Record<string, Photo[]> = {};
        for (const entry of entries) {
          const photos = await getPhotosForMapping(entry.id);
          photosMap[entry.id] = photos;
        }
        setMappingPhotos(photosMap);
      } catch (error) {
        console.error('Failed to load mappings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadMappings();
  }, [project.id]);

  // Export to XLSX
  const handleExportExcel = async () => {
    setIsExporting(true);

    try {
      // Prepare data for Excel
      const data = mappings.map((mapping) => ({
        Floor: mapping.floor,
        'Room/Intervention': mapping.roomOrIntervention,
        'Photo Count': mappingPhotos[mapping.id]?.length || 0,
        'Created By': mapping.createdBy,
        'Created At': new Date(mapping.timestamp).toLocaleString(),
        Crossings: mapping.crossings
          .map((c) => `${c.supporto || 'N/A'} - ${c.attraversamento || 'N/A'}`)
          .join('; '),
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);

      // Auto-size columns
      const maxWidth = data.reduce((w, r) => Math.max(w, r['Room/Intervention'].length), 10);
      ws['!cols'] = [
        { wch: 10 },
        { wch: maxWidth },
        { wch: 12 },
        { wch: 15 },
        { wch: 20 },
        { wch: 40 },
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Mappings');
      XLSX.writeFile(wb, `${project.title}_mappings.xlsx`);

      console.log('Excel exported successfully');
    } catch (error) {
      console.error('Failed to export Excel:', error);
      alert('Failed to export Excel file');
    } finally {
      setIsExporting(false);
    }
  };

  // Export to ZIP with photos
  const handleExportZip = async () => {
    setIsExporting(true);

    try {
      const zip = new JSZip();

      // Add Excel file
      const data = mappings.map((mapping) => ({
        Floor: mapping.floor,
        'Room/Intervention': mapping.roomOrIntervention,
        'Photo Count': mappingPhotos[mapping.id]?.length || 0,
        'Created At': new Date(mapping.timestamp).toLocaleString(),
        Crossings: mapping.crossings
          .map((c) => `${c.supporto || 'N/A'} - ${c.attraversamento || 'N/A'}`)
          .join('; '),
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Mappings');
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      zip.file(`${project.title}_mappings.xlsx`, excelBuffer);

      // Add photos
      for (const mapping of mappings) {
        const photos = mappingPhotos[mapping.id] || [];
        const folderName = `${mapping.floor}_${mapping.roomOrIntervention}`.replace(/[^a-z0-9_-]/gi, '_');

        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          const filename = `${folderName}/photo_${i + 1}.jpg`;
          zip.file(filename, photo.blob);
        }
      }

      // Generate ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, `${project.title}_export.zip`);

      console.log('ZIP exported successfully');
    } catch (error) {
      console.error('Failed to export ZIP:', error);
      alert('Failed to export ZIP file');
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mapping-view-page">
        <div className="mapping-view-container">
          <h1 className="view-title">{project.title}</h1>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '200px',
            color: 'var(--color-text-secondary)'
          }}>
            Caricamento mappature...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mapping-view-page">
      <div className="mapping-view-container">
        {/* Header */}
        <div className="view-header">
          <button className="back-btn" onClick={onBack}>
            <BackIcon className="icon" />
            Back
          </button>
          <h1 className="view-title">{project.title}</h1>
        </div>

        {/* Export Buttons */}
        <div className="export-actions">
          <button
            className="export-btn"
            onClick={handleExportExcel}
            disabled={isExporting || mappings.length === 0}
          >
            <DownloadIcon className="icon" />
            Export Excel
          </button>
          <button
            className="export-btn primary"
            onClick={handleExportZip}
            disabled={isExporting || mappings.length === 0}
          >
            <DownloadIcon className="icon" />
            Export ZIP (Photos + Excel)
          </button>
        </div>

        {/* Mappings List */}
        {mappings.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '200px',
            gap: '16px',
            color: 'var(--color-text-secondary)'
          }}>
            <p>Nessuna mappatura trovata</p>
            <p style={{ fontSize: '0.875rem' }}>Premi il pulsante + per aggiungere la prima mappatura</p>
          </div>
        ) : (
          <div className="mappings-list">
            {mappings.map((mapping) => {
              const photos = mappingPhotos[mapping.id] || [];
              const isExpanded = selectedMapping === mapping.id;

              return (
                <div
                  key={mapping.id}
                  className={`mapping-card ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => setSelectedMapping(isExpanded ? null : mapping.id)}
                >
                  <div className="mapping-header">
                    <div>
                      <h3 className="mapping-title">
                        Floor {mapping.floor} - {mapping.roomOrIntervention}
                      </h3>
                      <p className="mapping-meta">
                        {new Date(mapping.timestamp).toLocaleDateString()} • {photos.length} foto
                      </p>
                    </div>
                    <div className="photo-count">
                      <ImageIcon className="icon" />
                      {photos.length}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mapping-details" onClick={(e) => e.stopPropagation()}>
                      {/* Crossings */}
                      {mapping.crossings.length > 0 && (
                        <div className="crossings-section">
                          <h4>Attraversamenti:</h4>
                          <ul>
                            {mapping.crossings.map((crossing, idx) => (
                              <li key={idx}>
                                {crossing.supporto || 'N/A'} - {crossing.attraversamento || 'N/A'}
                                {crossing.tipologicoId && ` (Tip. ${crossing.tipologicoId})`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Photo Gallery */}
                      {photos.length > 0 && (
                        <div className="photo-gallery">
                          {photos.map((photo, idx) => (
                            <div key={photo.id} className="photo-item">
                              <img
                                src={URL.createObjectURL(photo.blob)}
                                alt={`${mapping.floor} ${mapping.roomOrIntervention} ${idx + 1}`}
                                loading="lazy"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* FAB */}
        <button className="fab-button" onClick={onAddMapping} aria-label="Add mapping">
          <PlusIcon className="fab-icon" />
        </button>
      </div>
    </div>
  );
};

export default MappingView;
