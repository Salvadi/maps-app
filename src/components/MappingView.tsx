import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import NavigationBar from './NavigationBar';
import {
  Project,
  MappingEntry,
  Photo,
  User,
  getMappingEntriesForProject,
  getPhotosForMapping,
  deleteMappingEntry,
} from '../db';
import './MappingView.css';

interface MappingViewProps {
  project: Project;
  currentUser: User;
  onBack: () => void;
  onAddMapping: () => void;
  onEditMapping: (mappingEntry: MappingEntry) => void;
  onSync?: () => void;
  isSyncing?: boolean;
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

const ImageIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8.5 10C9.32843 10 10 9.32843 10 8.5C10 7.67157 9.32843 7 8.5 7C7.67157 7 7 7.67157 7 8.5C7 9.32843 7.67157 10 8.5 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M21 15L16 10L5 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const EditIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M18.5 2.50001C18.8978 2.10219 19.4374 1.87869 20 1.87869C20.5626 1.87869 21.1022 2.10219 21.5 2.50001C21.8978 2.89784 22.1213 3.4374 22.1213 4.00001C22.1213 4.56262 21.8978 5.10219 21.5 5.50001L12 15L8 16L9 12L18.5 2.50001Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const DeleteIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 6H5H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const SortAscIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 4H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M3 12H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M3 16H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M17 8L21 4L17 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M21 4V20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const SortDescIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 4H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M3 8H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M3 12H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M3 16H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M17 16L21 20L17 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M21 4V20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const FolderIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H9L11 6H19C19.5304 6 20.0391 6.21071 20.4142 6.58579C20.7893 6.96086 21 7.46957 21 8V19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ChevronDownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const ChevronRightIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

type SortBy = 'name' | 'date' | 'floor' | 'room';
type SortOrder = 'asc' | 'desc';
type ViewMode = 'flat' | 'hierarchical';

interface HierarchicalGroup {
  floor: string;
  rooms: {
    room: string;
    interventions: {
      intervention: string;
      mappings: MappingEntry[];
    }[];
  }[];
}

const MappingView: React.FC<MappingViewProps> = ({
  project,
  currentUser,
  onBack,
  onAddMapping,
  onEditMapping,
  onSync,
  isSyncing,
}) => {
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMapping, setSelectedMapping] = useState<string | null>(null);
  const [mappingPhotos, setMappingPhotos] = useState<Record<string, Photo[]>>({});
  const [isExporting, setIsExporting] = useState(false);

  // Sorting and filtering states
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [viewMode, setViewMode] = useState<ViewMode>('flat');
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(new Set());
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());

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

  // Sort mappings
  const sortMappings = (mappingsToSort: MappingEntry[]): MappingEntry[] => {
    const sorted = [...mappingsToSort];

    sorted.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name': {
          // Name = floor + room + intervention
          const nameA = `${a.floor}-${a.room || ''}-${a.intervention || ''}`;
          const nameB = `${b.floor}-${b.room || ''}-${b.intervention || ''}`;
          comparison = nameA.localeCompare(nameB);
          break;
        }
        case 'date':
          comparison = a.timestamp - b.timestamp;
          break;
        case 'floor': {
          // Sort by floor number (assuming floor is numeric or alphanumeric)
          const floorA = parseInt(a.floor) || a.floor;
          const floorB = parseInt(b.floor) || b.floor;
          if (typeof floorA === 'number' && typeof floorB === 'number') {
            comparison = floorA - floorB;
          } else {
            comparison = String(floorA).localeCompare(String(floorB));
          }
          // Secondary sort by room and intervention
          if (comparison === 0) {
            const roomA = a.room || '';
            const roomB = b.room || '';
            comparison = roomA.localeCompare(roomB);
            if (comparison === 0) {
              const intA = a.intervention || '';
              const intB = b.intervention || '';
              comparison = intA.localeCompare(intB);
            }
          }
          break;
        }
        case 'room': {
          const roomA = a.room || '';
          const roomB = b.room || '';
          comparison = roomA.localeCompare(roomB);
          // Secondary sort by floor and intervention
          if (comparison === 0) {
            comparison = a.floor.localeCompare(b.floor);
            if (comparison === 0) {
              const intA = a.intervention || '';
              const intB = b.intervention || '';
              comparison = intA.localeCompare(intB);
            }
          }
          break;
        }
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  };

  // Group mappings hierarchically by floor → room → intervention
  const groupMappingsHierarchically = (mappingsToGroup: MappingEntry[]): HierarchicalGroup[] => {
    const floorMap = new Map<string, Map<string, Map<string, MappingEntry[]>>>();

    // Group by floor, room, intervention
    for (const mapping of mappingsToGroup) {
      const floor = mapping.floor;
      const room = mapping.room || '-';
      const intervention = mapping.intervention || '-';

      if (!floorMap.has(floor)) {
        floorMap.set(floor, new Map());
      }
      const roomMap = floorMap.get(floor)!;

      if (!roomMap.has(room)) {
        roomMap.set(room, new Map());
      }
      const interventionMap = roomMap.get(room)!;

      if (!interventionMap.has(intervention)) {
        interventionMap.set(intervention, []);
      }
      interventionMap.get(intervention)!.push(mapping);
    }

    // Convert to array structure
    const groups: HierarchicalGroup[] = [];

    // Sort floors
    const floors = Array.from(floorMap.keys()).sort((a, b) => {
      const floorA = parseInt(a) || a;
      const floorB = parseInt(b) || b;
      if (typeof floorA === 'number' && typeof floorB === 'number') {
        return sortOrder === 'asc' ? floorA - floorB : floorB - floorA;
      }
      return sortOrder === 'asc' ? String(floorA).localeCompare(String(floorB)) : String(floorB).localeCompare(String(floorA));
    });

    for (const floor of floors) {
      const roomMap = floorMap.get(floor)!;
      const rooms = Array.from(roomMap.keys()).sort((a, b) => {
        const comparison = a.localeCompare(b);
        return sortOrder === 'asc' ? comparison : -comparison;
      });

      const roomGroups = rooms.map(room => {
        const interventionMap = roomMap.get(room)!;
        const interventions = Array.from(interventionMap.keys()).sort((a, b) => {
          const comparison = a.localeCompare(b);
          return sortOrder === 'asc' ? comparison : -comparison;
        });

        return {
          room,
          interventions: interventions.map(intervention => ({
            intervention,
            mappings: interventionMap.get(intervention)!,
          })),
        };
      });

      groups.push({
        floor,
        rooms: roomGroups,
      });
    }

    return groups;
  };

  const sortedMappings = sortMappings(mappings);
  const hierarchicalGroups = groupMappingsHierarchically(sortedMappings);

  // Toggle floor expansion
  const toggleFloor = (floor: string) => {
    setExpandedFloors(prev => {
      const next = new Set(prev);
      if (next.has(floor)) {
        next.delete(floor);
      } else {
        next.add(floor);
      }
      return next;
    });
  };

  // Toggle room expansion
  const toggleRoom = (floorRoom: string) => {
    setExpandedRooms(prev => {
      const next = new Set(prev);
      if (next.has(floorRoom)) {
        next.delete(floorRoom);
      } else {
        next.add(floorRoom);
      }
      return next;
    });
  };

  // Generate photo filename prefix based on project settings
  const generatePhotoPrefix = (floor: string, room?: string, intervention?: string): string => {
    const parts: string[] = [];

    // Always include Piano if project has multiple floors
    if (project.floors && project.floors.length > 1) {
      parts.push(`P${floor}`);
    }

    // Include Stanza if room numbering is enabled and room is provided
    if (project.useRoomNumbering && room) {
      parts.push(`S${room}`);
    }

    // Include Intervento if intervention numbering is enabled and intervention is provided
    if (project.useInterventionNumbering && intervention) {
      parts.push(`Int${intervention}`);
    }

    return parts.length > 0 ? parts.join('_') + '_' : '';
  };

  // Export to XLSX
  const handleExportExcel = async () => {
    setIsExporting(true);

    try {
      // Prepare data for Excel with conditional columns and multiple rows per attraversamento
      const data: any[] = [];

      for (const mapping of mappings) {
        const photos = mappingPhotos[mapping.id] || [];
        const crossings = mapping.crossings.length > 0 ? mapping.crossings : [null];

        // Create one row per attraversamento
        for (const crossing of crossings) {
          const row: any = {};

          // Conditional column: Piano (only if multiple floors)
          if (project.floors && project.floors.length > 1) {
            row['Piano'] = mapping.floor;
          }

          // Conditional column: Stanza (only if room numbering enabled)
          if (project.useRoomNumbering) {
            row['Stanza'] = mapping.room || '-';
          }

          // Conditional column: Intervento N. (only if intervention numbering enabled)
          if (project.useInterventionNumbering) {
            row['Intervento N.'] = mapping.intervention || '-';
          }

          // N. foto - generate photo numbers with zero padding
          const photoNumbers = photos.map((_, idx) => {
            const photoNum = (idx + 1).toString().padStart(2, '0');
            const prefix = generatePhotoPrefix(mapping.floor, mapping.room, mapping.intervention);
            return `${prefix}${photoNum}`;
          }).join(', ');
          row['N. foto'] = photoNumbers || '-';

          // Crossing data
          if (crossing) {
            row['Supporto'] = crossing.supporto || '-';
            row['Tipo supporto'] = crossing.tipoSupporto || '-';
            row['Attraversamento'] = crossing.attraversamento || '-';
            row['Quantità'] = crossing.quantita || '-';
            row['Diametro'] = crossing.diametro || '-';
            row['Dimensioni'] = crossing.dimensioni || '-';
            row['Tipologico'] = crossing.tipologicoId || '-';
          } else {
            row['Supporto'] = '-';
            row['Tipo supporto'] = '-';
            row['Attraversamento'] = '-';
            row['Quantità'] = '-';
            row['Diametro'] = '-';
            row['Dimensioni'] = '-';
            row['Tipologico'] = '-';
          }

          // Data and User
          row['Data'] = new Date(mapping.timestamp).toLocaleString('it-IT');
          row['User'] = mapping.createdBy;

          data.push(row);
        }
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);

      // Auto-size columns
      const colCount = Object.keys(data[0] || {}).length;
      ws['!cols'] = Array(colCount).fill({ wch: 15 });

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

      // Prepare Excel data with same logic as handleExportExcel
      const data: any[] = [];

      for (const mapping of mappings) {
        const photos = mappingPhotos[mapping.id] || [];
        const crossings = mapping.crossings.length > 0 ? mapping.crossings : [null];

        // Create one row per attraversamento
        for (const crossing of crossings) {
          const row: any = {};

          // Conditional column: Piano (only if multiple floors)
          if (project.floors && project.floors.length > 1) {
            row['Piano'] = mapping.floor;
          }

          // Conditional column: Stanza (only if room numbering enabled)
          if (project.useRoomNumbering) {
            row['Stanza'] = mapping.room || '-';
          }

          // Conditional column: Intervento N. (only if intervention numbering enabled)
          if (project.useInterventionNumbering) {
            row['Intervento N.'] = mapping.intervention || '-';
          }

          // N. foto - generate photo numbers with zero padding
          const photoNumbers = photos.map((_, idx) => {
            const photoNum = (idx + 1).toString().padStart(2, '0');
            const prefix = generatePhotoPrefix(mapping.floor, mapping.room, mapping.intervention);
            return `${prefix}${photoNum}`;
          }).join(', ');
          row['N. foto'] = photoNumbers || '-';

          // Crossing data
          if (crossing) {
            row['Supporto'] = crossing.supporto || '-';
            row['Tipo supporto'] = crossing.tipoSupporto || '-';
            row['Attraversamento'] = crossing.attraversamento || '-';
            row['Quantità'] = crossing.quantita || '-';
            row['Diametro'] = crossing.diametro || '-';
            row['Dimensioni'] = crossing.dimensioni || '-';
            row['Tipologico'] = crossing.tipologicoId || '-';
          } else {
            row['Supporto'] = '-';
            row['Tipo supporto'] = '-';
            row['Attraversamento'] = '-';
            row['Quantità'] = '-';
            row['Diametro'] = '-';
            row['Dimensioni'] = '-';
            row['Tipologico'] = '-';
          }

          // Data and User
          row['Data'] = new Date(mapping.timestamp).toLocaleString('it-IT');
          row['User'] = mapping.createdBy;

          data.push(row);
        }
      }

      // Create Excel file
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      const colCount = Object.keys(data[0] || {}).length;
      ws['!cols'] = Array(colCount).fill({ wch: 15 });
      XLSX.utils.book_append_sheet(wb, ws, 'Mappings');
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      zip.file(`${project.title}_mappings.xlsx`, excelBuffer);

      // Add photos with correct naming convention
      for (const mapping of mappings) {
        const photos = mappingPhotos[mapping.id] || [];
        const prefix = generatePhotoPrefix(mapping.floor, mapping.room, mapping.intervention);

        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          const photoNum = (i + 1).toString().padStart(2, '0');
          const filename = `${prefix}${photoNum}.jpg`;
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

  // Handle delete mapping
  const handleDeleteMapping = async (mappingId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!window.confirm('Sei sicuro di voler eliminare questa mappatura? Questa azione non può essere annullata.')) {
      return;
    }

    try {
      await deleteMappingEntry(mappingId);

      // Remove from local state
      setMappings(prev => prev.filter(m => m.id !== mappingId));

      // Clean up photos
      const updatedPhotos = { ...mappingPhotos };
      delete updatedPhotos[mappingId];
      setMappingPhotos(updatedPhotos);

      console.log('Mapping deleted successfully');
    } catch (error) {
      console.error('Failed to delete mapping:', error);
      alert('Errore durante l\'eliminazione della mappatura');
    }
  };

  // Handle edit mapping
  const handleEditMapping = (mapping: MappingEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    onEditMapping(mapping);
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
      <NavigationBar
        title={project.title}
        onBack={onBack}
        onSync={onSync}
        isSyncing={isSyncing}
      />
      <div className="mapping-view-container">
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

        {/* Sorting and View Mode Controls */}
        {mappings.length > 0 && (
          <div className="filter-controls">
            <div className="sort-controls">
              <label className="control-label">Ordina per:</label>
              <div className="button-group">
                <button
                  className={`filter-btn ${sortBy === 'name' ? 'active' : ''}`}
                  onClick={() => setSortBy('name')}
                >
                  Nome
                </button>
                <button
                  className={`filter-btn ${sortBy === 'date' ? 'active' : ''}`}
                  onClick={() => setSortBy('date')}
                >
                  Data
                </button>
                <button
                  className={`filter-btn ${sortBy === 'floor' ? 'active' : ''}`}
                  onClick={() => setSortBy('floor')}
                >
                  Piano
                </button>
                {project.useRoomNumbering && (
                  <button
                    className={`filter-btn ${sortBy === 'room' ? 'active' : ''}`}
                    onClick={() => setSortBy('room')}
                  >
                    Stanza
                  </button>
                )}
              </div>
            </div>

            <div className="order-controls">
              <button
                className="order-btn"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                title={sortOrder === 'asc' ? 'Ordine crescente' : 'Ordine decrescente'}
              >
                {sortOrder === 'asc' ? <SortAscIcon className="icon" /> : <SortDescIcon className="icon" />}
                {sortOrder === 'asc' ? 'Crescente' : 'Decrescente'}
              </button>
            </div>

            <div className="view-controls">
              <label className="control-label">Vista:</label>
              <div className="button-group">
                <button
                  className={`filter-btn ${viewMode === 'flat' ? 'active' : ''}`}
                  onClick={() => setViewMode('flat')}
                >
                  Lista
                </button>
                <button
                  className={`filter-btn ${viewMode === 'hierarchical' ? 'active' : ''}`}
                  onClick={() => setViewMode('hierarchical')}
                  title="Raggruppa per piano → stanza → intervento"
                >
                  <FolderIcon className="icon-inline" />
                  Cartelle
                </button>
              </div>
            </div>
          </div>
        )}

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
        ) : viewMode === 'flat' ? (
          <div className="mappings-list">
            {sortedMappings.map((mapping) => {
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
                        Piano {mapping.floor}
                        {mapping.room && ` - Stanza ${mapping.room}`}
                        {mapping.intervention && ` - Int. ${mapping.intervention}`}
                      </h3>
                      <p className="mapping-meta">
                        {new Date(mapping.timestamp).toLocaleDateString()} • {photos.length} foto
                      </p>
                    </div>
                    <div className="mapping-header-actions">
                      <button
                        className="mapping-action-btn"
                        onClick={(e) => handleEditMapping(mapping, e)}
                        aria-label="Modifica mappatura"
                      >
                        <EditIcon className="icon" />
                      </button>
                      <button
                        className="mapping-action-btn delete"
                        onClick={(e) => handleDeleteMapping(mapping.id, e)}
                        aria-label="Elimina mappatura"
                      >
                        <DeleteIcon className="icon" />
                      </button>
                      <div className="photo-count">
                        <ImageIcon className="icon" />
                        {photos.length}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mapping-details" onClick={(e) => e.stopPropagation()}>
                      {/* Sigillature */}
                      {mapping.crossings.length > 0 && (
                        <div className="crossings-section">
                          <h4>Sigillature:</h4>
                          <ul>
                            {mapping.crossings.map((sig, idx) => (
                              <li key={idx} style={{ marginBottom: '8px' }}>
                                <strong>Supporto:</strong> {sig.supporto || 'N/A'}<br />
                                <strong>Tipo Supporto:</strong> {sig.tipoSupporto || 'N/A'}<br />
                                <strong>Attraversamento:</strong> {sig.attraversamento || 'N/A'}<br />
                                {sig.tipologicoId && (
                                  <><strong>Tipologico:</strong> {sig.tipologicoId}<br /></>
                                )}
                                {sig.notes && (
                                  <><strong>Note:</strong> {sig.notes}<br /></>
                                )}
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
                                alt={`Floor ${mapping.floor} ${mapping.room ? `Room ${mapping.room}` : ''} ${mapping.intervention ? `Int ${mapping.intervention}` : ''} - ${idx + 1}`}
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
        ) : (
          <div className="hierarchical-view">
            {hierarchicalGroups.map((floorGroup) => {
              const isFloorExpanded = expandedFloors.has(floorGroup.floor);
              const floorMappingCount = floorGroup.rooms.reduce(
                (sum, room) => sum + room.interventions.reduce((s, int) => s + int.mappings.length, 0),
                0
              );

              return (
                <div key={floorGroup.floor} className="hierarchy-group">
                  <div
                    className="hierarchy-header floor-header"
                    onClick={() => toggleFloor(floorGroup.floor)}
                  >
                    {isFloorExpanded ? <ChevronDownIcon className="chevron" /> : <ChevronRightIcon className="chevron" />}
                    <FolderIcon className="folder-icon" />
                    <span className="hierarchy-title">Piano {floorGroup.floor}</span>
                    <span className="hierarchy-count">({floorMappingCount})</span>
                  </div>

                  {isFloorExpanded && (
                    <div className="hierarchy-children">
                      {floorGroup.rooms.map((roomGroup) => {
                        const floorRoomKey = `${floorGroup.floor}-${roomGroup.room}`;
                        const isRoomExpanded = expandedRooms.has(floorRoomKey);
                        const roomMappingCount = roomGroup.interventions.reduce(
                          (sum, int) => sum + int.mappings.length,
                          0
                        );

                        return (
                          <div key={floorRoomKey} className="hierarchy-group">
                            <div
                              className="hierarchy-header room-header"
                              onClick={() => toggleRoom(floorRoomKey)}
                            >
                              {isRoomExpanded ? <ChevronDownIcon className="chevron" /> : <ChevronRightIcon className="chevron" />}
                              <FolderIcon className="folder-icon" />
                              <span className="hierarchy-title">
                                {roomGroup.room === '-' ? 'Nessuna stanza' : `Stanza ${roomGroup.room}`}
                              </span>
                              <span className="hierarchy-count">({roomMappingCount})</span>
                            </div>

                            {isRoomExpanded && (
                              <div className="hierarchy-children">
                                {roomGroup.interventions.map((interventionGroup) => (
                                  <div key={`${floorRoomKey}-${interventionGroup.intervention}`} className="intervention-group">
                                    <div className="intervention-header">
                                      <FolderIcon className="folder-icon" />
                                      <span className="hierarchy-title">
                                        {interventionGroup.intervention === '-' ? 'Nessun intervento' : `Intervento ${interventionGroup.intervention}`}
                                      </span>
                                      <span className="hierarchy-count">({interventionGroup.mappings.length})</span>
                                    </div>
                                    <div className="intervention-mappings">
                                      {interventionGroup.mappings.map((mapping) => {
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
                                                  Piano {mapping.floor}
                                                  {mapping.room && ` - Stanza ${mapping.room}`}
                                                  {mapping.intervention && ` - Int. ${mapping.intervention}`}
                                                </h3>
                                                <p className="mapping-meta">
                                                  {new Date(mapping.timestamp).toLocaleDateString()} • {photos.length} foto
                                                </p>
                                              </div>
                                              <div className="mapping-header-actions">
                                                <button
                                                  className="mapping-action-btn"
                                                  onClick={(e) => handleEditMapping(mapping, e)}
                                                  aria-label="Modifica mappatura"
                                                >
                                                  <EditIcon className="icon" />
                                                </button>
                                                <button
                                                  className="mapping-action-btn delete"
                                                  onClick={(e) => handleDeleteMapping(mapping.id, e)}
                                                  aria-label="Elimina mappatura"
                                                >
                                                  <DeleteIcon className="icon" />
                                                </button>
                                                <div className="photo-count">
                                                  <ImageIcon className="icon" />
                                                  {photos.length}
                                                </div>
                                              </div>
                                            </div>

                                            {isExpanded && (
                                              <div className="mapping-details" onClick={(e) => e.stopPropagation()}>
                                                {/* Sigillature */}
                                                {mapping.crossings.length > 0 && (
                                                  <div className="crossings-section">
                                                    <h4>Sigillature:</h4>
                                                    <ul>
                                                      {mapping.crossings.map((sig, idx) => (
                                                        <li key={idx} style={{ marginBottom: '8px' }}>
                                                          <strong>Supporto:</strong> {sig.supporto || 'N/A'}<br />
                                                          <strong>Tipo Supporto:</strong> {sig.tipoSupporto || 'N/A'}<br />
                                                          <strong>Attraversamento:</strong> {sig.attraversamento || 'N/A'}<br />
                                                          {sig.tipologicoId && (
                                                            <><strong>Tipologico:</strong> {sig.tipologicoId}<br /></>
                                                          )}
                                                          {sig.notes && (
                                                            <><strong>Note:</strong> {sig.notes}<br /></>
                                                          )}
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
                                                          alt={`Floor ${mapping.floor} ${mapping.room ? `Room ${mapping.room}` : ''} ${mapping.intervention ? `Int ${mapping.intervention}` : ''} - ${idx + 1}`}
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
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
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
