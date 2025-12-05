import React from 'react';
import { InteractionMode, PointType, LineColor } from '../types';
import {
  Hand, MousePointer2, PlusCircle, ZoomIn, ZoomOut, RotateCcw,
  Menu, Save, ImageDown, RefreshCw, Circle, CircleDashed,
  PenTool, X
} from 'lucide-react';
import { PointIcon, getPointTypeLabel } from './PointIcons';

interface TopbarProps {
  mode: InteractionMode;
  setMode: (m: InteractionMode) => void;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  rotation: number;
  setRotation: (deg: number) => void;
  onToggleSidebar: () => void;
  activePointType: PointType;
  setActivePointType: (t: PointType) => void;
  activeLineColor: LineColor;
  setActiveLineColor: (c: LineColor) => void;
  onSave: () => void;
  onExportImage: () => void;
  onClose: () => void;
  hasImage: boolean;
  markerScale: number;
  onIncreaseMarkerSize: () => void;
  onDecreaseMarkerSize: () => void;
  planName?: string;
  floor?: string;
}

export const Topbar: React.FC<TopbarProps> = ({
  mode,
  setMode,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  rotation,
  setRotation,
  onToggleSidebar,
  activePointType,
  setActivePointType,
  activeLineColor,
  setActiveLineColor,
  onSave,
  onExportImage,
  onClose,
  hasImage,
  markerScale,
  onIncreaseMarkerSize,
  onDecreaseMarkerSize,
  planName,
  floor
}) => {
  const availableTypes: PointType[] = ['generic', 'floor-single', 'wall-single', 'floor-multi', 'wall-multi'];

  const colors: { val: LineColor, label: string }[] = [
      { val: '#dc2626', label: 'Rosso' },
      { val: '#2563eb', label: 'Blu' },
      { val: '#06b6d4', label: 'Azzurro' },
      { val: '#16a34a', label: 'Verde' },
      { val: '#f97316', label: 'Arancio' },
  ];

  return (
    <div className="h-14 bg-slate-900 text-white flex items-center justify-between px-4 shadow-md z-50 flex-shrink-0">

      {/* Left: Title and Close */}
      <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          className="p-2 hover:bg-slate-800 rounded text-slate-300 hover:text-white transition-colors"
          title="Chiudi Editor"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="hidden sm:block">
          <div className="font-bold text-lg text-blue-400">
            {planName || 'Planimetria'}
          </div>
          {floor && <div className="text-xs text-slate-400">Piano: {floor}</div>}
        </div>

        <div className="w-px h-6 bg-slate-700 mx-2 hidden sm:block"></div>

        <button
            onClick={onSave}
            disabled={!hasImage}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-green-700 hover:bg-green-600 transition-colors text-sm disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          <span className="hidden md:inline">Salva</span>
        </button>

        <button
             onClick={onExportImage}
             disabled={!hasImage}
             className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 transition-colors text-sm disabled:opacity-50"
             title="Scarica come immagine (JPG)"
        >
             <ImageDown className="w-4 h-4" />
             <span className="hidden md:inline">Esporta</span>
        </button>
      </div>

      {/* Center: Tools (Only visible if image loaded) */}
      {hasImage && (
          <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
            <button
                onClick={() => setMode('pan')}
                className={`p-2 rounded ${mode === 'pan' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                title="Sposta (Pan)"
            >
                <Hand className="w-5 h-5" />
            </button>
            <button
                onClick={() => setMode('add')}
                className={`p-2 rounded ${mode === 'add' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                title="Aggiungi Punti"
            >
                <PlusCircle className="w-5 h-5" />
            </button>
            <button
                onClick={() => setMode('line')}
                className={`p-2 rounded ${mode === 'line' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                title="Disegna Linea"
            >
                <PenTool className="w-5 h-5" />
            </button>
            <button
                onClick={() => setMode('move')}
                className={`p-2 rounded ${mode === 'move' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                title="Muovi Punti"
            >
                <MousePointer2 className="w-5 h-5" />
            </button>

            <div className="w-px h-5 bg-slate-600 mx-1"></div>

            {/* Type Selector (Add Mode) */}
            {mode === 'add' && (
                <div className="flex items-center gap-1 px-1 border-r border-slate-600 mr-1 pr-2">
                    {availableTypes.map(type => (
                        <button
                            key={type}
                            onClick={() => setActivePointType(type)}
                            title={getPointTypeLabel(type)}
                            className={`p-1 rounded ${activePointType === type ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                        >
                            <div className="w-4 h-4"><PointIcon type={type} /></div>
                        </button>
                    ))}
                </div>
            )}

             {/* Color Selector (Line Mode) */}
             {mode === 'line' && (
                <div className="flex items-center gap-1 px-1 border-r border-slate-600 mr-1 pr-2">
                    {colors.map(c => (
                        <button
                            key={c.val}
                            onClick={() => setActiveLineColor(c.val)}
                            title={c.label}
                            className={`w-6 h-6 rounded-full border-2 transition-all ${activeLineColor === c.val ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                            style={{ backgroundColor: c.val }}
                        />
                    ))}
                </div>
            )}

            <button onClick={onZoomOut} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded"><ZoomOut className="w-4 h-4" /></button>
            <button onClick={onZoomIn} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded"><ZoomIn className="w-4 h-4" /></button>
            <button onClick={onResetZoom} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded" title="Reset Zoom"><RotateCcw className="w-4 h-4" /></button>

             <div className="w-px h-5 bg-slate-600 mx-1"></div>

            {/* Marker Size Controls */}
            <button onClick={onDecreaseMarkerSize} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded" title="Riduci Simboli">
                <CircleDashed className="w-3 h-3" />
            </button>
            <button onClick={onIncreaseMarkerSize} className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded" title="Ingrandisci Simboli">
                <Circle className="w-5 h-5" />
            </button>

            {/* Rotation */}
            <div className="flex items-center gap-1 px-2 border-l border-slate-600">
                <RefreshCw className="w-3 h-3 text-slate-400" />
                <input
                    type="number"
                    min="0" max="360"
                    value={rotation}
                    onChange={(e) => setRotation(parseFloat(e.target.value) || 0)}
                    className="w-10 bg-slate-900 text-white text-xs border border-slate-600 rounded px-1 py-0.5 text-center focus:border-blue-500 outline-none"
                />
            </div>
          </div>
      )}

      {/* Right: Sidebar Toggle */}
      <div className="flex items-center">
        <button
            onClick={onToggleSidebar}
            className="p-2 hover:bg-slate-800 rounded text-slate-300 hover:text-white transition-colors"
        >
            <Menu className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
