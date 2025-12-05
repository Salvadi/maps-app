import React from 'react';
import { PointType } from '../types';

export const getPointTypeLabel = (type: PointType): string => {
  switch (type) {
    case 'generic': return 'Generico';
    case 'floor-single': return 'Solaio Singolo';
    case 'wall-single': return 'Parete Singola';
    case 'floor-multi': return 'Solaio Multiplo';
    case 'wall-multi': return 'Parete Multipla';
    default: return 'Punto';
  }
};

export const getPointIconSVGString = (type: PointType, color: string = '#dc2626'): string => {
    const header = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="64" height="64">`;
    const footer = `</svg>`;
    let content = '';

    switch (type) {
        case 'floor-single':
            content = `<rect x="2" y="11" width="20" height="2" fill="${color}" opacity="0.5" /><path d="M12 2v20" /><path d="M8 18l4 4 4-4" />`;
            break;
        case 'wall-single':
            content = `<rect x="11" y="2" width="2" height="20" fill="${color}" opacity="0.5" /><path d="M2 12h20" /><path d="M18 8l4 4-4 4" />`;
            break;
        case 'floor-multi':
            content = `<rect x="2" y="11" width="20" height="2" fill="${color}" opacity="0.5" /><path d="M8 4v16" /><path d="M6 17l2 3 2-3" /><path d="M16 4v16" /><path d="M14 17l2 3 2-3" /><path d="M12 5v2" />`;
            break;
        case 'wall-multi':
            content = `<rect x="11" y="2" width="2" height="20" fill="${color}" opacity="0.5" /><path d="M4 8h16" /><path d="M17 6l3 2-3 2" /><path d="M4 16h16" /><path d="M17 14l3 2-3 2" />`;
            break;
        case 'generic':
        default:
            content = `<path d="M12 2c0 0-9 5.4-9 12a9 9 0 0 0 18 0c0-6.6-9-12-9-12zm0 18a4 4 0 0 1-4-4c0-2 2-4 2-4s0 2 2 2 2 2 2 4a4 4 0 0 1-4 4z" fill="${color}" stroke="none" />`;
            break;
    }

    return `data:image/svg+xml;base64,${btoa(header + content + footer)}`;
};

export const PointIcon: React.FC<{ type: PointType; className?: string }> = ({ type, className = "w-6 h-6" }) => {
  switch (type) {
    case 'floor-single':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <rect x="2" y="11" width="20" height="2" fill="currentColor" opacity="0.5" />
          <path d="M12 2v20" />
          <path d="M8 18l4 4 4-4" />
        </svg>
      );
    case 'wall-single':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <rect x="11" y="2" width="2" height="20" fill="currentColor" opacity="0.5" />
          <path d="M2 12h20" />
          <path d="M18 8l4 4-4 4" />
        </svg>
      );
    case 'floor-multi':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <rect x="2" y="11" width="20" height="2" fill="currentColor" opacity="0.5" />
          <path d="M8 4v16" />
          <path d="M6 17l2 3 2-3" />
          <path d="M16 4v16" />
          <path d="M14 17l2 3 2-3" />
          <path d="M12 5v2" />
        </svg>
      );
    case 'wall-multi':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <rect x="11" y="2" width="2" height="20" fill="currentColor" opacity="0.5" />
          <path d="M4 8h16" />
          <path d="M17 6l3 2-3 2" />
          <path d="M4 16h16" />
          <path d="M17 14l3 2-3 2" />
        </svg>
      );
    case 'generic':
    default:
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
          <path d="M12 2c0 0-9 5.4-9 12a9 9 0 0 0 18 0c0-6.6-9-12-9-12zm0 18a4 4 0 0 1-4-4c0-2 2-4 2-4s0 2 2 2 2 2 2 4a4 4 0 0 1-4 4z" />
        </svg>
      );
  }
};
