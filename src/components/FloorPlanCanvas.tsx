/**
 * FloorPlanCanvas Component
 * Core canvas component for rendering floor plans with points and labels
 */

import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import {
  CARTIGLIO_INSTALLER_LINES,
  CARTIGLIO_BORDER_COLOR_HEX,
  CARTIGLIO_DEFAULT_POSITION_X,
  CARTIGLIO_DEFAULT_POSITION_Y,
  CARTIGLIO_MIN_SCALE,
  CARTIGLIO_MAX_SCALE,
} from '../utils/exportUtils';
import './FloorPlanCanvas.css';

export interface CartiglioCanvasData {
  enabled: boolean;
  positionX: number;
  positionY: number;
  scale: number;
  tavola: string;
  committente: string;
  locali: string;
  typologyValues: Record<string, string>;
}

// ============================================
// SEZIONE: Interfacce e tipi
// Definisce i tipi per punti, colori, configurazione griglia e props del canvas.
// ============================================

export interface CanvasPoint {
  id: string;
  type: 'parete' | 'solaio' | 'perimetro' | 'generico';
  pointX: number; // Normalized 0-1
  pointY: number; // Normalized 0-1
  labelX: number; // Normalized 0-1
  labelY: number; // Normalized 0-1
  labelText: string[]; // Array of label lines
  perimeterPoints?: Array<{ x: number; y: number }>; // For perimetro type
  customText?: string; // For generico type
  mappingEntryId?: string; // If linked to a mapping entry (for view-edit mode distinction)
  labelBackgroundColor?: string; // Custom background color for label (hex format "#RRGGBB")
  labelTextColor?: string; // Custom text color for label (hex format "#RRGGBB")
  eiRating?: 30 | 60 | 90 | 120 | 180 | 240; // Fire resistance rating (EI)
}

export interface GridConfig {
  enabled: boolean;
  rows: number;
  cols: number;
  offsetX: number;
  offsetY: number;
}

export type Tool = 'pan' | 'move' | 'parete' | 'solaio' | 'perimetro' | 'generico' | 'zoom-in' | 'zoom-out' | 'color-picker';

// EI (Fire Resistance) rating colors - distinct colors for each rating level
export const EI_COLORS: Record<number, string> = {
  30: '#4CAF50',   // Green
  60: '#2196F3',   // Blue
  90: '#FF9800',   // Orange
  120: '#9C27B0',  // Purple
  180: '#F44336',  // Red
  240: '#795548',  // Brown
};

export type EiRating = 30 | 60 | 90 | 120 | 180 | 240;

/** Methods exposed by FloorPlanCanvas via ref (useImperativeHandle) */
export interface FloorPlanCanvasHandle {
  completePerimeter: () => void;
  cancelPerimeter: () => void;
}

interface FloorPlanCanvasProps {
  imageUrl: string; // URL or blob URL of floor plan image
  points: CanvasPoint[];
  gridConfig: GridConfig;
  activeTool: Tool;
  onPointAdd?: (point: Omit<CanvasPoint, 'id'>) => void;
  onPointMove?: (pointId: string, newX: number, newY: number, isLabel: boolean) => void;
  onPointSelect?: (pointId: string | null) => void;
  selectedPointId?: string | null;
  zoomInTrigger?: number;
  zoomOutTrigger?: number;
  onPerimeterDrawingChange?: (isDrawing: boolean) => void; // Callback when perimeter drawing starts/stops
  onCompletePerimeter?: () => void; // External trigger to complete perimeter
  onCancelPerimeter?: () => void; // External trigger to cancel perimeter
  readOnlyPoints?: CanvasPoint[]; // Points to display as read-only (semi-transparent, no interaction)
  // EI Legend
  eiLegendPosition?: { x: number; y: number } | null; // Normalized 0-1 position, null = hidden
  onEiLegendMove?: (x: number, y: number) => void; // Callback when legend is dragged
  // Cartiglio preview (mirrors PDF layout)
  cartiglio?: CartiglioCanvasData | null;
  showCartiglioOnCanvas?: boolean;
  visibleTypologyNumbers?: number[];
  onCartiglioMove?: (x: number, y: number) => void; // Callback when cartiglio is dragged
}

const FloorPlanCanvas = forwardRef<FloorPlanCanvasHandle, FloorPlanCanvasProps>(({
  imageUrl,
  points,
  gridConfig,
  activeTool,
  onPointAdd,
  onPointMove,
  onPointSelect,
  selectedPointId,
  zoomInTrigger,
  zoomOutTrigger,
  onPerimeterDrawingChange,
  readOnlyPoints = [],
  eiLegendPosition,
  onEiLegendMove,
  cartiglio,
  showCartiglioOnCanvas = false,
  visibleTypologyNumbers = [],
  onCartiglioMove,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  
  // Pan and zoom state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  
  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [draggedPoint, setDraggedPoint] = useState<{ id: string; isLabel: boolean } | null>(null);
  const [perimeterPoints, setPerimeterPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [isDrawingPerimeter, setIsDrawingPerimeter] = useState(false);
  const [currentMousePos, setCurrentMousePos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingLegend, setIsDraggingLegend] = useState(false);
  const [isDraggingCartiglio, setIsDraggingCartiglio] = useState(false);

  // ============================================
  // SEZIONE: Cache e costanti
  // Cache per la misurazione del testo e costanti di rendering.
  // ============================================

  const measureTextCacheRef = useRef<Map<string, number>>(new Map());
  const measureTextCacheZoomRef = useRef<number>(0);

  // Cached measureText helper - invalidates when zoom changes
  const cachedMeasureText = useCallback((ctx: CanvasRenderingContext2D, text: string, font: string): number => {
    if (measureTextCacheZoomRef.current !== zoom) {
      measureTextCacheRef.current.clear();
      measureTextCacheZoomRef.current = zoom;
    }
    const key = `${font}|${text}`;
    let width = measureTextCacheRef.current.get(key);
    if (width === undefined) {
      ctx.font = font;
      width = ctx.measureText(text).width;
      measureTextCacheRef.current.set(key, width);
    }
    return width;
  }, [zoom]);

  // Notify when perimeter drawing state changes
  useEffect(() => {
    onPerimeterDrawingChange?.(isDrawingPerimeter);
  }, [isDrawingPerimeter, onPerimeterDrawingChange]);

  // Expose completePerimeter/cancelPerimeter to parent via ref instead of window globals
  useImperativeHandle(ref, () => ({
    completePerimeter: () => {
      if (isDrawingPerimeter && perimeterPoints.length >= 3 && onPointAdd) {
        onPointAdd({
          type: 'perimetro',
          pointX: perimeterPoints[0].x,
          pointY: perimeterPoints[0].y,
          labelX: perimeterPoints[0].x,
          labelY: perimeterPoints[0].y - 0.03,
          labelText: [],
          perimeterPoints: perimeterPoints,
        });
        setIsDrawingPerimeter(false);
        setPerimeterPoints([]);
        setCurrentMousePos(null);
      }
    },
    cancelPerimeter: () => {
      if (isDrawingPerimeter) {
        setIsDrawingPerimeter(false);
        setPerimeterPoints([]);
        setCurrentMousePos(null);
      }
    },
  }), [isDrawingPerimeter, perimeterPoints, onPointAdd]);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      setImage(img);
      setImageLoaded(true);
    };
    
    img.onerror = () => {
      console.error('Failed to load floor plan image');
      setImageLoaded(false);
    };
    
    img.src = imageUrl;
  }, [imageUrl]);

  // Convert normalized coordinates (0-1) to canvas coordinates
  const normalizedToCanvas = useCallback((nx: number, ny: number): { x: number; y: number } => {
    if (!image) return { x: 0, y: 0 };
    
    const x = (nx * image.width * zoom) + pan.x;
    const y = (ny * image.height * zoom) + pan.y;
    
    return { x, y };
  }, [image, zoom, pan]);

  // Convert canvas coordinates to normalized (0-1)
  const canvasToNormalized = useCallback((cx: number, cy: number): { x: number; y: number } => {
    if (!image) return { x: 0, y: 0 };
    
    const x = (cx - pan.x) / (image.width * zoom);
    const y = (cy - pan.y) / (image.height * zoom);
    
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }, [image, zoom, pan]);

  // Snap to grid for labels
  const snapToGrid = useCallback((nx: number, ny: number): { x: number; y: number } => {
    if (!gridConfig.enabled || !image || gridConfig.cols < 1 || gridConfig.rows < 1) {
      return { x: nx, y: ny };
    }

    const gridWidth = 1 / gridConfig.cols;
    const gridHeight = 1 / gridConfig.rows;
    
    const snappedX = Math.round((nx - gridConfig.offsetX) / gridWidth) * gridWidth + gridConfig.offsetX;
    const snappedY = Math.round((ny - gridConfig.offsetY) / gridHeight) * gridHeight + gridConfig.offsetY;
    
    return {
      x: Math.max(0, Math.min(1, snappedX)),
      y: Math.max(0, Math.min(1, snappedY)),
    };
  }, [gridConfig, image]);

  // ============================================
  // SEZIONE: Funzioni di rendering canvas
  // Funzioni per disegnare punti, etichette, griglia e il canvas principale.
  // ============================================

  // Render canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    
    if (!canvas || !ctx || !image || !imageLoaded) return;

    // Set canvas size to container size
    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Save context state
    ctx.save();

    // Draw floor plan image
    ctx.drawImage(
      image,
      pan.x,
      pan.y,
      image.width * zoom,
      image.height * zoom
    );

    // Draw grid (if enabled)
    if (gridConfig.enabled) {
      drawGrid(ctx);
    }

    // Draw read-only points (semi-transparent, no interaction)
    if (readOnlyPoints.length > 0) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      readOnlyPoints.forEach(point => {
        drawPoint(ctx, point);
        drawConnectingLine(ctx, point);
        drawLabel(ctx, point);
      });
      ctx.restore();
    }

    // Draw points and labels (lines first, then labels on top)
    points.forEach(point => {
      drawPoint(ctx, point);
      drawConnectingLine(ctx, point);
      drawLabel(ctx, point);
    });

    // Draw perimeter being drawn
    if (isDrawingPerimeter && perimeterPoints.length > 0) {
      ctx.strokeStyle = '#FF6600';
      ctx.lineWidth = 3;
      ctx.setLineDash([]);

      ctx.beginPath();
      const firstPoint = perimeterPoints[0];
      const firstCanvas = normalizedToCanvas(firstPoint.x, firstPoint.y);
      ctx.moveTo(firstCanvas.x, firstCanvas.y);

      for (let i = 1; i < perimeterPoints.length; i++) {
        const canvasPoint = normalizedToCanvas(perimeterPoints[i].x, perimeterPoints[i].y);
        ctx.lineTo(canvasPoint.x, canvasPoint.y);
      }

      // Draw preview line to current mouse position
      if (currentMousePos) {
        const mouseCanvas = normalizedToCanvas(currentMousePos.x, currentMousePos.y);
        ctx.lineTo(mouseCanvas.x, mouseCanvas.y);
      }

      ctx.stroke();

      // Draw vertex points
      perimeterPoints.forEach(p => {
        const canvasP = normalizedToCanvas(p.x, p.y);
        ctx.fillStyle = '#FF6600';
        ctx.beginPath();
        ctx.arc(canvasP.x, canvasP.y, 6, 0, Math.PI * 2);
        ctx.fill();

        // White center
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(canvasP.x, canvasP.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw current mouse position indicator
      if (currentMousePos) {
        const mouseCanvas = normalizedToCanvas(currentMousePos.x, currentMousePos.y);
        ctx.fillStyle = 'rgba(255, 102, 0, 0.5)';
        ctx.beginPath();
        ctx.arc(mouseCanvas.x, mouseCanvas.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw EI Legend (on top of everything)
    drawEiLegend(ctx);

    // Draw Cartiglio preview (on top, after legend)
    drawCartiglioPreview(ctx);

    // Restore context state
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, imageLoaded, pan, zoom, points, gridConfig, perimeterPoints, isDrawingPerimeter, currentMousePos, readOnlyPoints, eiLegendPosition, cartiglio, showCartiglioOnCanvas, visibleTypologyNumbers]);

  // Draw grid
  const drawGrid = (ctx: CanvasRenderingContext2D) => {
    if (!image || gridConfig.rows < 1 || gridConfig.cols < 1) return;

    ctx.strokeStyle = 'rgba(100, 100, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);

    const gridWidth = (image.width * zoom) / gridConfig.cols;
    const gridHeight = (image.height * zoom) / gridConfig.rows;

    // Vertical lines
    for (let i = 0; i <= gridConfig.cols; i++) {
      const x = pan.x + (i * gridWidth) + (gridConfig.offsetX * image.width * zoom);
      ctx.beginPath();
      ctx.moveTo(x, pan.y);
      ctx.lineTo(x, pan.y + image.height * zoom);
      ctx.stroke();
    }

    // Horizontal lines
    for (let i = 0; i <= gridConfig.rows; i++) {
      const y = pan.y + (i * gridHeight) + (gridConfig.offsetY * image.height * zoom);
      ctx.beginPath();
      ctx.moveTo(pan.x, y);
      ctx.lineTo(pan.x + image.width * zoom, y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  };

  // Draw point marker
  const drawPoint = (ctx: CanvasRenderingContext2D, point: CanvasPoint) => {
    const { x, y } = normalizedToCanvas(point.pointX, point.pointY);
    const isSelected = point.id === selectedPointId;

    // For perimetro type, draw dashed line
    if (point.type === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
      ctx.strokeStyle = isSelected ? '#FF0000' : '#FF6600';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 5]);

      ctx.beginPath();
      const firstPoint = normalizedToCanvas(point.perimeterPoints[0].x, point.perimeterPoints[0].y);
      ctx.moveTo(firstPoint.x, firstPoint.y);

      for (let i = 1; i < point.perimeterPoints.length; i++) {
        const p = normalizedToCanvas(point.perimeterPoints[i].x, point.perimeterPoints[i].y);
        ctx.lineTo(p.x, p.y);
      }

      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw point dot
    ctx.fillStyle = isSelected ? '#FF0000' : getPointColor(point.type);
    ctx.beginPath();
    ctx.arc(x, y, isSelected ? 6 : 4, 0, 2 * Math.PI);
    ctx.fill();

    // Draw selection ring
    if (isSelected) {
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, 2 * Math.PI);
      ctx.stroke();
    }
  };

  // Draw label
  const drawLabel = (ctx: CanvasRenderingContext2D, point: CanvasPoint) => {
    const { x, y } = normalizedToCanvas(point.labelX, point.labelY);
    const isSelected = point.id === selectedPointId;

    // Scale with zoom to maintain proportion with floor plan
    const padding = 8 * zoom;
    const fontSize = 14 * zoom;
    const lineHeight = 18 * zoom;
    const minWidth = 70 * zoom;
    const minHeight = 36 * zoom;
    const eiBorderWidth = 3 * zoom; // EI rating border thickness

    const boldFont = `bold ${fontSize}px Arial`;
    const italicFont = `italic ${fontSize}px Arial`;
    ctx.font = boldFont;

    // Calculate label dimensions based on number of lines
    const maxWidth = Math.max(...point.labelText.map(line => cachedMeasureText(ctx, line, boldFont)));
    const labelWidth = Math.max(maxWidth + (padding * 2), minWidth);
    const labelHeight = Math.max((point.labelText.length * lineHeight) + (padding * 2), minHeight);

    // Draw EI rating outer border if set (colored vector border)
    if (point.eiRating && EI_COLORS[point.eiRating]) {
      const eiColor = EI_COLORS[point.eiRating];
      ctx.strokeStyle = eiColor;
      ctx.lineWidth = eiBorderWidth;
      // Draw outer border with offset for the EI border
      const offset = eiBorderWidth / 2;
      ctx.strokeRect(x - offset, y - offset, labelWidth + eiBorderWidth, labelHeight + eiBorderWidth);
    }

    // Draw label background
    const defaultBgColor = isSelected ? '#FFF3CD' : '#FAFAF0';
    const bgColor = point.labelBackgroundColor || defaultBgColor;
    const borderColor = isSelected ? '#FF0000' : '#333333';

    ctx.fillStyle = bgColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = (isSelected ? 2 : 1) * zoom;

    ctx.fillRect(x, y, labelWidth, labelHeight);
    ctx.strokeRect(x, y, labelWidth, labelHeight);

    // Draw label text (multiple lines with italic styling for "foto n." and "Tip.")
    const textColor = point.labelTextColor || '#000000'; // Use custom text color or default black
    ctx.fillStyle = textColor;
    ctx.textBaseline = 'top';
    point.labelText.forEach((line, index) => {
      const yPos = y + padding + (index * lineHeight);
      let xPos = x + padding;

      // Check if line starts with "foto n." or "Tip." and render with italic
      if (line.startsWith('foto n. ')) {
        // Draw "foto n." in italic
        ctx.font = italicFont;
        const intText = 'foto n. ';
        ctx.fillText(intText, xPos, yPos);
        xPos += cachedMeasureText(ctx, intText, italicFont);

        // Draw rest in bold
        ctx.font = boldFont;
        ctx.fillText(line.substring(8), xPos, yPos);
      } else if (line.startsWith('Tip. ')) {
        // Draw "Tip." in italic
        ctx.font = italicFont;
        const tipText = 'Tip. ';
        ctx.fillText(tipText, xPos, yPos);
        xPos += cachedMeasureText(ctx, tipText, italicFont);

        // Draw rest in bold
        ctx.font = boldFont;
        ctx.fillText(line.substring(5), xPos, yPos);
      } else {
        // Draw entire line in bold
        ctx.font = boldFont;
        ctx.fillText(line, xPos, yPos);
      }
    });
  };

  // Get unique EI ratings used in points
  const getUsedEiRatings = useCallback((): EiRating[] => {
    const usedRatings = new Set<EiRating>();
    for (const point of points) {
      if (point.eiRating) {
        usedRatings.add(point.eiRating);
      }
    }
    return Array.from(usedRatings).sort((a, b) => a - b);
  }, [points]);

  // Calculate EI legend dimensions
  const getEiLegendDimensions = useCallback((ctx: CanvasRenderingContext2D, usedRatings: EiRating[]): { width: number; height: number } => {
    if (usedRatings.length === 0) return { width: 0, height: 0 };

    const padding = 8 * zoom;
    const fontSize = 12 * zoom;
    const lineHeight = 18 * zoom;
    const titleHeight = 20 * zoom;
    const colorBoxSize = 14 * zoom;
    const gap = 6 * zoom;
    const font = `bold ${fontSize}px Arial`;
    ctx.font = font;

    // Calculate width based on longest text
    const titleWidth = cachedMeasureText(ctx, 'Legenda PPA', font);
    let maxTextWidth = titleWidth;
    for (const ei of usedRatings) {
      const textWidth = cachedMeasureText(ctx, `EI ${ei}`, font);
      maxTextWidth = Math.max(maxTextWidth, colorBoxSize + gap + textWidth);
    }

    const width = maxTextWidth + (padding * 2);
    const height = titleHeight + (usedRatings.length * lineHeight) + (padding * 2);

    return { width, height };
  }, [zoom, cachedMeasureText]);

  // Draw EI Legend
  const drawEiLegend = (ctx: CanvasRenderingContext2D) => {
    if (!eiLegendPosition) return;

    const usedRatings = getUsedEiRatings();
    if (usedRatings.length === 0) return;

    const { x, y } = normalizedToCanvas(eiLegendPosition.x, eiLegendPosition.y);

    const padding = 8 * zoom;
    const fontSize = 12 * zoom;
    const lineHeight = 18 * zoom;
    const titleHeight = 20 * zoom;
    const colorBoxSize = 14 * zoom;
    const colorBoxBorder = 3 * zoom;
    const gap = 6 * zoom;

    const { width: legendWidth, height: legendHeight } = getEiLegendDimensions(ctx, usedRatings);

    // Draw background
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1 * zoom;
    ctx.fillRect(x, y, legendWidth, legendHeight);
    ctx.strokeRect(x, y, legendWidth, legendHeight);

    // Draw title
    const boldFont = `bold ${fontSize}px Arial`;
    ctx.font = boldFont;
    ctx.fillStyle = '#333333';
    ctx.textBaseline = 'top';
    ctx.fillText('Legenda PPA', x + padding, y + padding);

    // Draw separator line
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 1 * zoom;
    ctx.beginPath();
    ctx.moveTo(x + padding, y + padding + titleHeight - 4 * zoom);
    ctx.lineTo(x + legendWidth - padding, y + padding + titleHeight - 4 * zoom);
    ctx.stroke();

    // Draw each EI rating
    let yOffset = padding + titleHeight;
    for (const ei of usedRatings) {
      const boxX = x + padding;
      const boxY = y + yOffset;

      // Draw color box with EI border
      ctx.fillStyle = '#FAFAF0';
      ctx.fillRect(boxX, boxY, colorBoxSize, colorBoxSize);
      ctx.strokeStyle = EI_COLORS[ei];
      ctx.lineWidth = colorBoxBorder;
      ctx.strokeRect(boxX, boxY, colorBoxSize, colorBoxSize);

      // Draw inner border
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 0.5 * zoom;
      ctx.strokeRect(boxX + colorBoxBorder/2, boxY + colorBoxBorder/2, colorBoxSize - colorBoxBorder, colorBoxSize - colorBoxBorder);

      // Draw text
      ctx.font = boldFont;
      ctx.fillStyle = '#333333';
      ctx.textBaseline = 'middle';
      ctx.fillText(`EI ${ei}`, boxX + colorBoxSize + gap, boxY + colorBoxSize / 2);

      yOffset += lineHeight;
    }
  };

  // Check if point is on EI legend
  const isPointOnEiLegend = useCallback((cx: number, cy: number): boolean => {
    if (!eiLegendPosition) return false;

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return false;

    const usedRatings = getUsedEiRatings();
    if (usedRatings.length === 0) return false;

    const { x, y } = normalizedToCanvas(eiLegendPosition.x, eiLegendPosition.y);
    const { width, height } = getEiLegendDimensions(ctx, usedRatings);

    return cx >= x && cx <= x + width && cy >= y && cy <= y + height;
  }, [eiLegendPosition, getUsedEiRatings, getEiLegendDimensions, normalizedToCanvas]);

  // ============================================
  // SEZIONE: Cartiglio preview
  // Anteprima sul canvas del cartiglio che verrà esportato nel PDF.
  // Replica (a meno del font) il layout di buildCartiglioLayout in
  // exportUtils.ts per dare un preview fedele all'output.
  // ============================================

  const getCartiglioPreviewGeometry = useCallback(() => {
    if (!cartiglio || !showCartiglioOnCanvas || !image) return null;

    const userScale = Math.max(CARTIGLIO_MIN_SCALE, Math.min(CARTIGLIO_MAX_SCALE, cartiglio.scale ?? 1));
    // Base scale equivalente al PDF: `pageW / 841.89`. Dipende SOLO dalla
    // dimensione naturale dell'immagine, non dal zoom corrente — così il
    // cartiglio scala linearmente con lo zoom (come le etichette dei punti)
    // invece di saturare al clamp [0.72, 1.1].
    const baseScale = Math.max(0.72, Math.min(image.width / 841.89, 1.1));
    const s = baseScale * userScale * zoom;
    const pageWLike = image.width * zoom;

    const outerMargin = 16 * s;
    const gap = 10 * s;
    const layoutWidth = Math.min(pageWLike - outerMargin * 2, 640 * s);
    const tavolaHeight = 24 * s;
    const tavolaWidth = 108 * s;
    const prefixWidth = 26 * s;
    const typologyTextFontSize = 8.5 * s;
    const typologyLabelFontSize = 8.5 * s;
    const infoPadding = 7 * s;
    const infoFontSize = 7.5 * s;
    const infoLineHeight = 11 * s;
    const signatureFontSize = 8 * s;

    const sortedTypologies = [...visibleTypologyNumbers].sort((a, b) => a - b);
    const effectiveNumbers = sortedTypologies.length > 0 ? sortedTypologies : [0];

    // Line wrap via canvas measureText (approssima wrapTextToWidth del PDF).
    const wrapLines = (text: string, font: string, maxW: number): string[] => {
      if (!text) return [''];
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return [text];
      const prevFont = ctx.font;
      ctx.font = font;
      const paragraphs = text.split(/\n/);
      const out: string[] = [];
      for (const para of paragraphs) {
        const words = para.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
          out.push('');
          continue;
        }
        let line = '';
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          if (ctx.measureText(candidate).width <= maxW || line === '') {
            line = candidate;
          } else {
            out.push(line);
            line = word;
          }
        }
        if (line) out.push(line);
      }
      ctx.font = prevFont;
      return out.length ? out : [''];
    };

    const typologyTextWidth = layoutWidth - prefixWidth - 14 * s;
    const typologyFont = `${typologyTextFontSize}px Helvetica, Arial`;
    const rows = effectiveNumbers.map((num, index) => {
      const key = num ? String(num) : `empty-${index}`;
      const label = num ? `${num})` : '';
      const value = cartiglio.typologyValues?.[key] || '';
      const wrappedLines = wrapLines(value, typologyFont, typologyTextWidth);
      return { key, label, value, wrappedLines };
    });
    const maxWrappedLines = Math.max(1, ...rows.map((r) => Math.max(1, r.wrappedLines.length)));
    const uniformRowHeight = Math.max(18 * s, maxWrappedLines * (typologyTextFontSize * 1.18) + 6 * s);
    const typologyHeight = rows.length * uniformRowHeight + 8 * s;
    const infoBoxHeight = 86 * s;
    const signatureWidth = layoutWidth * 0.3;
    const infoWidth = layoutWidth - signatureWidth - gap;
    const totalHeight = tavolaHeight + gap + typologyHeight + gap + infoBoxHeight;

    // Posiziono in coordinate canvas. positionX/positionY sono frazioni
    // dell'image bbox zoomata.
    const posX = Math.max(0, Math.min(1, cartiglio.positionX ?? CARTIGLIO_DEFAULT_POSITION_X));
    const posY = Math.max(0, Math.min(1, cartiglio.positionY ?? CARTIGLIO_DEFAULT_POSITION_Y));
    const imgLeft = pan.x;
    const imgTop = pan.y;
    const imgW = image.width * zoom;
    const imgH = image.height * zoom;

    const x = imgLeft + posX * imgW;
    const y = imgTop + posY * imgH; // top-left corner of the bounding box
    return {
      x,
      y,
      width: layoutWidth,
      totalHeight,
      scale: s,
      tavolaWidth,
      tavolaHeight,
      gap,
      typologyHeight,
      infoBoxHeight,
      infoWidth,
      signatureWidth,
      prefixWidth,
      rows,
      uniformRowHeight,
      typologyTextFontSize,
      typologyLabelFontSize,
      infoPadding,
      infoFontSize,
      infoLineHeight,
      signatureFontSize,
      imgLeft,
      imgTop,
      imgW,
      imgH,
    };
  }, [cartiglio, showCartiglioOnCanvas, image, zoom, pan, visibleTypologyNumbers]);

  const drawCartiglioPreview = useCallback((ctx: CanvasRenderingContext2D) => {
    const g = getCartiglioPreviewGeometry();
    if (!g) return;

    const borderColor = CARTIGLIO_BORDER_COLOR_HEX;
    const textColor = '#1a1a1a';

    // Helper per box con bordo rosso + sfondo bianco.
    const drawBorderedRect = (x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    };

    // TAVOLA box (angolo in alto a sinistra)
    const tavolaX = g.x;
    const tavolaY = g.y;
    drawBorderedRect(tavolaX, tavolaY, g.tavolaWidth, g.tavolaHeight);
    const tavolaLabelFontSize = 9 * g.scale;
    const tavolaFieldFontSize = 10 * g.scale;
    const tavolaPadding = 6 * g.scale;
    ctx.fillStyle = textColor;
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${tavolaLabelFontSize}px Helvetica, Arial`;
    ctx.fillText('TAVOLA', tavolaX + tavolaPadding, tavolaY + g.tavolaHeight / 2);
    ctx.font = `${tavolaFieldFontSize}px Helvetica, Arial`;
    ctx.fillText(cartiglio?.tavola || '', tavolaX + 46 * g.scale, tavolaY + g.tavolaHeight / 2);

    // Typology box
    const typoX = g.x;
    const typoY = g.y + g.tavolaHeight + g.gap;
    drawBorderedRect(typoX, typoY, g.width, g.typologyHeight);
    // Vertical separator after prefix
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(typoX + g.prefixWidth, typoY);
    ctx.lineTo(typoX + g.prefixWidth, typoY + g.typologyHeight);
    ctx.stroke();
    // Rows
    const rowPaddingY = 4 * g.scale;
    let cursorY = typoY + rowPaddingY;
    g.rows.forEach((row, rowIndex) => {
      if (rowIndex > 0) {
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(typoX, cursorY);
        ctx.lineTo(typoX + g.width, cursorY);
        ctx.stroke();
      }
      const rowTop = cursorY;
      const rowBottom = cursorY + g.uniformRowHeight;

      if (row.label) {
        ctx.fillStyle = textColor;
        ctx.font = `bold ${g.typologyLabelFontSize}px Helvetica, Arial`;
        ctx.textBaseline = 'middle';
        ctx.fillText(row.label, typoX + 4 * g.scale, (rowTop + rowBottom) / 2);
      }

      ctx.fillStyle = textColor;
      ctx.font = `${g.typologyTextFontSize}px Helvetica, Arial`;
      ctx.textBaseline = 'middle';
      const lineHeight = g.typologyTextFontSize * 1.25;
      const blockHeight = Math.max(lineHeight, row.wrappedLines.length * lineHeight);
      let textY = (rowTop + rowBottom) / 2 - (blockHeight - lineHeight) / 2;
      row.wrappedLines.forEach((line) => {
        ctx.fillText(line, typoX + g.prefixWidth + 8 * g.scale, textY);
        textY += lineHeight;
      });

      cursorY = rowBottom;
    });

    // Info + Signature row
    const infoY = typoY + g.typologyHeight + g.gap;
    drawBorderedRect(g.x, infoY, g.infoWidth, g.infoBoxHeight);
    drawBorderedRect(g.x + g.infoWidth + g.gap, infoY, g.signatureWidth, g.infoBoxHeight);

    const infoLines: string[] = [
      ...CARTIGLIO_INSTALLER_LINES,
      'Committente :',
      'Locali :',
    ];
    const infoTop = infoY + g.infoPadding;
    const infoBottom = infoY + g.infoBoxHeight - g.infoPadding;
    const slotHeight = (infoBottom - infoTop) / infoLines.length;
    ctx.font = `${g.infoFontSize}px Helvetica, Arial`;
    ctx.fillStyle = textColor;
    ctx.textBaseline = 'middle';
    infoLines.forEach((line, index) => {
      const centerY = infoTop + (index + 0.5) * slotHeight;
      ctx.fillText(line, g.x + g.infoPadding, centerY);
      if (index === CARTIGLIO_INSTALLER_LINES.length) {
        // Committente value
        const labelW = ctx.measureText(line).width;
        ctx.fillText(cartiglio?.committente || '', g.x + g.infoPadding + labelW + 6, centerY);
      } else if (index === CARTIGLIO_INSTALLER_LINES.length + 1) {
        // Locali value
        const labelW = ctx.measureText(line).width;
        ctx.fillText(cartiglio?.locali || '', g.x + g.infoPadding + labelW + 6, centerY);
      }
    });
  }, [cartiglio, getCartiglioPreviewGeometry]);

  const isPointOnCartiglio = useCallback((cx: number, cy: number): boolean => {
    const g = getCartiglioPreviewGeometry();
    if (!g) return false;
    return cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.totalHeight;
  }, [getCartiglioPreviewGeometry]);

  // Helper function to find closest point on a line segment to a given point
  const getClosestPointOnSegment = (
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    point: { x: number; y: number }
  ): { x: number; y: number } => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) return p1;

    // Project point onto line segment, clamped to [0, 1]
    const t = Math.max(0, Math.min(1, ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSquared));

    return {
      x: p1.x + t * dx,
      y: p1.y + t * dy
    };
  };

  // Draw connecting line from point to label
  const drawConnectingLine = (ctx: CanvasRenderingContext2D, point: CanvasPoint) => {
    const labelPos = normalizedToCanvas(point.labelX, point.labelY);
    const isSelected = point.id === selectedPointId;

    // Calculate label dimensions - MUST match drawLabel exactly
    // Scale with zoom to maintain proportion with floor plan
    const padding = 8 * zoom;
    const fontSize = 14 * zoom;
    const lineHeight = 18 * zoom;
    const minWidth = 70 * zoom;
    const minHeight = 36 * zoom;
    const boldFontConn = `bold ${fontSize}px Arial`;
    ctx.font = boldFontConn;
    const maxWidth = Math.max(...point.labelText.map(line => cachedMeasureText(ctx, line, boldFontConn)));
    const labelWidth = Math.max(maxWidth + (padding * 2), minWidth);
    const labelHeight = Math.max((point.labelText.length * lineHeight) + (padding * 2), minHeight);

    // Label rectangle bounds
    const labelLeft = labelPos.x;
    const labelRight = labelPos.x + labelWidth;
    const labelTop = labelPos.y;
    const labelBottom = labelPos.y + labelHeight;

    // Find label center for distance calculation
    const labelCenterX = labelPos.x + labelWidth / 2;
    const labelCenterY = labelPos.y + labelHeight / 2;

    ctx.strokeStyle = isSelected ? '#FF0000' : '#666666';
    ctx.lineWidth = 1 * zoom;
    ctx.setLineDash([3 * zoom, 3 * zoom]);

    // Special handling for perimetro type - find closest point on perimeter segments
    if (point.type === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
      let minDistance = Infinity;
      let closestPointOnPerimeter = { x: 0, y: 0 };

      // Check each segment of the perimeter
      for (let i = 0; i < point.perimeterPoints.length - 1; i++) {
        const p1 = normalizedToCanvas(point.perimeterPoints[i].x, point.perimeterPoints[i].y);
        const p2 = normalizedToCanvas(point.perimeterPoints[i + 1].x, point.perimeterPoints[i + 1].y);

        // Find closest point on this line segment to label center
        const closestOnSegment = getClosestPointOnSegment(p1, p2, { x: labelCenterX, y: labelCenterY });
        const dx = closestOnSegment.x - labelCenterX;
        const dy = closestOnSegment.y - labelCenterY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < minDistance) {
          minDistance = distance;
          closestPointOnPerimeter = closestOnSegment;
        }
      }

      // Find closest edge point on label from the closest perimeter point
      const edges = [
        { x: Math.max(labelLeft, Math.min(labelRight, closestPointOnPerimeter.x)), y: labelTop }, // Top edge
        { x: Math.max(labelLeft, Math.min(labelRight, closestPointOnPerimeter.x)), y: labelBottom }, // Bottom edge
        { x: labelLeft, y: Math.max(labelTop, Math.min(labelBottom, closestPointOnPerimeter.y)) }, // Left edge
        { x: labelRight, y: Math.max(labelTop, Math.min(labelBottom, closestPointOnPerimeter.y)) } // Right edge
      ];

      let minEdgeDist = Infinity;
      let targetX = closestPointOnPerimeter.x;
      let targetY = closestPointOnPerimeter.y;

      edges.forEach(edge => {
        const dx = edge.x - closestPointOnPerimeter.x;
        const dy = edge.y - closestPointOnPerimeter.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < minEdgeDist) {
          minEdgeDist = distance;
          targetX = edge.x;
          targetY = edge.y;
        }
      });

      // Draw straight line from closest perimeter point to label edge
      ctx.beginPath();
      ctx.moveTo(closestPointOnPerimeter.x, closestPointOnPerimeter.y);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();
    } else {
      // Standard point - direct line from point to label edge
      const pointPos = normalizedToCanvas(point.pointX, point.pointY);

      // Find the closest point on the label rectangle perimeter
      const edges = [
        { x: Math.max(labelLeft, Math.min(labelRight, pointPos.x)), y: labelTop }, // Top edge
        { x: Math.max(labelLeft, Math.min(labelRight, pointPos.x)), y: labelBottom }, // Bottom edge
        { x: labelLeft, y: Math.max(labelTop, Math.min(labelBottom, pointPos.y)) }, // Left edge
        { x: labelRight, y: Math.max(labelTop, Math.min(labelBottom, pointPos.y)) } // Right edge
      ];

      // Find the edge point with minimum distance to the point
      let minDistance = Infinity;
      let targetX = pointPos.x;
      let targetY = pointPos.y;

      edges.forEach(edge => {
        const dx = edge.x - pointPos.x;
        const dy = edge.y - pointPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < minDistance) {
          minDistance = distance;
          targetX = edge.x;
          targetY = edge.y;
        }
      });

      ctx.beginPath();
      ctx.moveTo(pointPos.x, pointPos.y);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  };

  // Get point color based on type
  const getPointColor = (type: string): string => {
    switch (type) {
      case 'parete':
        return '#0066FF';
      case 'solaio':
        return '#00CC66';
      case 'perimetro':
        return '#FF6600';
      case 'generico':
        return '#9933FF';
      default:
        return '#333333';
    }
  };

  // ============================================
  // SEZIONE: Gestione eventi mouse
  // Handler per click, drag, hover e selezione punti tramite mouse.
  // ============================================

  // Handle mouse down
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeTool === 'pan') {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    } else if (activeTool === 'move') {
      // Cartiglio takes priority (largest overlay, user likely wants to move it)
      if (isPointOnCartiglio(x, y)) {
        setIsDraggingCartiglio(true);
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
      }
      // Check if clicking on EI legend next
      if (isPointOnEiLegend(x, y)) {
        setIsDraggingLegend(true);
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        return;
      }

      // Check if clicking on a point or label
      const clickedPoint = findPointAt(x, y);

      if (clickedPoint) {
        setDraggedPoint(clickedPoint);
        setIsDragging(true);
        onPointSelect?.(clickedPoint.id);
      } else {
        onPointSelect?.(null);
      }
    } else if (activeTool === 'perimetro') {
      // Handle perimeter drawing - click to add vertex
      const normalized = canvasToNormalized(x, y);

      if (!isDrawingPerimeter) {
        // Start drawing perimeter - first click
        setIsDrawingPerimeter(true);
        setPerimeterPoints([normalized]);
      } else {
        // Add vertex to perimeter - subsequent clicks
        setPerimeterPoints(prev => [...prev, normalized]);
      }
    } else if (['parete', 'solaio', 'generico'].includes(activeTool)) {
      // Add new point
      const normalized = canvasToNormalized(x, y);
      const snapped = snapToGrid(normalized.x, normalized.y);

      onPointAdd?.({
        type: activeTool as any,
        pointX: normalized.x,
        pointY: normalized.y,
        labelX: snapped.x,
        labelY: snapped.y,
        labelText: ['New Point'], // Placeholder, will be updated by parent
      });
    }
  };

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Update mouse position for perimeter preview
    if (activeTool === 'perimetro' && isDrawingPerimeter) {
      const normalized = canvasToNormalized(x, y);
      setCurrentMousePos(normalized);
    }

    if (!isDragging) return;

    if (activeTool === 'pan') {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    } else if (activeTool === 'move' && isDraggingCartiglio && cartiglio) {
      // Handle cartiglio dragging (asymmetric clamp: x bounded in image,
      // y allows going below the image — PDF page will extend to fit).
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;

      if (image) {
        const g = getCartiglioPreviewGeometry();
        const widthNorm = g ? (g.width / (image.width * zoom)) : 0;
        const newX = (cartiglio.positionX ?? CARTIGLIO_DEFAULT_POSITION_X) + (deltaX / (image.width * zoom));
        const newY = (cartiglio.positionY ?? CARTIGLIO_DEFAULT_POSITION_Y) + (deltaY / (image.height * zoom));
        const clampedX = Math.max(0, Math.min(Math.max(0, 1 - widthNorm), newX));
        const clampedY = Math.max(0, Math.min(1, newY));
        onCartiglioMove?.(clampedX, clampedY);
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    } else if (activeTool === 'move' && isDraggingLegend && eiLegendPosition) {
      // Handle legend dragging
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;

      if (image) {
        const newX = eiLegendPosition.x + (deltaX / (image.width * zoom));
        const newY = eiLegendPosition.y + (deltaY / (image.height * zoom));
        onEiLegendMove?.(
          Math.max(0, Math.min(1, newX)),
          Math.max(0, Math.min(1, newY))
        );
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    } else if (activeTool === 'move' && draggedPoint) {
      const normalized = canvasToNormalized(x, y);

      let finalX = normalized.x;
      let finalY = normalized.y;

      // Snap labels to grid
      if (draggedPoint.isLabel) {
        const snapped = snapToGrid(normalized.x, normalized.y);
        finalX = snapped.x;
        finalY = snapped.y;
      }

      onPointMove?.(draggedPoint.id, finalX, finalY, draggedPoint.isLabel);
    }
  };

  // Handle mouse up
  const handleMouseUp = () => {
    setIsDragging(false);
    setDraggedPoint(null);
    setIsDraggingLegend(false);
    setIsDraggingCartiglio(false);
  };

  // Handle double click to complete perimeter
  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === 'perimetro' && isDrawingPerimeter && perimeterPoints.length >= 2) {
      // Complete the perimeter and add it as a point
      const firstPoint = perimeterPoints[0];
      const centerX = perimeterPoints.reduce((sum, p) => sum + p.x, 0) / perimeterPoints.length;
      const centerY = perimeterPoints.reduce((sum, p) => sum + p.y, 0) / perimeterPoints.length;
      const snapped = snapToGrid(centerX, centerY);

      onPointAdd?.({
        type: 'perimetro',
        pointX: firstPoint.x,
        pointY: firstPoint.y,
        labelX: snapped.x,
        labelY: snapped.y,
        labelText: ['Perimetro'],
        perimeterPoints: perimeterPoints,
      });

      // Reset perimeter drawing
      setIsDrawingPerimeter(false);
      setPerimeterPoints([]);
      setCurrentMousePos(null);
    }
  };

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTool === 'perimetro' && isDrawingPerimeter) {
        if (e.key === 'Escape') {
          // Cancel perimeter drawing
          setIsDrawingPerimeter(false);
          setPerimeterPoints([]);
          setCurrentMousePos(null);
        } else if (e.key === 'Enter' && perimeterPoints.length >= 2) {
          // Complete perimeter with Enter key
          const firstPoint = perimeterPoints[0];
          const centerX = perimeterPoints.reduce((sum, p) => sum + p.x, 0) / perimeterPoints.length;
          const centerY = perimeterPoints.reduce((sum, p) => sum + p.y, 0) / perimeterPoints.length;
          const snapped = snapToGrid(centerX, centerY);

          onPointAdd?.({
            type: 'perimetro',
            pointX: firstPoint.x,
            pointY: firstPoint.y,
            labelX: snapped.x,
            labelY: snapped.y,
            labelText: ['Perimetro'],
            perimeterPoints: perimeterPoints,
          });

          // Reset perimeter drawing
          setIsDrawingPerimeter(false);
          setPerimeterPoints([]);
          setCurrentMousePos(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDrawingPerimeter, perimeterPoints, activeTool]);

  // Find point at canvas coordinates
  const findPointAt = (cx: number, cy: number): { id: string; isLabel: boolean } | null => {
    // Check labels first (larger hit area)
    for (const point of points) {
      const labelPos = normalizedToCanvas(point.labelX, point.labelY);

      // Calculate label dimensions using cached measureText
      // Scale with zoom to match drawLabel
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        const padding = 8 * zoom;
        const fontSize = 14 * zoom;
        const lineHeight = 18 * zoom;
        const minWidth = 70 * zoom;
        const minHeight = 36 * zoom;
        const hitFont = `bold ${fontSize}px Arial`;
        const maxWidth = Math.max(...point.labelText.map(line => cachedMeasureText(ctx, line, hitFont)));
        const labelWidth = Math.max(maxWidth + (padding * 2), minWidth);
        const labelHeight = Math.max((point.labelText.length * lineHeight) + (padding * 2), minHeight);

        if (
          cx >= labelPos.x &&
          cx <= labelPos.x + labelWidth &&
          cy >= labelPos.y &&
          cy <= labelPos.y + labelHeight
        ) {
          return { id: point.id, isLabel: true };
        }
      }
    }

    // Check points (smaller hit area)
    for (const point of points) {
      const pointPos = normalizedToCanvas(point.pointX, point.pointY);
      const distance = Math.sqrt(
        Math.pow(cx - pointPos.x, 2) + Math.pow(cy - pointPos.y, 2)
      );

      if (distance <= 10) {
        return { id: point.id, isLabel: false };
      }
    }

    return null;
  };

  // Handle wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(5, zoom * delta));

    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const dx = mouseX - pan.x;
      const dy = mouseY - pan.y;

      setPan({
        x: mouseX - (dx * newZoom / zoom),
        y: mouseY - (dy * newZoom / zoom),
      });
    }

    setZoom(newZoom);
  };

  // Handle zoom buttons - expose these functions
  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(5, prev * 1.2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(0.1, prev * 0.8));
  }, []);

  // ============================================
  // SEZIONE: Gestione eventi touch
  // Handler per gestures touch su dispositivi mobili.
  // ============================================

  // Handle touch events for mobile
  const [lastTouchDistance, setLastTouchDistance] = useState<number | null>(null);
  const [lastTouchCenter, setLastTouchCenter] = useState<{ x: number; y: number } | null>(null);

  const getTouchDistance = (touch1: React.Touch, touch2: React.Touch) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchCenter = (touch1: React.Touch, touch2: React.Touch) => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (e.touches.length === 2) {
      // Two-finger gesture: zoom with pinch + pan with movement
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      const center = getTouchCenter(e.touches[0], e.touches[1]);
      setLastTouchDistance(distance);
      setLastTouchCenter(center);
    } else if (e.touches.length === 1) {
      const rect = canvas.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;

      if (activeTool === 'pan') {
        setIsDragging(true);
        setDragStart({ x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y });
      } else if (activeTool === 'move') {
        if (isPointOnCartiglio(x, y)) {
          setIsDraggingCartiglio(true);
          setIsDragging(true);
          setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
          return;
        }
        // Check if touching EI legend next
        if (isPointOnEiLegend(x, y)) {
          setIsDraggingLegend(true);
          setIsDragging(true);
          setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
          return;
        }

        // Check if touching a point or label
        const clickedPoint = findPointAt(x, y);

        if (clickedPoint) {
          setDraggedPoint(clickedPoint);
          setIsDragging(true);
          onPointSelect?.(clickedPoint.id);
        } else {
          onPointSelect?.(null);
        }
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    if (e.touches.length === 2 && lastTouchDistance !== null && lastTouchCenter !== null) {
      // Two-finger gesture: pinch to zoom + two-finger pan
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      const center = getTouchCenter(e.touches[0], e.touches[1]);

      // Calculate zoom delta from pinch
      const zoomDelta = distance / lastTouchDistance;
      const newZoom = Math.max(0.1, Math.min(5, zoom * zoomDelta));

      // Calculate pan delta from center movement
      const panDeltaX = center.x - lastTouchCenter.x;
      const panDeltaY = center.y - lastTouchCenter.y;

      // Apply zoom around the touch center point
      const centerRelativeToCanvas = {
        x: lastTouchCenter.x - rect.left,
        y: lastTouchCenter.y - rect.top,
      };

      const dx = centerRelativeToCanvas.x - pan.x;
      const dy = centerRelativeToCanvas.y - pan.y;

      // Update pan to zoom around center point AND apply two-finger pan
      setPan({
        x: centerRelativeToCanvas.x - (dx * newZoom / zoom) + panDeltaX,
        y: centerRelativeToCanvas.y - (dy * newZoom / zoom) + panDeltaY,
      });

      setZoom(newZoom);
      setLastTouchDistance(distance);
      setLastTouchCenter(center);
    } else if (e.touches.length === 1 && isDragging) {
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;

      if (activeTool === 'pan') {
        setPan({
          x: e.touches[0].clientX - dragStart.x,
          y: e.touches[0].clientY - dragStart.y,
        });
      } else if (activeTool === 'move' && isDraggingCartiglio && cartiglio) {
        const deltaX = e.touches[0].clientX - dragStart.x;
        const deltaY = e.touches[0].clientY - dragStart.y;

        if (image) {
          const g = getCartiglioPreviewGeometry();
          const widthNorm = g ? (g.width / (image.width * zoom)) : 0;
          const newX = (cartiglio.positionX ?? CARTIGLIO_DEFAULT_POSITION_X) + (deltaX / (image.width * zoom));
          const newY = (cartiglio.positionY ?? CARTIGLIO_DEFAULT_POSITION_Y) + (deltaY / (image.height * zoom));
          const clampedX = Math.max(0, Math.min(Math.max(0, 1 - widthNorm), newX));
          const clampedY = Math.max(0, Math.min(1, newY));
          onCartiglioMove?.(clampedX, clampedY);
          setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
        }
      } else if (activeTool === 'move' && isDraggingLegend && eiLegendPosition) {
        // Handle legend dragging on touch
        const deltaX = e.touches[0].clientX - dragStart.x;
        const deltaY = e.touches[0].clientY - dragStart.y;

        if (image) {
          const newX = eiLegendPosition.x + (deltaX / (image.width * zoom));
          const newY = eiLegendPosition.y + (deltaY / (image.height * zoom));
          onEiLegendMove?.(
            Math.max(0, Math.min(1, newX)),
            Math.max(0, Math.min(1, newY))
          );
          setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
        }
      } else if (activeTool === 'move' && draggedPoint) {
        const normalized = canvasToNormalized(x, y);

        let finalX = normalized.x;
        let finalY = normalized.y;

        // Snap labels to grid
        if (draggedPoint.isLabel) {
          const snapped = snapToGrid(normalized.x, normalized.y);
          finalX = snapped.x;
          finalY = snapped.y;
        }

        onPointMove?.(draggedPoint.id, finalX, finalY, draggedPoint.isLabel);
      }
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setDraggedPoint(null);
    setIsDraggingLegend(false);
    setIsDraggingCartiglio(false);
    setLastTouchDistance(null);
    setLastTouchCenter(null);
  };

  // ============================================
  // SEZIONE: Effects e lifecycle
  // useEffect per ridisegnare il canvas al cambio di stato o dimensioni.
  // ============================================

  // Handle zoom triggers from parent
  useEffect(() => {
    if (zoomInTrigger) {
      handleZoomIn();
    }
  }, [zoomInTrigger, handleZoomIn]);

  useEffect(() => {
    if (zoomOutTrigger) {
      handleZoomOut();
    }
  }, [zoomOutTrigger, handleZoomOut]);

  // Render effect
  useEffect(() => {
    render();
  }, [render]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      render();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [render]);

  return (
    <div ref={containerRef} className="floor-plan-canvas-container">
      <canvas
        ref={canvasRef}
        className="floor-plan-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      
      {!imageLoaded && (
        <div className="canvas-loading">
          Caricamento planimetria...
        </div>
      )}
      
      <div className="canvas-info">
        Zoom: {(zoom * 100).toFixed(0)}%
      </div>
    </div>
  );
});

FloorPlanCanvas.displayName = 'FloorPlanCanvas';

export default React.memo(FloorPlanCanvas);
