import React from 'react';
import { MapPoint } from '../types';
import { PointIcon } from './PointIcons';

interface MarkerProps {
  point: MapPoint;
  scale: number;
  markerScale: number;
  isSelected: boolean;
  onMouseDown: (e: React.MouseEvent, pointId: string) => void;
  onDelete: (pointId: string) => void;
}

export const Marker: React.FC<MarkerProps> = ({
  point,
  scale,
  markerScale,
  isSelected,
  onMouseDown,
}) => {
  const baseSize = 40 * markerScale;
  const markerSize = baseSize;
  const badgeSize = (baseSize / 2.2);
  const badgeFontSize = (baseSize / 3.5);
  const iconSize = (baseSize / 1.6);

  return (
    <div
      className={`absolute flex flex-col items-center justify-center cursor-move group transition-transform duration-75 z-10`}
      style={{
        left: `${point.x}%`,
        top: `${point.y}%`,
        transform: 'translate(-50%, -50%)',
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onMouseDown(e, point.id);
      }}
    >
      <div
        className={`
          relative flex items-center justify-center
          rounded-full shadow-lg border-2
          transition-colors duration-200
          ${isSelected ? 'bg-blue-600 border-white text-white z-50 ring-2 ring-blue-300' : 'bg-white border-red-500 text-red-600'}
        `}
        style={{
          width: `${markerSize}px`,
          height: `${markerSize}px`,
        }}
      >
        <div style={{ width: `${iconSize}px`, height: `${iconSize}px` }}>
            <PointIcon type={point.type} className="w-full h-full" />
        </div>

        <div
          className={`
            absolute -top-1 -right-1 flex items-center justify-center rounded-full shadow-sm font-bold border
            ${isSelected ? 'bg-white text-blue-700 border-blue-700' : 'bg-red-600 text-white border-white'}
          `}
          style={{
            width: `${badgeSize}px`,
            height: `${badgeSize}px`,
            fontSize: `${badgeFontSize}px`,
            lineHeight: 1
          }}
        >
          {point.number}
        </div>
      </div>

      <div
        className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 bg-black/80 text-white px-2 py-1 rounded pointer-events-none whitespace-nowrap backdrop-blur-sm transition-opacity"
        style={{ fontSize: '12px' }}
      >
        <span className="font-bold">#{point.number}</span> {point.description ? `- ${point.description}` : ''}
      </div>
    </div>
  );
};
