/**
 * FloorPlanCanvas Component
 * Core canvas component for rendering floor plans with points and labels
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import './FloorPlanCanvas.css';

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
}

export interface GridConfig {
  enabled: boolean;
  rows: number;
  cols: number;
  offsetX: number;
  offsetY: number;
}

export type Tool = 'pan' | 'move' | 'parete' | 'solaio' | 'perimetro' | 'generico' | 'zoom-in' | 'zoom-out';

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
}

const FloorPlanCanvas: React.FC<FloorPlanCanvasProps> = ({
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
  onCompletePerimeter,
  onCancelPerimeter,
}) => {
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

  // Notify when perimeter drawing state changes
  useEffect(() => {
    onPerimeterDrawingChange?.(isDrawingPerimeter);
  }, [isDrawingPerimeter, onPerimeterDrawingChange]);

  // External perimeter completion/cancellation triggers
  useEffect(() => {
    if (onCompletePerimeter) {
      // Listen for completion request
      const complete = () => {
        if (isDrawingPerimeter && perimeterPoints.length >= 2 && onPointAdd) {
          const firstPoint = perimeterPoints[0];
          const labelPos = perimeterPoints.reduce(
            (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
            { x: 0, y: 0 }
          );
          labelPos.x /= perimeterPoints.length;
          labelPos.y /= perimeterPoints.length;

          onPointAdd({
            type: 'perimetro',
            pointX: firstPoint.x,
            pointY: firstPoint.y,
            labelX: labelPos.x,
            labelY: labelPos.y,
            labelText: ['Perimetro'],
            perimeterPoints: perimeterPoints,
          });

          setIsDrawingPerimeter(false);
          setPerimeterPoints([]);
          setCurrentMousePos(null);
        }
      };
      // Store reference for cleanup
      (window as any).__completePerimeter = complete;
    }
  }, [isDrawingPerimeter, perimeterPoints, onPointAdd, onCompletePerimeter]);

  useEffect(() => {
    if (onCancelPerimeter) {
      const cancel = () => {
        if (isDrawingPerimeter) {
          setIsDrawingPerimeter(false);
          setPerimeterPoints([]);
          setCurrentMousePos(null);
        }
      };
      (window as any).__cancelPerimeter = cancel;
    }
  }, [isDrawingPerimeter, onCancelPerimeter]);

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
    if (!gridConfig.enabled || !image) {
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

    // Draw points and labels
    points.forEach(point => {
      drawPoint(ctx, point);
      drawLabel(ctx, point);
      drawConnectingLine(ctx, point);
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

    // Restore context state
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, imageLoaded, pan, zoom, points, gridConfig, perimeterPoints, isDrawingPerimeter, currentMousePos]);

  // Draw grid
  const drawGrid = (ctx: CanvasRenderingContext2D) => {
    if (!image) return;

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

    const padding = 8;
    const fontSize = 14;
    const lineHeight = 18;
    const minWidth = 70;
    const minHeight = 36;

    ctx.font = `bold ${fontSize}px Arial`;

    // Calculate label dimensions based on number of lines
    const maxWidth = Math.max(...point.labelText.map(line => ctx.measureText(line).width));
    const labelWidth = Math.max(maxWidth + (padding * 2), minWidth);
    const labelHeight = Math.max((point.labelText.length * lineHeight) + (padding * 2), minHeight);

    // Draw label background
    ctx.fillStyle = isSelected ? '#FFF3CD' : '#FFFFFF';
    ctx.strokeStyle = isSelected ? '#FF0000' : '#333333';
    ctx.lineWidth = isSelected ? 2 : 1;

    ctx.fillRect(x, y, labelWidth, labelHeight);
    ctx.strokeRect(x, y, labelWidth, labelHeight);

    // Draw label text (multiple lines with italic styling for "Int." and "Tip.")
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    point.labelText.forEach((line, index) => {
      const yPos = y + padding + (index * lineHeight);
      let xPos = x + padding;

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
  };

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
    const padding = 8;
    const fontSize = 14;
    const lineHeight = 18;
    const minWidth = 70;
    const minHeight = 36;
    ctx.font = `bold ${fontSize}px Arial`;
    const maxWidth = Math.max(...point.labelText.map(line => ctx.measureText(line).width));
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
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

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

      // Calculate label dimensions using a temporary canvas context
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        const padding = 8;
        const fontSize = 14;
        const lineHeight = 18;
        const minWidth = 70;
        const minHeight = 36;
        tempCtx.font = `bold ${fontSize}px Arial`;
        const maxWidth = Math.max(...point.labelText.map(line => tempCtx.measureText(line).width));
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

  // Handle touch events for mobile
  const [lastTouchDistance, setLastTouchDistance] = useState<number | null>(null);

  const getTouchDistance = (touch1: React.Touch, touch2: React.Touch) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (e.touches.length === 2) {
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      setLastTouchDistance(distance);
    } else if (e.touches.length === 1) {
      const rect = canvas.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;

      if (activeTool === 'pan') {
        setIsDragging(true);
        setDragStart({ x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y });
      } else if (activeTool === 'move') {
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
    const x = e.touches[0].clientX - rect.left;
    const y = e.touches[0].clientY - rect.top;

    if (e.touches.length === 2 && lastTouchDistance !== null) {
      const distance = getTouchDistance(e.touches[0], e.touches[1]);
      const delta = distance / lastTouchDistance;
      setZoom(prev => Math.max(0.1, Math.min(5, prev * delta)));
      setLastTouchDistance(distance);
    } else if (e.touches.length === 1 && isDragging) {
      if (activeTool === 'pan') {
        setPan({
          x: e.touches[0].clientX - dragStart.x,
          y: e.touches[0].clientY - dragStart.y,
        });
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
    setLastTouchDistance(null);
  };

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
};

export default FloorPlanCanvas;
