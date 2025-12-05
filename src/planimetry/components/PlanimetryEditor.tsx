import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Marker } from './Marker';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MapPoint, MapLine, InteractionMode, PointType, LineColor, PlanimetryEditorProps } from '../types';
import { Maximize, Check, Trash2 } from 'lucide-react';
import { renderMapToBlob, getImageDimensions, generateId } from '../utils';

interface PlanimetryEditorInternalProps extends PlanimetryEditorProps {
  initialImageData?: string;
  initialImageName?: string;
  initialPoints?: MapPoint[];
  initialLines?: MapLine[];
  initialRotation?: number;
  initialMarkerScale?: number;
  planName?: string;
  onSaveData?: (data: {
    imageData: string;
    imageName: string;
    points: MapPoint[];
    lines: MapLine[];
    rotation: number;
    markerScale: number;
  }) => Promise<void>;
}

export const PlanimetryEditor: React.FC<PlanimetryEditorInternalProps> = ({
  projectId,
  floor,
  onClose,
  onSave,
  initialImageData,
  initialImageName,
  initialPoints = [],
  initialLines = [],
  initialRotation = 0,
  initialMarkerScale = 1,
  planName = '',
  onSaveData
}) => {
  // State: Data
  const [points, setPoints] = useState<MapPoint[]>(initialPoints);
  const [lines, setLines] = useState<MapLine[]>(initialLines);
  const [imageSrc, setImageSrc] = useState<string | null>(initialImageData || null);
  const [imageName, setImageName] = useState<string | null>(initialImageName || null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  const [rotation, setRotation] = useState<number>(initialRotation);
  const [markerScale, setMarkerScale] = useState<number>(initialMarkerScale);

  // State: UI & Modes
  const [mode, setMode] = useState<InteractionMode>('pan');
  const [activePointType, setActivePointType] = useState<PointType>('generic');
  const [activeLineColor, setActiveLineColor] = useState<LineColor>('#dc2626');

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [scale, setScale] = useState(1);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  // Dragging state (Markers)
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<'badge' | 'target'>('badge');

  // Creation state (Add Point / Line)
  const [creationStart, setCreationStart] = useState<{x: number, y: number} | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<{x: number, y: number} | null>(null);

  // Panning state (Map)
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [scrollStart, setScrollStart] = useState({ left: 0, top: 0 });

  // Refs
  const containerWrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load initial image dimensions
  useEffect(() => {
    if (initialImageData) {
      getImageDimensions(initialImageData).then(dims => {
        setImgSize(dims);
      });
    }
  }, [initialImageData]);

  // --- Helpers ---

  const getRelativeCoordinates = (clientX: number, clientY: number) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const dx = clientX - centerX;
      const dy = clientY - centerY;

      const radians = -rotation * (Math.PI / 180);
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);

      const rotatedDx = dx * cos - dy * sin;
      const rotatedDy = dx * sin + dy * cos;

      const width = containerRef.current.offsetWidth;
      const height = containerRef.current.offsetHeight;

      const localX = rotatedDx + width / 2;
      const localY = rotatedDy + height / 2;

      const xPercent = (localX / width) * 100;
      const yPercent = (localY / height) * 100;

      return { x: xPercent, y: yPercent };
  };

  // --- Save Handler ---
  const handleSave = async () => {
    if (!imageSrc || !onSaveData) return;
    try {
      await onSaveData({
        imageData: imageSrc,
        imageName: imageName || 'planimetria.png',
        points,
        lines,
        rotation,
        markerScale
      });
      onSave?.();
    } catch (e) {
      console.error(e);
      alert('Errore durante il salvataggio.');
    }
  };

  // --- Handlers: Image Upload ---

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (typeof event.target?.result === 'string') {
          const src = event.target.result;
          setImageSrc(src);
          const dims = await getImageDimensions(src);
          setImgSize(dims);
          setImageName(file.name);
          setPoints([]);
          setLines([]);
          setScale(1);
          setRotation(0);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  // --- Handlers: Map Interaction (Creation & Dragging) ---

  const handleMapMouseDown = (e: React.MouseEvent) => {
      if (mode === 'add' || mode === 'line') {
         if (!imageSrc || !containerRef.current) return;
         const coords = getRelativeCoordinates(e.clientX, e.clientY);
         if (coords.x < 0 || coords.x > 100 || coords.y < 0 || coords.y > 100) return;

         setCreationStart(coords);
         setCurrentMousePos(coords);
      }

      if (mode !== 'pan') {
          setSelectedLineId(null);
      }
  };

  const handleMapMouseUp = (e: React.MouseEvent) => {
      if (!creationStart) return;

      const endCoords = getRelativeCoordinates(e.clientX, e.clientY);

      if (mode === 'add') {
          const dx = endCoords.x - creationStart.x;
          const dy = endCoords.y - creationStart.y;
          const dist = Math.sqrt(dx*dx + dy*dy);

          const newPoint: MapPoint = {
              id: generateId(),
              number: points.length + 1,
              x: endCoords.x,
              y: endCoords.y,
              type: activePointType,
              description: '',
              createdAt: Date.now(),
          };

          if (dist > 1.0) {
              newPoint.targetX = creationStart.x;
              newPoint.targetY = creationStart.y;
          } else {
              newPoint.targetX = endCoords.x;
              newPoint.targetY = endCoords.y;
          }

          setPoints(prev => [...prev, newPoint]);
          setSelectedPointId(newPoint.id);
      } else if (mode === 'line') {
          const dx = endCoords.x - creationStart.x;
          const dy = endCoords.y - creationStart.y;
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
              const newLine: MapLine = {
                  id: generateId(),
                  startX: creationStart.x,
                  startY: creationStart.y,
                  endX: endCoords.x,
                  endY: endCoords.y,
                  color: activeLineColor
              };
              setLines(prev => [...prev, newLine]);
          }
      }

      setCreationStart(null);
      setCurrentMousePos(null);
  };

  // --- Handlers: Markers & Lines ---

  const handleMarkerMouseDown = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      e.preventDefault();

      setSelectedPointId(id);
      if (mode === 'move') {
          setDraggingPointId(id);
          setDragType('badge');
      }
  };

  const handleTargetMouseDown = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      e.preventDefault();

      setSelectedPointId(id);
      if (mode === 'move') {
          setDraggingPointId(id);
          setDragType('target');
      }
  };

  const handleLineClick = (e: React.MouseEvent, id: string) => {
      if (mode === 'pan') return;
      e.stopPropagation();
      setSelectedLineId(id);
  };

  const handleDeleteLine = (id: string) => {
      setLines(prev => prev.filter(l => l.id !== id));
      setSelectedLineId(null);
  };

  const updatePoint = (id: string, data: Partial<MapPoint>) => {
      setPoints(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (draggingPointId && containerRef.current) {
        const { x, y } = getRelativeCoordinates(e.clientX, e.clientY);
        setPoints(prev => prev.map(p => {
             if (p.id !== draggingPointId) return p;

             if (dragType === 'target') {
                 return {
                     ...p,
                     targetX: Math.max(0, Math.min(100, x)),
                     targetY: Math.max(0, Math.min(100, y))
                 };
             } else {
                 return {
                     ...p,
                     x: Math.max(0, Math.min(100, x)),
                     y: Math.max(0, Math.min(100, y))
                 };
             }
        }));
    }

    if ((mode === 'add' || mode === 'line') && creationStart && containerRef.current) {
        const coords = getRelativeCoordinates(e.clientX, e.clientY);
        setCurrentMousePos(coords);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingPointId, dragType, rotation, scale, mode, creationStart]);

  const handleGlobalMouseUp = useCallback(() => {
    setDraggingPointId(null);
    setIsPanning(false);
    document.body.style.cursor = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingPointId, dragType, handleGlobalMouseMove, handleGlobalMouseUp]);

  // --- Panning ---
  const handleContainerMouseDown = (e: React.MouseEvent) => {
      if (mode !== 'pan') return;
      if (!containerWrapperRef.current) return;
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      setScrollStart({
          left: containerWrapperRef.current.scrollLeft,
          top: containerWrapperRef.current.scrollTop
      });
      document.body.style.cursor = 'grabbing';
  };

  const handleContainerMouseMove = (e: React.MouseEvent) => {
      if (!isPanning || !containerWrapperRef.current) return;
      e.preventDefault();
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      containerWrapperRef.current.scrollLeft = scrollStart.left - dx;
      containerWrapperRef.current.scrollTop = scrollStart.top - dy;
  };

  const handleDeletePoint = (id: string) => {
    setPoints(prev => {
      const filtered = prev.filter(p => p.id !== id);
      return filtered.map((p, index) => ({ ...p, number: index + 1 }));
    });
    if (selectedPointId === id) setSelectedPointId(null);
  };

  // --- EXPORT IMAGE ---
  const handleExportImage = async () => {
      if (!imageSrc) return;

      const blob = await renderMapToBlob(imageSrc, points, lines, markerScale);

      if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${planName || 'planimetria'}_${floor}_export.jpg`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
      } else {
          alert("Si è verificato un errore durante l'esportazione della foto.");
      }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100">

      <Topbar
        mode={mode}
        setMode={setMode}
        scale={scale}
        onZoomIn={() => setScale(s => Math.min(s + 0.2, 5))}
        onZoomOut={() => setScale(s => Math.max(s - 0.2, 0.1))}
        onResetZoom={() => { setScale(1); setRotation(0); }}
        rotation={rotation}
        setRotation={setRotation}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        activePointType={activePointType}
        setActivePointType={setActivePointType}
        activeLineColor={activeLineColor}
        setActiveLineColor={setActiveLineColor}
        onSave={handleSave}
        onExportImage={handleExportImage}
        onClose={onClose}
        hasImage={!!imageSrc}
        markerScale={markerScale}
        onIncreaseMarkerSize={() => setMarkerScale(s => Math.min(s + 0.2, 3))}
        onDecreaseMarkerSize={() => setMarkerScale(s => Math.max(s - 0.2, 0.5))}
        planName={planName}
        floor={floor}
      />

      <div className="flex flex-1 relative overflow-hidden">

          <div className="flex-1 relative bg-slate-200 overflow-hidden">

            {!imageSrc && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 z-0 p-8 text-center m-8 rounded-xl border-4 border-dashed border-slate-300">
                    <Maximize className="w-20 h-20 mb-4 text-slate-300" />
                    <h1 className="text-2xl font-bold text-slate-600 mb-2">Carica Planimetria</h1>
                    <p className="max-w-md mb-6">Carica un'immagine della planimetria per iniziare ad annotare i punti.</p>
                    <label className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg shadow cursor-pointer">
                        Seleziona Immagine
                        <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    </label>
                </div>
            )}

            {imageSrc && (
                <div
                    ref={containerWrapperRef}
                    className={`absolute inset-0 overflow-auto bg-slate-200 grid place-items-center
                        ${mode === 'pan' ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}
                        ${(mode === 'add' || mode === 'line') ? 'cursor-crosshair' : ''}
                        ${mode === 'move' ? 'cursor-default' : ''}
                    `}
                    onMouseDown={handleContainerMouseDown}
                    onMouseMove={handleContainerMouseMove}
                >
                    <div
                        style={{
                            width: `${imgSize.w * scale}px`,
                            height: `${imgSize.h * scale}px`,
                        }}
                        className="relative shadow-2xl bg-white select-none flex-none"
                    >
                        <div
                            ref={containerRef}
                            className="w-full h-full relative"
                            style={{ transform: `rotate(${rotation}deg)` }}
                            onMouseDown={handleMapMouseDown}
                            onMouseUp={handleMapMouseUp}
                        >
                            <img src={imageSrc} alt="Planimetria" className="w-full h-full object-contain pointer-events-none block" draggable={false} />

                            <svg className="absolute inset-0 w-full h-full z-0 pointer-events-none">
                                {lines.map(line => (
                                    <g key={line.id} className="pointer-events-auto cursor-pointer" onClick={(e) => handleLineClick(e, line.id)}>
                                        <line
                                            x1={`${line.startX}%`} y1={`${line.startY}%`}
                                            x2={`${line.endX}%`} y2={`${line.endY}%`}
                                            stroke="transparent" strokeWidth={15 * markerScale}
                                        />
                                        <line
                                            x1={`${line.startX}%`} y1={`${line.startY}%`}
                                            x2={`${line.endX}%`} y2={`${line.endY}%`}
                                            stroke={line.color} strokeWidth={3 * markerScale}
                                            strokeOpacity={0.8}
                                            strokeLinecap="round"
                                            className={selectedLineId === line.id ? 'filter drop-shadow-[0_0_2px_rgba(0,0,0,0.5)]' : ''}
                                        />
                                        {selectedLineId === line.id && (
                                            <line
                                                x1={`${line.startX}%`} y1={`${line.startY}%`}
                                                x2={`${line.endX}%`} y2={`${line.endY}%`}
                                                stroke="white" strokeWidth={1} strokeDasharray="4,4"
                                            />
                                        )}
                                    </g>
                                ))}

                                {mode === 'line' && creationStart && currentMousePos && (
                                    <line
                                        x1={`${creationStart.x}%`} y1={`${creationStart.y}%`}
                                        x2={`${currentMousePos.x}%`} y2={`${currentMousePos.y}%`}
                                        stroke={activeLineColor} strokeWidth={3 * markerScale} strokeOpacity={0.6}
                                    />
                                )}

                                {points.map(p => {
                                    if (p.targetX !== undefined && p.targetY !== undefined &&
                                        (Math.abs(p.targetX - p.x) > 0.1 || Math.abs(p.targetY - p.y) > 0.1)) {
                                        return (
                                            <g key={`line-${p.id}`}>
                                                <line
                                                    x1={`${p.targetX}%`} y1={`${p.targetY}%`}
                                                    x2={`${p.x}%`} y2={`${p.y}%`}
                                                    stroke="#dc2626" strokeWidth={2 * markerScale} strokeLinecap="round"
                                                />
                                                <circle
                                                    cx={`${p.targetX}%`} cy={`${p.targetY}%`} r={3 * markerScale} fill="#dc2626"
                                                    className={mode === 'move' ? 'cursor-move pointer-events-auto hover:fill-blue-600' : ''}
                                                    onMouseDown={(e) => handleTargetMouseDown(e, p.id)}
                                                />
                                            </g>
                                        );
                                    }
                                    return null;
                                })}

                                {mode === 'add' && creationStart && currentMousePos && (
                                     <g>
                                        <line
                                            x1={`${creationStart.x}%`} y1={`${creationStart.y}%`}
                                            x2={`${currentMousePos.x}%`} y2={`${currentMousePos.y}%`}
                                            stroke="#dc2626" strokeWidth={2 * markerScale} strokeDasharray="5,5"
                                        />
                                        <circle cx={`${creationStart.x}%`} cy={`${creationStart.y}%`} r={3 * markerScale} fill="#dc2626" />
                                     </g>
                                )}
                            </svg>

                            {selectedLineId && (() => {
                                const line = lines.find(l => l.id === selectedLineId);
                                if (!line) return null;
                                const midX = (line.startX + line.endX) / 2;
                                const midY = (line.startY + line.endY) / 2;
                                return (
                                    <button
                                        onClick={() => handleDeleteLine(line.id)}
                                        className="absolute z-20 bg-white text-red-600 rounded-full p-1 shadow-md border border-red-200 hover:bg-red-50"
                                        style={{ left: `${midX}%`, top: `${midY}%`, transform: 'translate(-50%, -50%)' }}
                                        title="Elimina Linea"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                );
                            })()}

                            {points.map((point) => (
                                <Marker
                                    key={point.id}
                                    point={point}
                                    scale={scale}
                                    markerScale={markerScale}
                                    isSelected={selectedPointId === point.id}
                                    onMouseDown={handleMarkerMouseDown}
                                    onDelete={handleDeletePoint}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            )}
          </div>

          <Sidebar
            points={points}
            isOpen={isSidebarOpen}
            onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
            onDeletePoint={handleDeletePoint}
            onSelectPoint={setSelectedPointId}
            onUpdatePoint={updatePoint}
            selectedPointId={selectedPointId}
            imageName={imageName}
            planName={planName || 'Planimetria'}
            floor={floor}
          />
      </div>
    </div>
  );
};
