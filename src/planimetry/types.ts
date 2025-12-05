// Types for Planimetry Module (integrated from OPIMapTool)

export type InteractionMode = 'pan' | 'add' | 'move' | 'line';

export type PointType = 'generic' | 'floor-single' | 'wall-single' | 'floor-multi' | 'wall-multi';

export type LineColor = '#dc2626' | '#2563eb' | '#06b6d4' | '#16a34a' | '#f97316'; // Red, Blue, Cyan, Green, Orange

export interface MapPoint {
  id: string;
  number: number; // The visual number (1, 2, 3...)
  x: number; // Percentage relative to image width (0-100) - THIS IS THE BADGE POSITION
  y: number; // Percentage relative to image height (0-100)
  targetX?: number; // Percentage relative to image width (0-100) - THIS IS THE OBJECT POSITION (Arrow tip)
  targetY?: number;
  type: PointType;
  description: string;
  createdAt: number;
  mappingEntryId?: string; // Optional link to a MappingEntry
}

export interface MapLine {
  id: string;
  startX: number; // Percentage
  startY: number;
  endX: number;
  endY: number;
  color: LineColor;
}

export interface PlanimetryState {
  version: number;
  planName: string;
  floor: string;
  imageName: string;
  rotation: number; // Rotation in degrees
  markerScale: number; // Scale factor for markers (0.5 to 3.0)
  points: MapPoint[];
  lines: MapLine[];
}

export interface DragState {
  isDragging: boolean;
  pointId: string | null;
  startX: number;
  startY: number;
}

// Database interfaces for Dexie integration
export interface Planimetry {
  id: string;
  projectId: string;
  floor: string;
  planName: string;
  imageName: string;
  imageData: string; // Base64
  rotation: number;
  markerScale: number;
  createdAt: number;
  updatedAt: number;
  synced: number; // 0 = false, 1 = true (for Dexie indexing compatibility)
}

export interface PlanimetryPoint {
  id: string;
  planimetryId: string;
  mappingEntryId?: string; // Optional link to MappingEntry
  number: number;
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  type: PointType;
  description: string;
  createdAt: number;
  synced: number; // 0 = false, 1 = true
}

export interface PlanimetryLine {
  id: string;
  planimetryId: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: LineColor;
  synced: number; // 0 = false, 1 = true
}

// Props interfaces
export interface PlanimetryEditorProps {
  projectId: string;
  floor: string;
  onClose: () => void;
  onSave?: () => void;
  mappingEntryId?: string; // For linking new points to a mapping entry
  readOnly?: boolean; // When true, only viewing is allowed (no editing)
}
