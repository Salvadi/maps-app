import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import NavigationBar from './NavigationBar';
import FloorPlanEditor, { UnmappedEntry } from './FloorPlanEditor';
import type { CanvasPoint, GridConfig } from './FloorPlanCanvas';
import { exportCanvasToPDF } from '../utils/exportUtils';
import {
  Project,
  MappingEntry,
  Photo,
  User,
  getMappingEntriesForProject,
  getPhotosForMapping,
  deleteMappingEntry,
  getAllUsers,
  FloorPlan,
  FloorPlanPoint,
  getFloorPlansByProject,
  getFloorPlanPoints,
  getFloorPlanBlobUrl,
  updateFloorPlanPoint,
  createFloorPlanPoint,
  deleteFloorPlanPoint,
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

const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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

const MapIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 6V22L8 18L16 22L23 18V2L16 6L8 2L1 6Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M8 2V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M16 6V22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
  const [users, setUsers] = useState<User[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [floorPlanPoints, setFloorPlanPoints] = useState<Record<string, FloorPlanPoint[]>>({});
  const [selectedFloorPlan, setSelectedFloorPlan] = useState<string>('');

  // Floor Plan Editor state
  const [showFloorPlanEditor, setShowFloorPlanEditor] = useState(false);
  const [editorFloorPlan, setEditorFloorPlan] = useState<FloorPlan | null>(null);
  const [editorImageUrl, setEditorImageUrl] = useState<string | null>(null);
  const [editorPoints, setEditorPoints] = useState<CanvasPoint[]>([]);
  const [editorUnmappedEntries, setEditorUnmappedEntries] = useState<UnmappedEntry[]>([]);

  // Sorting and filtering states - persist in localStorage
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    const saved = localStorage.getItem(`mappingView_${project.id}_sortBy`);
    return (saved as SortBy) || 'date';
  });
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    const saved = localStorage.getItem(`mappingView_${project.id}_sortOrder`);
    return (saved as SortOrder) || 'desc';
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(`mappingView_${project.id}_viewMode`);
    return (saved as ViewMode) || 'flat';
  });
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(`mappingView_${project.id}_expandedFloors`);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(`mappingView_${project.id}_expandedRooms`);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  // Save filter preferences to localStorage
  useEffect(() => {
    localStorage.setItem(`mappingView_${project.id}_sortBy`, sortBy);
  }, [sortBy, project.id]);

  useEffect(() => {
    localStorage.setItem(`mappingView_${project.id}_sortOrder`, sortOrder);
  }, [sortOrder, project.id]);

  useEffect(() => {
    localStorage.setItem(`mappingView_${project.id}_viewMode`, viewMode);
  }, [viewMode, project.id]);

  useEffect(() => {
    localStorage.setItem(`mappingView_${project.id}_expandedFloors`, JSON.stringify(Array.from(expandedFloors)));
  }, [expandedFloors, project.id]);

  useEffect(() => {
    localStorage.setItem(`mappingView_${project.id}_expandedRooms`, JSON.stringify(Array.from(expandedRooms)));
  }, [expandedRooms, project.id]);

  // Load mappings and users
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

        // Load all users for username lookup
        const allUsers = await getAllUsers();
        setUsers(allUsers);

        // Load floor plans for this project
        const plans = await getFloorPlansByProject(project.id);
        setFloorPlans(plans);

        // Load points for each floor plan
        const pointsMap: Record<string, FloorPlanPoint[]> = {};
        for (const plan of plans) {
          const points = await getFloorPlanPoints(plan.id);
          pointsMap[plan.id] = points;
        }
        setFloorPlanPoints(pointsMap);
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

  // Get tipologico number from ID
  const getTipologicoNumber = (tipologicoId: string): string => {
    const tipologico = project.typologies.find(t => t.id === tipologicoId);
    return tipologico ? tipologico.number.toString() : tipologicoId;
  };

  // Get username from user ID
  const getUsername = (userId: string): string => {
    const user = users.find(u => u.id === userId);
    return user ? user.username : userId;
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
            // Show custom text for "Altro" if specified
            const attraversamentoText = crossing.attraversamento === 'Altro' && crossing.attraversamentoCustom
              ? crossing.attraversamentoCustom
              : crossing.attraversamento || '-';
            row['Attraversamento'] = attraversamentoText;
            row['Quantità'] = crossing.quantita || '-';
            row['Diametro'] = crossing.diametro || '-';
            row['Dimensioni'] = crossing.dimensioni || '-';
            row['Tipologico'] = crossing.tipologicoId ? getTipologicoNumber(crossing.tipologicoId) : '-';
            row['Note'] = crossing.notes || '-';
          } else {
            row['Supporto'] = '-';
            row['Tipo supporto'] = '-';
            row['Attraversamento'] = '-';
            row['Quantità'] = '-';
            row['Diametro'] = '-';
            row['Dimensioni'] = '-';
            row['Tipologico'] = '-';
            row['Note'] = '-';
          }

          // Data and User - split date and time
          const date = new Date(mapping.timestamp);
          row['Data'] = date.toLocaleDateString('it-IT');
          row['Ora'] = date.toLocaleTimeString('it-IT');
          row['User'] = getUsername(mapping.createdBy);

          data.push(row);
        }
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);

      // Auto-size columns
      const colCount = Object.keys(data[0] || {}).length;
      ws['!cols'] = Array(colCount).fill({ wch: 15 });

      XLSX.utils.book_append_sheet(wb, ws, 'Mappings');

      // Add Tipologici sheet
      if (project.typologies && project.typologies.length > 0) {
        const tipologiciData = project.typologies.map(tip => {
          // Show custom text for "Altro" if specified
          const attraversamentoText = tip.attraversamento === 'Altro' && tip.attraversamentoCustom
            ? tip.attraversamentoCustom
            : tip.attraversamento || '-';

          return {
            'Numero': tip.number,
            'Supporto': tip.supporto || '-',
            'Tipo Supporto': tip.tipoSupporto || '-',
            'Attraversamento': attraversamentoText,
            'Marca Prodotto': tip.marcaProdottoUtilizzato || '-',
            'Prodotti Selezionati': tip.prodottiSelezionati.join(', ') || '-',
          };
        });
        const wsTipologici = XLSX.utils.json_to_sheet(tipologiciData);
        wsTipologici['!cols'] = Array(6).fill({ wch: 20 });
        XLSX.utils.book_append_sheet(wb, wsTipologici, 'Tipologici');
      }

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
            // Show custom text for "Altro" if specified
            const attraversamentoText = crossing.attraversamento === 'Altro' && crossing.attraversamentoCustom
              ? crossing.attraversamentoCustom
              : crossing.attraversamento || '-';
            row['Attraversamento'] = attraversamentoText;
            row['Quantità'] = crossing.quantita || '-';
            row['Diametro'] = crossing.diametro || '-';
            row['Dimensioni'] = crossing.dimensioni || '-';
            row['Tipologico'] = crossing.tipologicoId ? getTipologicoNumber(crossing.tipologicoId) : '-';
            row['Note'] = crossing.notes || '-';
          } else {
            row['Supporto'] = '-';
            row['Tipo supporto'] = '-';
            row['Attraversamento'] = '-';
            row['Quantità'] = '-';
            row['Diametro'] = '-';
            row['Dimensioni'] = '-';
            row['Tipologico'] = '-';
            row['Note'] = '-';
          }

          // Data and User - split date and time
          const date = new Date(mapping.timestamp);
          row['Data'] = date.toLocaleDateString('it-IT');
          row['Ora'] = date.toLocaleTimeString('it-IT');
          row['User'] = getUsername(mapping.createdBy);

          data.push(row);
        }
      }

      // Create Excel file
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      const colCount = Object.keys(data[0] || {}).length;
      ws['!cols'] = Array(colCount).fill({ wch: 15 });
      XLSX.utils.book_append_sheet(wb, ws, 'Mappings');

      // Add Tipologici sheet
      if (project.typologies && project.typologies.length > 0) {
        const tipologiciData = project.typologies.map(tip => {
          // Show custom text for "Altro" if specified
          const attraversamentoText = tip.attraversamento === 'Altro' && tip.attraversamentoCustom
            ? tip.attraversamentoCustom
            : tip.attraversamento || '-';

          return {
            'Numero': tip.number,
            'Supporto': tip.supporto || '-',
            'Tipo Supporto': tip.tipoSupporto || '-',
            'Attraversamento': attraversamentoText,
            'Marca Prodotto': tip.marcaProdottoUtilizzato || '-',
            'Prodotti Selezionati': tip.prodottiSelezionati.join(', ') || '-',
          };
        });
        const wsTipologici = XLSX.utils.json_to_sheet(tipologiciData);
        wsTipologici['!cols'] = Array(6).fill({ wch: 20 });
        XLSX.utils.book_append_sheet(wb, wsTipologici, 'Tipologici');
      }

      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      zip.file(`${project.title}_mappings.xlsx`, excelBuffer);

      // Add photos organized by Piano/Stanza hierarchy
      for (const mapping of mappings) {
        const photos = mappingPhotos[mapping.id] || [];
        const prefix = generatePhotoPrefix(mapping.floor, mapping.room, mapping.intervention);

        // Build folder path: Piano X / Stanza Y
        let folderPath = '';
        if (project.floors && project.floors.length > 1) {
          folderPath = `Piano ${mapping.floor}/`;
          if (project.useRoomNumbering && mapping.room) {
            folderPath += `Stanza ${mapping.room}/`;
          }
        } else if (project.useRoomNumbering && mapping.room) {
          folderPath = `Stanza ${mapping.room}/`;
        }

        for (let i = 0; i < photos.length; i++) {
          const photo = photos[i];
          const photoNum = (i + 1).toString().padStart(2, '0');
          const filename = `${prefix}${photoNum}.jpg`;
          const fullPath = folderPath + filename;
          zip.file(fullPath, photo.blob);
        }
      }

      // Add annotated floor plans to Planimetrie folder
      for (const plan of floorPlans) {
        const points = floorPlanPoints[plan.id] || [];

        // Only export if there are points
        if (points.length === 0) continue;

        // Generate annotated floor plan image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const img = new Image();
        const imageUrl = getFloorPlanBlobUrl(plan.imageBlob);

        // Wait for image to load using a Promise
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            // Draw points and labels (same logic as handleExportFloorPlan)
            points.forEach((point) => {
              const pointX = point.pointX * img.width;
              const pointY = point.pointY * img.height;
              const labelX = point.labelX * img.width;
              const labelY = point.labelY * img.height;

              let pointColor = '#333333';
              switch (point.pointType) {
                case 'parete': pointColor = '#0066FF'; break;
                case 'solaio': pointColor = '#00CC66'; break;
                case 'perimetro': pointColor = '#FF6600'; break;
                case 'generico': pointColor = '#9933FF'; break;
              }

              if (point.pointType === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
                ctx.strokeStyle = pointColor;
                ctx.lineWidth = 3;
                ctx.beginPath();
                const firstPoint = point.perimeterPoints[0];
                ctx.moveTo(firstPoint.x * img.width, firstPoint.y * img.height);
                for (let i = 1; i < point.perimeterPoints.length; i++) {
                  const p = point.perimeterPoints[i];
                  ctx.lineTo(p.x * img.width, p.y * img.height);
                }
                ctx.stroke();

                point.perimeterPoints.forEach(p => {
                  ctx.fillStyle = pointColor;
                  ctx.beginPath();
                  ctx.arc(p.x * img.width, p.y * img.height, 6, 0, 2 * Math.PI);
                  ctx.fill();
                  ctx.fillStyle = '#FFFFFF';
                  ctx.beginPath();
                  ctx.arc(p.x * img.width, p.y * img.height, 3, 0, 2 * Math.PI);
                  ctx.fill();
                });
              } else {
                ctx.fillStyle = pointColor;
                ctx.beginPath();
                ctx.arc(pointX, pointY, 8, 0, 2 * Math.PI);
                ctx.fill();
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 2;
                ctx.stroke();
              }

              const mappingEntry = mappings.find(m => m.id === point.mappingEntryId);
              let labelText = ['Punto'];
              if (mappingEntry) {
                // First line: Int. P0_S3_I3
                const firstLineParts = [];
                if (project.floors && project.floors.length > 1) {
                  firstLineParts.push(`P${mappingEntry.floor}`);
                }
                if (project.useRoomNumbering && mappingEntry.room) {
                  firstLineParts.push(`S${mappingEntry.room}`);
                }
                if (project.useInterventionNumbering && mappingEntry.intervention) {
                  firstLineParts.push(`I${mappingEntry.intervention}`);
                }

                // Build first line with "Int. " prefix
                const firstLine = firstLineParts.length > 0
                  ? `Int. ${firstLineParts.join('_')}`
                  : 'Punto';
                labelText = [firstLine];

                // Second line: Tip. X
                const crossingWithTypology = mappingEntry.crossings.find(c => c.tipologicoId);
                if (crossingWithTypology && crossingWithTypology.tipologicoId) {
                  const typology = project.typologies.find(t => t.id === crossingWithTypology.tipologicoId);
                  if (typology) {
                    labelText.push(`Tip. ${typology.number}`);
                  }
                }
              }

              const padding = 8;
              const fontSize = 14;
              const lineHeight = 18;
              const minWidth = 70;
              const minHeight = 36;
              ctx.font = `bold ${fontSize}px Arial`;
              const maxWidth = Math.max(...labelText.map(line => ctx.measureText(line).width));
              const labelWidth = Math.max(maxWidth + (padding * 2), minWidth);
              const labelHeight = Math.max((labelText.length * lineHeight) + (padding * 2), minHeight);

              ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
              ctx.strokeStyle = '#333333';
              ctx.lineWidth = 2;
              ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
              ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);

              ctx.fillStyle = '#000000';
              ctx.textBaseline = 'top';
              labelText.forEach((line, index) => {
                const yPos = labelY + padding + (index * lineHeight);
                let xPos = labelX + padding;

                // Check if line starts with "Int." or "Tip." and render with italic
                if (line.startsWith('Int. ')) {
                  // Draw "Int." in italic
                  ctx.font = `italic ${fontSize}px Arial`;
                  const intText = 'Int. ';
                  ctx.fillText(intText, xPos, yPos);
                  xPos += ctx.measureText(intText).width;

                  // Draw rest in bold
                  ctx.font = `bold ${fontSize}px Arial`;
                  ctx.fillText(line.substring(5), xPos, yPos);
                } else if (line.startsWith('Tip. ')) {
                  // Draw "Tip." in italic
                  ctx.font = `italic ${fontSize}px Arial`;
                  const tipText = 'Tip. ';
                  ctx.fillText(tipText, xPos, yPos);
                  xPos += ctx.measureText(tipText).width;

                  // Draw rest in bold
                  ctx.font = `bold ${fontSize}px Arial`;
                  ctx.fillText(line.substring(5), xPos, yPos);
                } else {
                  // Draw entire line in bold
                  ctx.font = `bold ${fontSize}px Arial`;
                  ctx.fillText(line, xPos, yPos);
                }
              });

              ctx.strokeStyle = '#666666';
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 5]);

              const labelCenterX = labelX + labelWidth / 2;
              const labelCenterY = labelY + labelHeight / 2;

              if (point.pointType === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
                let minDistance = Infinity;
                let closestX = pointX;
                let closestY = pointY;

                for (let i = 0; i < point.perimeterPoints.length - 1; i++) {
                  const p1 = point.perimeterPoints[i];
                  const p2 = point.perimeterPoints[i + 1];
                  const p1x = p1.x * img.width;
                  const p1y = p1.y * img.height;
                  const p2x = p2.x * img.width;
                  const p2y = p2.y * img.height;

                  const dx = p2x - p1x;
                  const dy = p2y - p1y;
                  const lengthSquared = dx * dx + dy * dy;
                  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((labelCenterX - p1x) * dx + (labelCenterY - p1y) * dy) / lengthSquared));
                  const closestOnSeg = { x: p1x + t * dx, y: p1y + t * dy };

                  const distance = Math.sqrt(
                    Math.pow(closestOnSeg.x - labelCenterX, 2) +
                    Math.pow(closestOnSeg.y - labelCenterY, 2)
                  );

                  if (distance < minDistance) {
                    minDistance = distance;
                    closestX = closestOnSeg.x;
                    closestY = closestOnSeg.y;
                  }
                }

                const edges = [
                  { x: labelCenterX, y: labelY },
                  { x: labelCenterX, y: labelY + labelHeight },
                  { x: labelX, y: labelCenterY },
                  { x: labelX + labelWidth, y: labelCenterY },
                ];

                let minEdgeDist = Infinity;
                let targetX = labelCenterX;
                let targetY = labelCenterY;

                edges.forEach(edge => {
                  const distance = Math.sqrt(
                    Math.pow(edge.x - closestX, 2) +
                    Math.pow(edge.y - closestY, 2)
                  );
                  if (distance < minEdgeDist) {
                    minEdgeDist = distance;
                    targetX = edge.x;
                    targetY = edge.y;
                  }
                });

                ctx.beginPath();
                ctx.moveTo(closestX, closestY);
                ctx.lineTo(targetX, targetY);
                ctx.stroke();
              } else {
                const edges = [
                  { x: labelCenterX, y: labelY },
                  { x: labelCenterX, y: labelY + labelHeight },
                  { x: labelX, y: labelCenterY },
                  { x: labelX + labelWidth, y: labelCenterY },
                ];

                let minDistance = Infinity;
                let targetX = labelCenterX;
                let targetY = labelCenterY;

                edges.forEach(edge => {
                  const distance = Math.sqrt(
                    Math.pow(edge.x - pointX, 2) +
                    Math.pow(edge.y - pointY, 2)
                  );
                  if (distance < minDistance) {
                    minDistance = distance;
                    targetX = edge.x;
                    targetY = edge.y;
                  }
                });

                ctx.beginPath();
                ctx.moveTo(pointX, pointY);
                ctx.lineTo(targetX, targetY);
                ctx.stroke();
              }

              ctx.setLineDash([]);
            });

            // Convert canvas to PDF blob and add to ZIP
            try {
              const canvasWidth = canvas.width;
              const canvasHeight = canvas.height;
              const aspectRatio = canvasWidth / canvasHeight;

              const pdf = new jsPDF({
                orientation: aspectRatio > 1 ? 'landscape' : 'portrait',
                unit: 'mm',
                format: 'a4'
              });

              const pdfWidth = aspectRatio > 1 ? 297 : 210;
              const pdfHeight = aspectRatio > 1 ? 210 : 297;
              const imgData = canvas.toDataURL('image/png');
              const imgAspectRatio = canvasWidth / canvasHeight;
              const pdfAspectRatio = pdfWidth / pdfHeight;

              let finalWidth = pdfWidth;
              let finalHeight = pdfHeight;
              let x = 0;
              let y = 0;

              if (imgAspectRatio > pdfAspectRatio) {
                finalHeight = pdfWidth / imgAspectRatio;
                y = (pdfHeight - finalHeight) / 2;
              } else {
                finalWidth = pdfHeight * imgAspectRatio;
                x = (pdfWidth - finalWidth) / 2;
              }

              pdf.addImage(imgData, 'PNG', x, y, finalWidth, finalHeight);
              const pdfBlob = pdf.output('blob');
              zip.file(`Planimetrie/Piano_${plan.floor}_annotato.pdf`, pdfBlob);

              resolve();
            } catch (error) {
              console.error('Error creating PDF for ZIP:', error);
              reject(error);
            }

            URL.revokeObjectURL(imageUrl);
          };

          img.src = imageUrl;
        });
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

  // Handle open floor plan editor
  const handleOpenFloorPlanEditor = async (floorPlanId: string) => {
    const plan = floorPlans.find(p => p.id === floorPlanId);
    if (!plan) return;

    try {
      // Get all points for this floor plan
      const points = floorPlanPoints[plan.id] || [];

      // Get IDs of mapping entries that are already placed on this floor plan
      const placedMappingIds = new Set(points.map(p => p.mappingEntryId).filter(Boolean));

      // Find unmapped entries for this floor
      const unmappedEntries: UnmappedEntry[] = mappings
        .filter(m => {
          // Match floor
          if (m.floor !== plan.floor) return false;
          // Not already placed on this floor plan
          if (placedMappingIds.has(m.id)) return false;
          return true;
        })
        .map(m => {
          // Build label text for unmapped entry
          const firstLineParts = [];
          if (project.floors && project.floors.length > 1) {
            firstLineParts.push(`P${m.floor}`);
          }
          if (project.useRoomNumbering && m.room) {
            firstLineParts.push(`S${m.room}`);
          }
          if (project.useInterventionNumbering && m.intervention) {
            firstLineParts.push(`I${m.intervention}`);
          }

          const firstLine = firstLineParts.length > 0
            ? `Int. ${firstLineParts.join('_')}`
            : 'Punto';
          const labelText = [firstLine];

          // Add typology if exists
          const crossingWithTypology = m.crossings.find(c => c.tipologicoId);
          if (crossingWithTypology && crossingWithTypology.tipologicoId) {
            const typology = project.typologies.find(t => t.id === crossingWithTypology.tipologicoId);
            if (typology) {
              labelText.push(`Tip. ${typology.number}`);
            }
          }

          // Default to parete, user can choose when placing
          return {
            id: m.id,
            labelText,
            type: 'parete' as 'parete' | 'solaio',
          };
        });

      // Convert FloorPlanPoint[] to CanvasPoint[]
      const canvasPoints: CanvasPoint[] = await Promise.all(
        points.map(async (point) => {
          // Get mapping entry to get label text
          const mappingEntry = mappings.find(m => m.id === point.mappingEntryId);
          let labelText = ['Punto'];
          if (mappingEntry) {
            // First line: Int. P0_S3_I3
            const firstLineParts = [];
            if (project.floors && project.floors.length > 1) {
              firstLineParts.push(`P${mappingEntry.floor}`);
            }
            if (project.useRoomNumbering && mappingEntry.room) {
              firstLineParts.push(`S${mappingEntry.room}`);
            }
            if (project.useInterventionNumbering && mappingEntry.intervention) {
              firstLineParts.push(`I${mappingEntry.intervention}`);
            }

            // Build first line with "Int. " prefix
            const firstLine = firstLineParts.length > 0
              ? `Int. ${firstLineParts.join('_')}`
              : 'Punto';
            labelText = [firstLine];

            // Second line: Tip. X
            const crossingWithTypology = mappingEntry.crossings.find(c => c.tipologicoId);
            if (crossingWithTypology && crossingWithTypology.tipologicoId) {
              const typology = project.typologies.find(t => t.id === crossingWithTypology.tipologicoId);
              if (typology) {
                labelText.push(`Tip. ${typology.number}`);
              }
            }
          }

          return {
            id: point.id,
            type: point.pointType,
            pointX: point.pointX,
            pointY: point.pointY,
            labelX: point.labelX,
            labelY: point.labelY,
            labelText: labelText,
            perimeterPoints: point.perimeterPoints,
            mappingEntryId: point.mappingEntryId, // Include to distinguish existing points from new ones
          };
        })
      );

      // Create blob URL for the image
      const imageUrl = getFloorPlanBlobUrl(plan.imageBlob);

      setEditorFloorPlan(plan);
      setEditorImageUrl(imageUrl);
      setEditorPoints(canvasPoints);
      setEditorUnmappedEntries(unmappedEntries);
      setShowFloorPlanEditor(true);
    } catch (error) {
      console.error('Error opening floor plan editor:', error);
      alert('Errore durante l\'apertura dell\'editor planimetria');
    }
  };

  // Handle close floor plan editor
  const handleCloseFloorPlanEditor = () => {
    if (editorImageUrl) {
      URL.revokeObjectURL(editorImageUrl);
    }
    setShowFloorPlanEditor(false);
    setEditorFloorPlan(null);
    setEditorImageUrl(null);
    setEditorPoints([]);
    setEditorUnmappedEntries([]);
  };

  // Handle save floor plan editor changes
  const handleSaveFloorPlanEditor = async (points: CanvasPoint[], gridConfig: GridConfig) => {
    if (!editorFloorPlan) return;

    try {
      const currentPoints = floorPlanPoints[editorFloorPlan.id] || [];
      const currentPointIds = new Set(currentPoints.map(p => p.id));
      const newPointIds = new Set(points.map(p => p.id));

      // Update existing points (position changes of labels and points)
      for (const canvasPoint of points) {
        if (currentPointIds.has(canvasPoint.id)) {
          // Update existing point
          await updateFloorPlanPoint(canvasPoint.id, {
            pointX: canvasPoint.pointX,
            pointY: canvasPoint.pointY,
            labelX: canvasPoint.labelX,
            labelY: canvasPoint.labelY,
            perimeterPoints: canvasPoint.perimeterPoints,
          });
        } else {
          // Create new point
          if (canvasPoint.mappingEntryId) {
            // New point linked to a mapping entry (positioned from unmapped entries)
            await createFloorPlanPoint(
              editorFloorPlan.id,
              canvasPoint.mappingEntryId,
              canvasPoint.type,
              canvasPoint.pointX,
              canvasPoint.pointY,
              canvasPoint.labelX,
              canvasPoint.labelY,
              currentUser.id,
              {
                perimeterPoints: canvasPoint.perimeterPoints,
              }
            );
          } else if (canvasPoint.type === 'generico' || canvasPoint.type === 'perimetro') {
            // Create a new standalone point (generico or perimetro without mapping entry)
            await createFloorPlanPoint(
              editorFloorPlan.id,
              '', // No mapping entry - standalone point
              canvasPoint.type,
              canvasPoint.pointX,
              canvasPoint.pointY,
              canvasPoint.labelX,
              canvasPoint.labelY,
              currentUser.id,
              {
                perimeterPoints: canvasPoint.perimeterPoints,
                customText: canvasPoint.customText,
              }
            );
          }
        }
      }

      // Delete removed points
      for (const existingPoint of currentPoints) {
        if (!newPointIds.has(existingPoint.id)) {
          await deleteFloorPlanPoint(existingPoint.id);
        }
      }

      // Refresh floor plan points
      const pointsMap: Record<string, FloorPlanPoint[]> = {};
      for (const plan of floorPlans) {
        const points = await getFloorPlanPoints(plan.id);
        pointsMap[plan.id] = points;
      }
      setFloorPlanPoints(pointsMap);

      alert('Modifiche salvate con successo!');
      handleCloseFloorPlanEditor();
    } catch (error) {
      console.error('Error saving floor plan changes:', error);
      alert('Errore durante il salvataggio delle modifiche');
    }
  };

  // Export floor plan with points as image
  const handleExportFloorPlan = async (plan: FloorPlan) => {
    try {
      const points = floorPlanPoints[plan.id] || [];

      // Create canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Load image
      const img = new Image();
      const imageUrl = getFloorPlanBlobUrl(plan.imageBlob);

      img.onload = () => {
        // Set canvas size to image size
        canvas.width = img.width;
        canvas.height = img.height;

        // Draw image
        ctx.drawImage(img, 0, 0);

        // Draw points and labels
        points.forEach((point) => {
          const pointX = point.pointX * img.width;
          const pointY = point.pointY * img.height;
          const labelX = point.labelX * img.width;
          const labelY = point.labelY * img.height;

          // Get point color based on type
          let pointColor = '#333333';
          switch (point.pointType) {
            case 'parete':
              pointColor = '#0066FF';
              break;
            case 'solaio':
              pointColor = '#00CC66';
              break;
            case 'perimetro':
              pointColor = '#FF6600';
              break;
            case 'generico':
              pointColor = '#9933FF';
              break;
          }

          // Draw perimeter if exists
          if (point.pointType === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
            ctx.strokeStyle = pointColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            const firstPoint = point.perimeterPoints[0];
            ctx.moveTo(firstPoint.x * img.width, firstPoint.y * img.height);
            for (let i = 1; i < point.perimeterPoints.length; i++) {
              const p = point.perimeterPoints[i];
              ctx.lineTo(p.x * img.width, p.y * img.height);
            }
            ctx.stroke();

            // Draw vertices
            point.perimeterPoints.forEach(p => {
              ctx.fillStyle = pointColor;
              ctx.beginPath();
              ctx.arc(p.x * img.width, p.y * img.height, 6, 0, 2 * Math.PI);
              ctx.fill();
              ctx.fillStyle = '#FFFFFF';
              ctx.beginPath();
              ctx.arc(p.x * img.width, p.y * img.height, 3, 0, 2 * Math.PI);
              ctx.fill();
            });
          } else {
            // Draw point marker
            ctx.fillStyle = pointColor;
            ctx.beginPath();
            ctx.arc(pointX, pointY, 8, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          // Get label text from mapping entry
          const mappingEntry = mappings.find(m => m.id === point.mappingEntryId);
          let labelText = ['Punto'];
          if (mappingEntry) {
            // First line: Int. P0_S3_I3
            const firstLineParts = [];
            if (project.floors && project.floors.length > 1) {
              firstLineParts.push(`P${mappingEntry.floor}`);
            }
            if (project.useRoomNumbering && mappingEntry.room) {
              firstLineParts.push(`S${mappingEntry.room}`);
            }
            if (project.useInterventionNumbering && mappingEntry.intervention) {
              firstLineParts.push(`I${mappingEntry.intervention}`);
            }

            // Build first line with "Int. " prefix
            const firstLine = firstLineParts.length > 0
              ? `Int. ${firstLineParts.join('_')}`
              : 'Punto';
            labelText = [firstLine];

            // Second line: Tip. X
            const crossingWithTypology = mappingEntry.crossings.find(c => c.tipologicoId);
            if (crossingWithTypology && crossingWithTypology.tipologicoId) {
              const typology = project.typologies.find(t => t.id === crossingWithTypology.tipologicoId);
              if (typology) {
                labelText.push(`Tip. ${typology.number}`);
              }
            }
          }

          // Draw label
          const padding = 8;
          const fontSize = 14;
          const lineHeight = 18;
          const minWidth = 70;
          const minHeight = 36;
          ctx.font = `bold ${fontSize}px Arial`;
          const maxWidth = Math.max(...labelText.map(line => ctx.measureText(line).width));
          const labelWidth = Math.max(maxWidth + (padding * 2), minWidth);
          const labelHeight = Math.max((labelText.length * lineHeight) + (padding * 2), minHeight);

          ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
          ctx.strokeStyle = '#333333';
          ctx.lineWidth = 2;
          ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
          ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);

          ctx.fillStyle = '#000000';
          ctx.textBaseline = 'top';
          labelText.forEach((line, index) => {
            const yPos = labelY + padding + (index * lineHeight);
            let xPos = labelX + padding;

            // Check if line starts with "Int." or "Tip." and render with italic
            if (line.startsWith('Int. ')) {
              // Draw "Int." in italic
              ctx.font = `italic ${fontSize}px Arial`;
              const intText = 'Int. ';
              ctx.fillText(intText, xPos, yPos);
              xPos += ctx.measureText(intText).width;

              // Draw rest in bold
              ctx.font = `bold ${fontSize}px Arial`;
              ctx.fillText(line.substring(5), xPos, yPos);
            } else if (line.startsWith('Tip. ')) {
              // Draw "Tip." in italic
              ctx.font = `italic ${fontSize}px Arial`;
              const tipText = 'Tip. ';
              ctx.fillText(tipText, xPos, yPos);
              xPos += ctx.measureText(tipText).width;

              // Draw rest in bold
              ctx.font = `bold ${fontSize}px Arial`;
              ctx.fillText(line.substring(5), xPos, yPos);
            } else {
              // Draw entire line in bold
              ctx.font = `bold ${fontSize}px Arial`;
              ctx.fillText(line, xPos, yPos);
            }
          });

          // Draw connecting line
          ctx.strokeStyle = '#666666';
          ctx.lineWidth = 2; // Increased from 1 to 2
          ctx.setLineDash([5, 5]); // Increased dash pattern for visibility

          const labelCenterX = labelX + labelWidth / 2;
          const labelCenterY = labelY + labelHeight / 2;

          if (point.pointType === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
            // Find closest point on perimeter to label
            let minDistance = Infinity;
            let closestX = pointX;
            let closestY = pointY;

            for (let i = 0; i < point.perimeterPoints.length - 1; i++) {
              const p1 = point.perimeterPoints[i];
              const p2 = point.perimeterPoints[i + 1];
              const p1x = p1.x * img.width;
              const p1y = p1.y * img.height;
              const p2x = p2.x * img.width;
              const p2y = p2.y * img.height;

              // Find closest point on segment
              const dx = p2x - p1x;
              const dy = p2y - p1y;
              const lengthSquared = dx * dx + dy * dy;
              const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((labelCenterX - p1x) * dx + (labelCenterY - p1y) * dy) / lengthSquared));
              const closestOnSeg = { x: p1x + t * dx, y: p1y + t * dy };

              const distance = Math.sqrt(
                Math.pow(closestOnSeg.x - labelCenterX, 2) +
                Math.pow(closestOnSeg.y - labelCenterY, 2)
              );

              if (distance < minDistance) {
                minDistance = distance;
                closestX = closestOnSeg.x;
                closestY = closestOnSeg.y;
              }
            }

            // Find closest edge on label
            const edges = [
              { x: labelCenterX, y: labelY },
              { x: labelCenterX, y: labelY + labelHeight },
              { x: labelX, y: labelCenterY },
              { x: labelX + labelWidth, y: labelCenterY },
            ];

            let minEdgeDist = Infinity;
            let targetX = labelCenterX;
            let targetY = labelCenterY;

            edges.forEach(edge => {
              const distance = Math.sqrt(
                Math.pow(edge.x - closestX, 2) +
                Math.pow(edge.y - closestY, 2)
              );
              if (distance < minEdgeDist) {
                minEdgeDist = distance;
                targetX = edge.x;
                targetY = edge.y;
              }
            });

            ctx.beginPath();
            ctx.moveTo(closestX, closestY);
            ctx.lineTo(targetX, targetY);
            ctx.stroke();
          } else {
            // Find closest edge on label from point
            const edges = [
              { x: labelCenterX, y: labelY },
              { x: labelCenterX, y: labelY + labelHeight },
              { x: labelX, y: labelCenterY },
              { x: labelX + labelWidth, y: labelCenterY },
            ];

            let minDistance = Infinity;
            let targetX = labelCenterX;
            let targetY = labelCenterY;

            edges.forEach(edge => {
              const distance = Math.sqrt(
                Math.pow(edge.x - pointX, 2) +
                Math.pow(edge.y - pointY, 2)
              );
              if (distance < minDistance) {
                minDistance = distance;
                targetX = edge.x;
                targetY = edge.y;
              }
            });

            ctx.beginPath();
            ctx.moveTo(pointX, pointY);
            ctx.lineTo(targetX, targetY);
            ctx.stroke();
          }

          ctx.setLineDash([]);
        });

        // Export as PDF
        try {
          exportCanvasToPDF(canvas, `Piano_${plan.floor}_annotato.pdf`);
          alert('✅ Planimetria esportata in PDF');
        } catch (error) {
          console.error('Export PDF error:', error);
          alert('❌ Errore durante l\'esportazione PDF');
        }

        // Clean up
        URL.revokeObjectURL(imageUrl);
      };

      img.src = imageUrl;
    } catch (error) {
      console.error('Failed to export floor plan:', error);
      alert('Errore durante l\'esportazione della planimetria');
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
            Export Completo
          </button>
        </div>

        {/* Floor Plans Section */}
        {floorPlans.length > 0 && (
          <div className="floor-plans-section">
            <div className="floor-plans-controls">
              <div className="floor-plan-selector">
                <label className="control-label">
                  <MapIcon className="icon-inline" />
                  Planimetria:
                </label>
                <select
                  value={selectedFloorPlan}
                  onChange={(e) => setSelectedFloorPlan(e.target.value)}
                  className="floor-plan-select"
                >
                  <option value="">Seleziona piano...</option>
                  {floorPlans.map((plan) => {
                    const points = floorPlanPoints[plan.id] || [];
                    return (
                      <option key={plan.id} value={plan.id}>
                        Piano {plan.floor} ({points.length} {points.length === 1 ? 'punto' : 'punti'})
                      </option>
                    );
                  })}
                </select>
              </div>
              {selectedFloorPlan && (
                <div className="floor-plan-actions">
                  <button
                    className="floor-plan-action-btn view"
                    onClick={() => handleOpenFloorPlanEditor(selectedFloorPlan)}
                    title="Visualizza/Modifica planimetria"
                  >
                    <EyeIcon className="icon" />
                    Visualizza
                  </button>
                  <button
                    className="floor-plan-action-btn export"
                    onClick={() => {
                      const plan = floorPlans.find(p => p.id === selectedFloorPlan);
                      if (plan) handleExportFloorPlan(plan);
                    }}
                    title="Esporta planimetria con punti"
                  >
                    <DownloadIcon className="icon" />
                    Esporta
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

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
                                <strong>Attraversamento:</strong> {
                                  sig.attraversamento === 'Altro' && sig.attraversamentoCustom
                                    ? sig.attraversamentoCustom
                                    : sig.attraversamento || 'N/A'
                                }<br />
                                {sig.tipologicoId && (
                                  <><strong>Tipologico:</strong> {getTipologicoNumber(sig.tipologicoId)}<br /></>
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
                                                          <strong>Attraversamento:</strong> {
                                  sig.attraversamento === 'Altro' && sig.attraversamentoCustom
                                    ? sig.attraversamentoCustom
                                    : sig.attraversamento || 'N/A'
                                }<br />
                                                          {sig.tipologicoId && (
                                                            <><strong>Tipologico:</strong> {getTipologicoNumber(sig.tipologicoId)}<br /></>
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

      {/* Floor Plan Editor Modal */}
      {showFloorPlanEditor && editorImageUrl && editorFloorPlan && (
        <div className="floor-plan-editor-overlay">
          <FloorPlanEditor
            imageUrl={editorImageUrl}
            initialPoints={editorPoints}
            initialGridConfig={{
              enabled: false,
              rows: 10,
              cols: 10,
              offsetX: 0,
              offsetY: 0,
            }}
            mode="view-edit"
            unmappedEntries={editorUnmappedEntries}
            onSave={handleSaveFloorPlanEditor}
            onClose={handleCloseFloorPlanEditor}
          />
        </div>
      )}
    </div>
  );
};

export default MappingView;
