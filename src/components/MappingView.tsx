import React, { useState, useEffect, useRef } from 'react';
import NavigationBar from './NavigationBar';
import FloorPlanEditor, { UnmappedEntry } from './FloorPlanEditor';
import PhotoPreviewModal from './PhotoPreviewModal';
import type { CanvasPoint, GridConfig } from './FloorPlanCanvas';
import {
  Project,
  MappingEntry,
  Photo,
  User,
  getMappingEntriesForProject,
  getPhotosForMapping,
  deleteMappingEntry,
  updateMappingEntry,
  getAllUsers,
  FloorPlan,
  FloorPlanPoint,
  getFloorPlansByProject,
  getFloorPlanPoints,
  getFloorPlanBlobUrl,
  updateFloorPlan,
  updateFloorPlanPoint,
  updateFloorPlanLabelsForMapping,
  createFloorPlanPoint,
  deleteFloorPlanPoint,
} from '../db';
import { useMappingExports } from './useMappingExports';
import { useDropdownOptions } from '../hooks/useDropdownOptions';
import {
  DownloadIcon, PlusIcon, EyeIcon,
  SortAscIcon, SortDescIcon, FolderIcon, ChevronDownIcon, ChevronRightIcon, MapIcon
} from './icons/MappingViewIcons';
import MappingEntryCard from './MappingEntryCard';
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
  const SUPPORTO_OPTIONS = useDropdownOptions('supporto');
  const ATTRAVERSAMENTO_OPTIONS = useDropdownOptions('attraversamento');

  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMapping, setSelectedMapping] = useState<string | null>(null);
  const [mappingPhotos, setMappingPhotos] = useState<Record<string, Photo[]>>({});
  const [users, setUsers] = useState<User[]>([]);

  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [floorPlanPoints, setFloorPlanPoints] = useState<Record<string, FloorPlanPoint[]>>({});
  const [selectedFloorPlan, setSelectedFloorPlan] = useState<string>('');
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<{ url: string; alt: string } | null>(null);

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
  const [showOnlyToComplete, setShowOnlyToComplete] = useState<boolean>(() => {
    const saved = localStorage.getItem(`mappingView_${project.id}_showOnlyToComplete`);
    return saved === 'true';
  });
  const [filtersExpanded, setFiltersExpanded] = useState<boolean>(() => {
    const saved = localStorage.getItem(`mappingView_${project.id}_filtersExpanded`);
    return saved === null ? true : saved === 'true';
  });
  const [filterTipologico, setFilterTipologico] = useState<string>(() => {
    return localStorage.getItem(`mappingView_${project.id}_filterTipologico`) || '';
  });
  const [filterSupporto, setFilterSupporto] = useState<string>(() => {
    return localStorage.getItem(`mappingView_${project.id}_filterSupporto`) || '';
  });
  const [filterAttraversamento, setFilterAttraversamento] = useState<string>(() => {
    return localStorage.getItem(`mappingView_${project.id}_filterAttraversamento`) || '';
  });
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(`mappingView_${project.id}_expandedFloors`);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(() => {
    const saved = localStorage.getItem(`mappingView_${project.id}_expandedRooms`);
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  // Track previous syncing state to detect when sync completes
  const prevIsSyncingRef = useRef<boolean>(false);

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
    localStorage.setItem(`mappingView_${project.id}_showOnlyToComplete`, String(showOnlyToComplete));
  }, [showOnlyToComplete, project.id]);

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

        // Load floor plans for this project and sort by floor number
        const plans = await getFloorPlansByProject(project.id);
        const sortedPlans = plans.sort((a, b) => {
          const floorA = parseFloat(a.floor);
          const floorB = parseFloat(b.floor);
          return floorA - floorB;
        });
        setFloorPlans(sortedPlans);

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

  // Reload floor plans after sync completes
  useEffect(() => {
    const currentIsSyncing = isSyncing ?? false;

    // Check if sync just completed (was true, now false)
    if (prevIsSyncingRef.current === true && currentIsSyncing === false) {
      // Sync just completed, reload floor plans and points
      const reloadAfterSync = async () => {
        try {
          console.log('🔄 Sync completed, reloading floor plans...');
          const plans = await getFloorPlansByProject(project.id);
          const sortedPlans = plans.sort((a, b) => {
            const floorA = parseFloat(a.floor);
            const floorB = parseFloat(b.floor);
            return floorA - floorB;
          });
          setFloorPlans(sortedPlans);

          // Reload points for each floor plan
          const pointsMap: Record<string, FloorPlanPoint[]> = {};
          for (const plan of plans) {
            const points = await getFloorPlanPoints(plan.id);
            pointsMap[plan.id] = points;
          }
          setFloorPlanPoints(pointsMap);

          // Also reload mappings in case they changed
          const entries = await getMappingEntriesForProject(project.id);
          setMappings(entries);

          console.log('✅ Floor plans and mappings reloaded after sync');
        } catch (error) {
          console.error('Failed to reload floor plans after sync:', error);
        }
      };

      // Small delay to ensure sync has fully completed
      const timer = setTimeout(reloadAfterSync, 500);

      // Cleanup timeout on unmount
      return () => clearTimeout(timer);
    }

    // Update ref for next render
    prevIsSyncingRef.current = currentIsSyncing;
  }, [isSyncing, project.id]);

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
            const roomA = parseInt(a.room || '') || (a.room || '');
            const roomB = parseInt(b.room || '') || (b.room || '');
            if (typeof roomA === 'number' && typeof roomB === 'number') {
              comparison = roomA - roomB;
            } else {
              comparison = String(roomA).localeCompare(String(roomB));
            }
            if (comparison === 0) {
              const intA = parseInt(a.intervention || '') || (a.intervention || '');
              const intB = parseInt(b.intervention || '') || (b.intervention || '');
              if (typeof intA === 'number' && typeof intB === 'number') {
                comparison = intA - intB;
              } else {
                comparison = String(intA).localeCompare(String(intB));
              }
            }
          }
          break;
        }
        case 'room': {
          const roomA = parseInt(a.room || '') || (a.room || '');
          const roomB = parseInt(b.room || '') || (b.room || '');
          if (typeof roomA === 'number' && typeof roomB === 'number') {
            comparison = roomA - roomB;
          } else {
            comparison = String(roomA).localeCompare(String(roomB));
          }
          // Secondary sort by floor and intervention
          if (comparison === 0) {
            const floorA = parseInt(a.floor) || a.floor;
            const floorB = parseInt(b.floor) || b.floor;
            if (typeof floorA === 'number' && typeof floorB === 'number') {
              comparison = floorA - floorB;
            } else {
              comparison = String(floorA).localeCompare(String(floorB));
            }
            if (comparison === 0) {
              const intA = parseInt(a.intervention || '') || (a.intervention || '');
              const intB = parseInt(b.intervention || '') || (b.intervention || '');
              if (typeof intA === 'number' && typeof intB === 'number') {
                comparison = intA - intB;
              } else {
                comparison = String(intA).localeCompare(String(intB));
              }
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
        const roomA = parseInt(a) || a;
        const roomB = parseInt(b) || b;
        if (typeof roomA === 'number' && typeof roomB === 'number') {
          return sortOrder === 'asc' ? roomA - roomB : roomB - roomA;
        }
        return sortOrder === 'asc' ? String(roomA).localeCompare(String(roomB)) : String(roomB).localeCompare(String(roomA));
      });

      const roomGroups = rooms.map(room => {
        const interventionMap = roomMap.get(room)!;
        const interventions = Array.from(interventionMap.keys()).sort((a, b) => {
          const intA = parseInt(a) || a;
          const intB = parseInt(b) || b;
          if (typeof intA === 'number' && typeof intB === 'number') {
            return sortOrder === 'asc' ? intA - intB : intB - intA;
          }
          return sortOrder === 'asc' ? String(intA).localeCompare(String(intB)) : String(intB).localeCompare(String(intA));
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

  // Apply advanced filters
  let advancedFilteredMappings = sortedMappings;

  if (filterTipologico) {
    advancedFilteredMappings = advancedFilteredMappings.filter(m =>
      m.crossings.some(c => c.tipologicoId === filterTipologico)
    );
  }

  if (filterSupporto) {
    advancedFilteredMappings = advancedFilteredMappings.filter(m =>
      m.crossings.some(c => c.supporto === filterSupporto)
    );
  }

  if (filterAttraversamento) {
    advancedFilteredMappings = advancedFilteredMappings.filter(m =>
      m.crossings.some(c => c.attraversamento === filterAttraversamento)
    );
  }

  // Apply "Da Completare" filter if enabled
  const filteredMappings = showOnlyToComplete
    ? advancedFilteredMappings.filter(mapping => mapping.toComplete === true)
    : advancedFilteredMappings;

  const hierarchicalGroups = groupMappingsHierarchically(filteredMappings);

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

  // Generate mapping label for floor plan canvas
  const generateMappingLabel = (
    mappingEntry: MappingEntry,
    photoCount: number
  ): string[] => {
    const labelText: string[] = [];
    const firstLineParts: string[] = [];

    // Piano (only if multiple floors)
    if (project.floors && project.floors.length > 1) {
      firstLineParts.push(`P${mappingEntry.floor}`);
    }

    // Stanza (if room numbering is enabled)
    if (project.useRoomNumbering && mappingEntry.room) {
      firstLineParts.push(`S${mappingEntry.room}`);
    }

    // Intervento (changed from "I" to "Int")
    if (project.useInterventionNumbering && mappingEntry.intervention) {
      firstLineParts.push(`Int${mappingEntry.intervention}`);
    }

    // Handle photo numbering - OPTION B: Range if multiple photos
    if (firstLineParts.length > 0) {
      let firstLine = firstLineParts.join('_');

      // Add range if more than 1 photo
      if (photoCount > 1) {
        const lastPhotoNumber = photoCount.toString().padStart(2, '0');
        firstLine += `_01-${lastPhotoNumber}`;
      }

      labelText.push(firstLine);
    } else {
      labelText.push('Punto');
    }

    // Second line: Tip. X - get all unique tipologici, sorted
    const tipNumbers = mappingEntry.crossings
      .map(c => {
        if (c.tipologicoId) {
          const tip = project.typologies.find(t => t.id === c.tipologicoId);
          return tip ? tip.number : null;
        }
        return null;
      })
      .filter((n): n is number => n !== null)
      .filter((value, index, self) => self.indexOf(value) === index)
      .sort((a, b) => a - b);

    if (tipNumbers.length > 0) {
      labelText.push(`Tip. ${tipNumbers.join(' - ')}`);
    }

    return labelText;
  };

  // ---- Export handlers (logica in useMappingExports.ts) ----
  const {
    isExporting,
    isUpdatingLabels,
    handleExportExcel,
    handleExportZip,
    handleExportFloorPlan,
    handleUpdateAllLabels,
  } = useMappingExports({
    project,
    mappings,
    mappingPhotos,
    users,
    floorPlans,
    floorPlanPoints,
    setFloorPlanPoints,
    getTipologicoNumber,
    generatePhotoPrefix,
    getUsername,
    generateMappingLabel,
  });

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
      // Check if imageBlob is available
      if (!plan.imageBlob) {
        // If no blob but we have an imageUrl, try to fetch it
        if (plan.imageUrl) {
          alert('La planimetria deve essere scaricata da Supabase. Prova a sincronizzare il progetto e riprova.');
        } else {
          alert('Errore: immagine della planimetria non disponibile. Prova a ricaricare la planimetria.');
        }
        return;
      }

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
          const photos = mappingPhotos[m.id] || [];
          const labelText = generateMappingLabel(m, photos.length);

          // Get type from first crossing's supporto field
          let type: 'parete' | 'solaio' = 'parete'; // Default
          if (m.crossings && m.crossings.length > 0) {
            const supporto = m.crossings[0].supporto?.toLowerCase();
            if (supporto === 'solaio') {
              type = 'solaio';
            }
            // Se supporto è "parete" o altro, rimane 'parete' (default)
          }

          return {
            id: m.id,
            labelText,
            type,
          };
        });

      // Convert FloorPlanPoint[] to CanvasPoint[]
      const canvasPoints: CanvasPoint[] = await Promise.all(
        points.map(async (point) => {
          // Get mapping entry to get label text
          const mappingEntry = mappings.find(m => m.id === point.mappingEntryId);
          let labelText = ['Punto'];
          if (mappingEntry) {
            const photos = mappingPhotos[mappingEntry.id] || [];
            labelText = generateMappingLabel(mappingEntry, photos.length);
          }

          return {
            id: point.id,
            type: point.pointType,
            pointX: point.pointX,
            pointY: point.pointY,
            labelX: point.labelX,
            labelY: point.labelY,
            labelText: mappingEntry ? labelText : (point.metadata?.labelText || labelText), // Per punti con mapping, usa sempre il label rigenerato
            perimeterPoints: point.perimeterPoints,
            mappingEntryId: point.mappingEntryId, // Include to distinguish existing points from new ones
            labelBackgroundColor: point.metadata?.labelBackgroundColor, // Carica anche colore custom
            labelTextColor: point.metadata?.labelTextColor, // Carica anche colore testo custom
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
      // Save grid configuration to floor plan
      await updateFloorPlan(editorFloorPlan.id, {
        gridEnabled: gridConfig.enabled,
        gridConfig: {
          rows: gridConfig.rows,
          cols: gridConfig.cols,
          offsetX: gridConfig.offsetX,
          offsetY: gridConfig.offsetY,
        }
      });

      const currentPoints = floorPlanPoints[editorFloorPlan.id] || [];
      const currentPointIds = new Set(currentPoints.map(p => p.id));
      const newPointIds = new Set(points.map(p => p.id));

      // Update existing points (position changes of labels and points)
      for (const canvasPoint of points) {
        if (currentPointIds.has(canvasPoint.id)) {
          // Update existing point
          const currentPoint = currentPoints.find(p => p.id === canvasPoint.id);
          await updateFloorPlanPoint(canvasPoint.id, {
            pointX: canvasPoint.pointX,
            pointY: canvasPoint.pointY,
            labelX: canvasPoint.labelX,
            labelY: canvasPoint.labelY,
            perimeterPoints: canvasPoint.perimeterPoints,
            metadata: {
              ...currentPoint?.metadata,
              labelText: canvasPoint.labelText, // Salva labelText custom
              labelBackgroundColor: canvasPoint.labelBackgroundColor, // Salva anche colore custom
              labelTextColor: canvasPoint.labelTextColor, // Salva anche colore testo custom
            },
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
    } catch (error) {
      console.error('Error saving floor plan changes:', error);
      alert('Errore durante il salvataggio delle modifiche');
    }
  };

  // Handle reorder points: assign sequential intervention numbers grouped by room, sorted by X
  const handleReorderPoints = async (sortedMappingEntryIds: string[]): Promise<CanvasPoint[]> => {
    if (!editorFloorPlan) return editorPoints;

    try {
      const updatedMappingsMap = new Map<string, MappingEntry>();

      // Group IDs by room (preserving left-to-right X order within each group)
      const roomGroups: Record<string, string[]> = {};
      for (const id of sortedMappingEntryIds) {
        const mapping = mappings.find(m => m.id === id);
        const roomKey = mapping?.room ?? '';
        if (!roomGroups[roomKey]) roomGroups[roomKey] = [];
        roomGroups[roomKey].push(id);
      }

      // Assign intervention numbers per room (each room restarts from 1)
      const interventionMap: Record<string, string> = {};
      Object.values(roomGroups).forEach(ids => {
        ids.forEach((id, index) => { interventionMap[id] = (index + 1).toString(); });
      });

      // Update each MappingEntry in DB with the assigned intervention number
      for (const id of Object.keys(interventionMap)) {
        try {
          const updated = await updateMappingEntry(id, { intervention: interventionMap[id] }, currentUser.id);
          updatedMappingsMap.set(id, updated);
        } catch (err) {
          console.error(`Failed to update intervention for ${id}:`, err);
        }
      }

      // Update local mappings state
      setMappings(prev => prev.map(m => updatedMappingsMap.get(m.id) ?? m));

      // Update floor plan point labels for each renamed mapping
      for (const entry of Array.from(updatedMappingsMap.entries())) {
        const [id, updatedMapping] = entry;
        const photos = mappingPhotos[id] || [];
        try {
          await updateFloorPlanLabelsForMapping(id, () => generateMappingLabel(updatedMapping, photos.length));
        } catch (err) {
          console.error(`Failed to update floor plan label for ${id}:`, err);
        }
      }

      // Rebuild CanvasPoint[] with updated labelText, preserving positions and colors
      const updatedCanvasPoints: CanvasPoint[] = editorPoints.map(cp => {
        if (!cp.mappingEntryId) return cp;
        const updatedMapping = updatedMappingsMap.get(cp.mappingEntryId);
        if (!updatedMapping) return cp;
        const photos = mappingPhotos[cp.mappingEntryId] || [];
        return { ...cp, labelText: generateMappingLabel(updatedMapping, photos.length) };
      });

      // Update editorPoints and refresh DB points for consistency
      setEditorPoints(updatedCanvasPoints);
      const freshDbPoints = await getFloorPlanPoints(editorFloorPlan.id);
      setFloorPlanPoints(prev => ({ ...prev, [editorFloorPlan!.id]: freshDbPoints }));

      return updatedCanvasPoints;
    } catch (error) {
      console.error('Error in handleReorderPoints:', error);
      alert('Errore durante il riordino dei punti.');
      return editorPoints;
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
          <button
            className="export-btn"
            onClick={handleUpdateAllLabels}
            disabled={isUpdatingLabels || mappings.length === 0 || floorPlans.length === 0}
            title="Aggiorna tutte le etichette sulla planimetria con i dati più recenti"
          >
            <svg className="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21.5 2V8H15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M3 12C3 13.1819 3.23279 14.3522 3.68508 15.4442C4.13738 16.5361 4.80031 17.5282 5.63604 18.364C6.47177 19.1997 7.46392 19.8626 8.55585 20.3149C9.64778 20.7672 10.8181 21 12 21C13.1819 21 14.3522 20.7672 15.4442 20.3149C16.5361 19.8626 17.5282 19.1997 18.364 18.364C19.1997 17.5282 19.8626 16.5361 20.3149 15.4442C20.7672 14.3522 21 13.1819 21 12C21 10.8181 20.7672 9.64778 20.3149 8.55585C19.8626 7.46392 19.1997 6.47177 18.364 5.63604" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {isUpdatingLabels ? 'Aggiornamento...' : 'Aggiorna Etichette'}
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
          <div className="filter-section">
            <div className="filter-header" onClick={() => {
              const newValue = !filtersExpanded;
              setFiltersExpanded(newValue);
              localStorage.setItem(`mappingView_${project.id}_filtersExpanded`, String(newValue));
            }}>
              <h3>Filtri e Ordinamento</h3>
              <button className="collapse-toggle" onClick={(e) => e.stopPropagation()}>
                {filtersExpanded ? '▲' : '▼'}
              </button>
            </div>

            {filtersExpanded && (
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

                <div className="filter-status-controls">
                  <label className="control-label">Filtra:</label>
                  <div className="button-group">
                    <button
                      className={`filter-btn ${showOnlyToComplete ? 'active' : ''}`}
                      onClick={() => setShowOnlyToComplete(!showOnlyToComplete)}
                      title="Mostra solo interventi da completare"
                    >
                      {showOnlyToComplete ? '✓ ' : ''}Da Completare
                    </button>
                  </div>
                </div>

                {/* Advanced Filters */}
                <div className="advanced-filters">
                  <label className="control-label">Filtri avanzati:</label>

                  <select
                    value={filterTipologico}
                    onChange={(e) => {
                      setFilterTipologico(e.target.value);
                      localStorage.setItem(`mappingView_${project.id}_filterTipologico`, e.target.value);
                    }}
                    className="filter-select"
                  >
                    <option value="">Tutti i tipologici</option>
                    {[...project.typologies].sort((a, b) => a.number - b.number).map(tip => (
                      <option key={tip.id} value={tip.id}>Tip. {tip.number}</option>
                    ))}
                  </select>

                  <select
                    value={filterSupporto}
                    onChange={(e) => {
                      setFilterSupporto(e.target.value);
                      localStorage.setItem(`mappingView_${project.id}_filterSupporto`, e.target.value);
                    }}
                    className="filter-select"
                  >
                    <option value="">Tutti i supporti</option>
                    {SUPPORTO_OPTIONS.filter(opt => opt.value).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>

                  <select
                    value={filterAttraversamento}
                    onChange={(e) => {
                      setFilterAttraversamento(e.target.value);
                      localStorage.setItem(`mappingView_${project.id}_filterAttraversamento`, e.target.value);
                    }}
                    className="filter-select"
                  >
                    <option value="">Tutti gli attraversamenti</option>
                    {ATTRAVERSAMENTO_OPTIONS.filter(opt => opt.value).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>

                  {(filterTipologico || filterSupporto || filterAttraversamento) && (
                    <button
                      className="clear-filters-btn"
                      onClick={() => {
                        setFilterTipologico('');
                        setFilterSupporto('');
                        setFilterAttraversamento('');
                        localStorage.removeItem(`mappingView_${project.id}_filterTipologico`);
                        localStorage.removeItem(`mappingView_${project.id}_filterSupporto`);
                        localStorage.removeItem(`mappingView_${project.id}_filterAttraversamento`);
                      }}
                    >
                      Cancella filtri
                    </button>
                  )}
                </div>
              </div>
            )}
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
        ) : filteredMappings.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '200px',
            gap: '16px',
            color: 'var(--color-text-secondary)'
          }}>
            <p>Nessun intervento da completare</p>
            <p style={{ fontSize: '0.875rem' }}>Tutti gli interventi sono stati completati</p>
          </div>
        ) : viewMode === 'flat' ? (
          <div className="mappings-list">
            {filteredMappings.map((mapping) => {
              const photos = mappingPhotos[mapping.id] || [];
              const isExpanded = selectedMapping === mapping.id;

              return (
                <MappingEntryCard
                  key={mapping.id}
                  mapping={mapping}
                  photos={photos}
                  isExpanded={isExpanded}
                  onToggleExpand={() => setSelectedMapping(isExpanded ? null : mapping.id)}
                  onEdit={(e) => handleEditMapping(mapping, e)}
                  onDelete={(e) => handleDeleteMapping(mapping.id, e)}
                  onPhotoPreview={(url, alt) => setSelectedPhotoPreview({ url, alt })}
                  getTipologicoNumber={getTipologicoNumber}
                />
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
                      {!project.useRoomNumbering && floorGroup.rooms.length === 1 && floorGroup.rooms[0].room === '-' ? (
                        floorGroup.rooms[0].interventions.map((interventionGroup) => (
                          <div key={`${floorGroup.floor}-${interventionGroup.intervention}`} className="intervention-group">
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
                                  <MappingEntryCard
                                    key={mapping.id}
                                    mapping={mapping}
                                    photos={photos}
                                    isExpanded={isExpanded}
                                    onToggleExpand={() => setSelectedMapping(isExpanded ? null : mapping.id)}
                                    onEdit={(e) => handleEditMapping(mapping, e)}
                                    onDelete={(e) => handleDeleteMapping(mapping.id, e)}
                                    onPhotoPreview={(url, alt) => setSelectedPhotoPreview({ url, alt })}
                                    getTipologicoNumber={getTipologicoNumber}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        ))
                      ) : (
                        floorGroup.rooms.map((roomGroup) => {
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
                                          <MappingEntryCard
                                            key={mapping.id}
                                            mapping={mapping}
                                            photos={photos}
                                            isExpanded={isExpanded}
                                            onToggleExpand={() => setSelectedMapping(isExpanded ? null : mapping.id)}
                                            onEdit={(e) => handleEditMapping(mapping, e)}
                                            onDelete={(e) => handleDeleteMapping(mapping.id, e)}
                                            onPhotoPreview={(url, alt) => setSelectedPhotoPreview({ url, alt })}
                                            getTipologicoNumber={getTipologicoNumber}
                                          />
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
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

      {/* Floor Plan Editor Modal */}
      {showFloorPlanEditor && editorImageUrl && editorFloorPlan && (
        <div className="floor-plan-editor-overlay">
          <FloorPlanEditor
            imageUrl={editorImageUrl}
            initialPoints={editorPoints}
            initialGridConfig={{
              enabled: editorFloorPlan.gridEnabled || false,
              rows: editorFloorPlan.gridConfig?.rows || 10,
              cols: editorFloorPlan.gridConfig?.cols || 10,
              offsetX: editorFloorPlan.gridConfig?.offsetX || 0,
              offsetY: editorFloorPlan.gridConfig?.offsetY || 0,
            }}
            mode="view-edit"
            unmappedEntries={editorUnmappedEntries}
            pdfBlobBase64={editorFloorPlan.pdfBlobBase64}
            imageDimensions={{ width: editorFloorPlan.width, height: editorFloorPlan.height }}
            onSave={handleSaveFloorPlanEditor}
            onClose={handleCloseFloorPlanEditor}
            onOpenMappingEntry={(mappingEntryId) => {
              const mapping = mappings.find(m => m.id === mappingEntryId);
              if (mapping) {
                handleCloseFloorPlanEditor();
                onEditMapping(mapping);
              }
            }}
            onReorderPoints={handleReorderPoints}
          />
        </div>
      )}

      {/* Photo Preview Modal */}
      {selectedPhotoPreview && (
        <PhotoPreviewModal
          imageUrl={selectedPhotoPreview.url}
          altText={selectedPhotoPreview.alt}
          onClose={() => setSelectedPhotoPreview(null)}
        />
      )}
    </div>
  );
};

export default MappingView;
