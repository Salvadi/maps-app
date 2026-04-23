/**
 * 
 * Export utilities for floor plans
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, degrees } from 'pdf-lib';

// EI (Fire Resistance) rating colors - must match FloorPlanCanvas.tsx
const EI_COLORS: Record<number, string> = {
  30: '#4CAF50',   // Green
  60: '#2196F3',   // Blue
  90: '#FF9800',   // Orange
  120: '#9C27B0',  // Purple
  180: '#F44336',  // Red
  240: '#795548',  // Brown
};

// ============================================
// SEZIONE: Export vettoriale PDF con pdf-lib
// Genera PDF con annotazioni vettoriali (punti, etichette, linee, perimetri)
// a partire dai dati normalizzati — senza passare per un canvas HTML.
// ============================================

/**
 * Punto normalizzato per l'export vettoriale.
 * Accettato sia da CanvasPoint (FloorPlanCanvas) sia da FloorPlanPoint (DB).
 */
export interface ExportPoint {
  type: 'parete' | 'solaio' | 'perimetro' | 'generico';
  pointX: number;   // 0-1 normalizzato
  pointY: number;   // 0-1 normalizzato
  labelX: number;   // 0-1 normalizzato
  labelY: number;   // 0-1 normalizzato
  labelText: string[];
  perimeterPoints?: Array<{ x: number; y: number }>;
  labelBackgroundColor?: string;  // hex #RRGGBB
  labelTextColor?: string;        // hex #RRGGBB
  eiRating?: 30 | 60 | 90 | 120 | 180 | 240;  // Fire resistance rating (EI)
}

export interface ExportCartiglioData {
  positionX?: number;
  positionY?: number;
  tavola?: string;
  typologyNumbers?: number[];
  typologyValues?: Record<string, string>;
  committente?: string;
  locali?: string;
}

// Costanti canvas originale (in px, su immagine a risoluzione piena)
// Vengono moltiplicate per scale (min(pageW/imgW, pageH/imgH)) per ottenere pt nel PDF
const CANVAS_FONT_SIZE   = 14;
const CANVAS_LINE_HEIGHT = 18;
const CANVAS_PADDING     = 8;
const CANVAS_MIN_LABEL_W = 70;
const CANVAS_MIN_LABEL_H = 36;
const CANVAS_POINT_R     = 8;
const EXPORT_DEFAULT_BG  = '#FAFAF0';
const CARTIGLIO_INSTALLER_LINES = [
  'Installatore : Opi Firesafe SrL',
  'via G. Galilei, 9 - 33010 Tavagnacco (Ud)',
  'Tel : 0432 1901608',
  'mail : tecnico@opifiresafe.com',
  'web : www.opifiresafe.com',
] as const;

interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CartiglioRow {
  key: string;
  label: string;
  value: string;
  wrappedLines: string[];
  height: number;
}

interface CartiglioTypologyLayout extends PdfRect {
  rows: CartiglioRow[];
  prefixWidth: number;
  rowHeight: number;
  labelFontSize: number;
  textFontSize: number;
  rowPaddingY: number;
  textInsetX: number;
}

interface CartiglioLayout {
  height: number;
  x: number;
  y: number;
  width: number;
  tavolaBox: PdfRect & {
    padding: number;
    labelFontSize: number;
    fieldFontSize: number;
  };
  typologyBox: CartiglioTypologyLayout;
  infoBox: PdfRect & {
    padding: number;
    fontSize: number;
    lineHeight: number;
  };
  signatureBox: PdfRect & {
    padding: number;
    fontSize: number;
  };
}

/** Converte hex (#RRGGBB) in rgb() di pdf-lib */
function hexToRgbLib(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
}

/** Colore del punto per tipo */
function getExportPointColor(type: string): string {
  switch (type) {
    case 'parete':    return '#0066FF';
    case 'solaio':    return '#00CC66';
    case 'perimetro': return '#FF6600';
    case 'generico':  return '#9933FF';
    default:          return '#333333';
  }
}

function wrapTextToWidth(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return [''];
  const words = normalized.split(' ');
  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${currentLine} ${words[i]}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = words[i];
    }
  }

  lines.push(currentLine);
  return lines;
}

function buildCartiglioLayout(
  pageW: number,
  _planAreaH: number,
  _fontBold: PDFFont,
  fontRegular: PDFFont,
  cartiglio?: ExportCartiglioData | null,
): CartiglioLayout | null {
  if (!cartiglio) {
    return null;
  }

  const scale = Math.max(0.72, Math.min(pageW / 841.89, 1.1));
  const outerMargin = 16 * scale;
  const gap = 10 * scale;
  const layoutWidth = Math.min(pageW - outerMargin * 2, 640 * scale);
  const tavolaHeight = 24 * scale;
  const tavolaWidth = 108 * scale;
  const tavolaPadding = 6 * scale;
  const tavolaLabelFontSize = 9 * scale;
  const tavolaFieldFontSize = 10 * scale;
  const prefixWidth = 26 * scale;
  const typologyLabelFontSize = 8.5 * scale;
  const typologyTextFontSize = 8.5 * scale;
  const infoLineHeight = 11 * scale;
  const infoPadding = 7 * scale;
  const infoFontSize = 7.5 * scale;
  const signatureFontSize = 8 * scale;
  const sortedTypologyNumbers = [...(cartiglio.typologyNumbers || [])].sort((a, b) => a - b);
  const signatureWidth = layoutWidth * 0.3;
  const typologyWidth = layoutWidth;
  const typologyTextWidth = typologyWidth - prefixWidth - 14 * scale;
  const rawRows = (sortedTypologyNumbers.length > 0 ? sortedTypologyNumbers : [0]).map((num, index) => {
    const key = num ? String(num) : `empty-${index}`;
    const label = num ? `${num})` : '';
    const value = cartiglio.typologyValues?.[key] || '';
    const wrappedLines = wrapTextToWidth(value, fontRegular, typologyTextFontSize, typologyTextWidth);
    return { key, label, value, wrappedLines };
  });
  const maxWrappedLines = Math.max(1, ...rawRows.map((row) => Math.max(1, row.wrappedLines.length)));
  const uniformRowHeight = Math.max(18 * scale, maxWrappedLines * (typologyTextFontSize * 1.18) + 6 * scale);
  const rows = rawRows.map((row) => ({ ...row, height: uniformRowHeight }));
  const typologyHeight = rows.length * uniformRowHeight + 8 * scale;
  const infoWidth = layoutWidth - signatureWidth - gap;
  const infoBoxHeight = 86 * scale;
  const signatureBoxHeight = infoBoxHeight;
  const totalHeight = tavolaHeight + gap + typologyHeight + gap + infoBoxHeight;
  const usableWidth = Math.max(1, pageW - layoutWidth);
  const desiredX = (cartiglio.positionX ?? 0.03) * usableWidth;
  const x = Math.max(outerMargin, Math.min(pageW - layoutWidth - outerMargin, desiredX));
  const bottomMargin = 12 * scale;
  const y = bottomMargin;
  const topY = y + totalHeight;

  return {
    height: totalHeight + bottomMargin,
    x,
    y,
    width: layoutWidth,
    tavolaBox: {
      x,
      y: topY - tavolaHeight,
      width: tavolaWidth,
      height: tavolaHeight,
      padding: tavolaPadding,
      labelFontSize: tavolaLabelFontSize,
      fieldFontSize: tavolaFieldFontSize,
    },
    typologyBox: {
      x,
      y: topY - tavolaHeight - gap - typologyHeight,
      width: typologyWidth,
      height: typologyHeight,
      rows,
      prefixWidth,
      rowHeight: 0,
      labelFontSize: typologyLabelFontSize,
      textFontSize: typologyTextFontSize,
      rowPaddingY: 4 * scale,
      textInsetX: 8 * scale,
    },
    signatureBox: {
      x: x + infoWidth + gap,
      y,
      width: signatureWidth,
      height: signatureBoxHeight,
      padding: infoPadding,
      fontSize: signatureFontSize,
    },
    infoBox: {
      x,
      y,
      width: infoWidth,
      height: infoBoxHeight,
      padding: infoPadding,
      fontSize: infoFontSize,
      lineHeight: infoLineHeight,
    },
  };
}

function drawCartiglioBorder(
  page: ReturnType<PDFDocument['addPage']>,
  rect: PdfRect,
): void {
  page.drawRectangle({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    borderColor: rgb(0.882, 0.329, 0.235),
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });
}

function drawCartiglio(
  page: ReturnType<PDFDocument['addPage']>,
  fontBold: PDFFont,
  fontRegular: PDFFont,
  layout: CartiglioLayout,
  cartiglio: ExportCartiglioData,
): void {
  drawCartiglioBorder(page, layout.tavolaBox);
  page.drawText('TAVOLA', {
    x: layout.tavolaBox.x + layout.tavolaBox.padding,
    y: layout.tavolaBox.y + (layout.tavolaBox.height - layout.tavolaBox.labelFontSize) / 2,
    font: fontBold,
    size: layout.tavolaBox.labelFontSize,
    color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText(cartiglio.tavola || '', {
    x: layout.tavolaBox.x + 46,
    y: layout.tavolaBox.y + (layout.tavolaBox.height - layout.tavolaBox.fieldFontSize) / 2,
    font: fontRegular,
    size: layout.tavolaBox.fieldFontSize,
    color: rgb(0.1, 0.1, 0.1),
  });

  drawCartiglioBorder(page, layout.typologyBox);
  page.drawLine({
    start: { x: layout.typologyBox.x + layout.typologyBox.prefixWidth, y: layout.typologyBox.y },
    end: { x: layout.typologyBox.x + layout.typologyBox.prefixWidth, y: layout.typologyBox.y + layout.typologyBox.height },
    color: rgb(0.882, 0.329, 0.235),
    thickness: 1,
  });
  let cursorY = layout.typologyBox.y + layout.typologyBox.height - layout.typologyBox.rowPaddingY;
  layout.typologyBox.rows.forEach((row, rowIndex) => {
    const rowTop = cursorY;
    const rowBottom = rowTop - row.height;

    if (rowIndex > 0) {
      page.drawLine({
        start: { x: layout.typologyBox.x, y: rowTop },
        end: { x: layout.typologyBox.x + layout.typologyBox.width, y: rowTop },
        color: rgb(0.882, 0.329, 0.235),
        thickness: 0.75,
      });
    }

    if (row.label) {
      page.drawText(row.label, {
        x: layout.typologyBox.x + 4,
        y: rowBottom + (row.height - layout.typologyBox.labelFontSize) / 2,
        font: fontBold,
        size: layout.typologyBox.labelFontSize,
        color: rgb(0.1, 0.1, 0.1),
      });
    }

    const lineHeight = layout.typologyBox.textFontSize * 1.25;
    const textBlockHeight = Math.max(lineHeight, row.wrappedLines.length * lineHeight);
    let textY = rowBottom + (row.height + textBlockHeight) / 2 - lineHeight;
    row.wrappedLines.forEach((line) => {
      page.drawText(line, {
        x: layout.typologyBox.x + layout.typologyBox.prefixWidth + layout.typologyBox.textInsetX,
        y: textY,
        font: fontRegular,
        size: layout.typologyBox.textFontSize,
        color: rgb(0.1, 0.1, 0.1),
      });
      textY -= lineHeight;
    });

    cursorY = rowBottom;
  });

  drawCartiglioBorder(page, layout.infoBox);
  const infoRows = [
    ...CARTIGLIO_INSTALLER_LINES,
    'Committente :',
    'Locali :',
  ];
  const infoTop = layout.infoBox.y + layout.infoBox.height - layout.infoBox.padding;
  const infoBottom = layout.infoBox.y + layout.infoBox.padding;
  const rowSlotHeight = (infoTop - infoBottom) / infoRows.length;
  infoRows.forEach((line, index) => {
    const baselineY = infoTop - ((index + 1) * rowSlotHeight) + ((rowSlotHeight - layout.infoBox.fontSize) / 2);
    if (index < CARTIGLIO_INSTALLER_LINES.length) {
      page.drawText(line, {
        x: layout.infoBox.x + layout.infoBox.padding,
        y: baselineY,
        font: fontRegular,
        size: layout.infoBox.fontSize,
        color: rgb(0.1, 0.1, 0.1),
      });
      return;
    }

    page.drawText(line, {
      x: layout.infoBox.x + layout.infoBox.padding,
      y: baselineY,
      font: fontRegular,
      size: layout.infoBox.fontSize,
      color: rgb(0.1, 0.1, 0.1),
    });

    const isCommittente = index === CARTIGLIO_INSTALLER_LINES.length;
    const labelWidth = fontRegular.widthOfTextAtSize(line, layout.infoBox.fontSize);
    page.drawText(isCommittente ? (cartiglio.committente || '') : (cartiglio.locali || ''), {
      x: layout.infoBox.x + layout.infoBox.padding + labelWidth + 6,
      y: baselineY,
      font: fontRegular,
      size: layout.infoBox.fontSize,
      color: rgb(0.1, 0.1, 0.1),
    });
  });

  drawCartiglioBorder(page, layout.signatureBox);
}

/** Calcola dimensioni etichetta usando i font pdf-lib.
 *  Accetta dimensioni dinamiche (calcolate in base allo scale dell'immagine).
 */
function getLabelDimensions(
  lines: string[],
  fontBold: PDFFont,
  fontItalic: PDFFont,
  fontSize: number,
  padding: number,
  lineHeight: number,
  minLabelW: number,
  minLabelH: number,
): { width: number; height: number } {
  let maxWidth = 0;
  for (const line of lines) {
    let lineWidth: number;
    if (line.startsWith('foto n. ')) {
      lineWidth = fontItalic.widthOfTextAtSize('foto n. ', fontSize)
               + fontBold.widthOfTextAtSize(line.substring(8), fontSize);
    } else if (line.startsWith('Tip. ')) {
      lineWidth = fontItalic.widthOfTextAtSize('Tip. ', fontSize)
               + fontBold.widthOfTextAtSize(line.substring(5), fontSize);
    } else {
      lineWidth = fontBold.widthOfTextAtSize(line, fontSize);
    }
    if (lineWidth > maxWidth) maxWidth = lineWidth;
  }
  return {
    width:  Math.max(maxWidth + padding * 2, minLabelW),
    height: Math.max(lines.length * lineHeight + padding * 2, minLabelH),
  };
}

/**
 * Trova il midpoint del bordo dell'etichetta più vicino a `from`.
 * Coordinate PDF (bottom-left origin).
 * @param from  punto di partenza (PDF coords)
 * @param label rettangolo etichetta (x,y = bottom-left in PDF coords)
 */
function nearestLabelEdge(
  from: { x: number; y: number },
  label: { x: number; y: number; w: number; h: number }
): { x: number; y: number } {
  const cx = label.x + label.w / 2;
  const cy = label.y + label.h / 2;
  const edges = [
    { x: cx,           y: label.y + label.h },  // bordo top
    { x: cx,           y: label.y             },  // bordo bottom
    { x: label.x,      y: cy                  },  // bordo left
    { x: label.x + label.w, y: cy             },  // bordo right
  ];
  let minDist = Infinity;
  let nearest = edges[0];
  for (const edge of edges) {
    const d = Math.hypot(edge.x - from.x, edge.y - from.y);
    if (d < minDist) { minDist = d; nearest = edge; }
  }
  return nearest;
}

/**
 * Trova il punto più vicino al centro sull'insieme dei segmenti del perimetro.
 * @param center  centro dell'etichetta (PDF coords)
 * @param perimeterPts  vertici normalizzati del perimetro
 * @param toX  helper: normalizzato → PDF X
 * @param toY  helper: normalizzato → PDF Y
 */
function nearestPerimeterPoint(
  center: { x: number; y: number },
  perimeterPts: Array<{ x: number; y: number }>,
  toX: (nx: number) => number,
  toY: (ny: number) => number
): { x: number; y: number } {
  let minDist = Infinity;
  let closest = { x: center.x, y: center.y };
  for (let i = 0; i < perimeterPts.length - 1; i++) {
    const p1 = { x: toX(perimeterPts[i].x),     y: toY(perimeterPts[i].y) };
    const p2 = { x: toX(perimeterPts[i + 1].x), y: toY(perimeterPts[i + 1].y) };
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1,
      ((center.x - p1.x) * dx + (center.y - p1.y) * dy) / lenSq
    ));
    const seg = { x: p1.x + t * dx, y: p1.y + t * dy };
    const d = Math.hypot(seg.x - center.x, seg.y - center.y);
    if (d < minDist) { minDist = d; closest = seg; }
  }
  return closest;
}

// ============================================
// Helper privato: disegna annotazioni su una pagina già creata/copiata.
// Parametri di layout calcolati dal chiamante (raster o vettoriale).
// ============================================

function _drawAnnotationsOnPage(
  page: ReturnType<PDFDocument['addPage']>,
  points: ExportPoint[],
  pageH: number,
  effectiveW: number,
  effectiveH: number,
  offsetX: number,
  offsetY: number,
  scale: number,
  fontBold: PDFFont,
  fontItalic: PDFFont,
  eiLegendPosition?: { x: number; y: number } | null,
): void {
  const dynFontSize   = Math.max(3, CANVAS_FONT_SIZE   * scale);
  const dynLineHeight = CANVAS_LINE_HEIGHT * scale;
  const dynPadding    = CANVAS_PADDING     * scale;
  const dynMinLabelW  = CANVAS_MIN_LABEL_W * scale;
  const dynMinLabelH  = CANVAS_MIN_LABEL_H * scale;
  const dynPointR     = Math.max(2, CANVAS_POINT_R * scale);
  const eiBorderWidth = 3 * scale;  // EI border thickness

  const toX    = (nx: number) => offsetX + nx * effectiveW;
  const toY    = (ny: number) => offsetY + (1 - ny) * effectiveH;
  const toSvgY = (ny: number) => (pageH - offsetY - effectiveH) + ny * effectiveH;

  // 1. Perimetri (dietro a tutto)
  for (const point of points) {
    if (point.type !== 'perimetro' || !point.perimeterPoints || point.perimeterPoints.length < 2) continue;
    const svgPath = point.perimeterPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x).toFixed(2)} ${toSvgY(p.y).toFixed(2)}`)
      .join(' ') + ' Z';
    page.drawSvgPath(svgPath, {
      x: 0,
      y: pageH,
      borderColor: hexToRgbLib('#FF6600'),
      borderWidth: 2,
      borderDashArray: [10, 5],
    });
  }

  // 2. Linee tratteggiate punto → etichetta
  for (const point of points) {
    const { width: lw, height: lh } = getLabelDimensions(
      point.labelText, fontBold, fontItalic,
      dynFontSize, dynPadding, dynLineHeight, dynMinLabelW, dynMinLabelH
    );
    const labelTopX    = toX(point.labelX);
    const labelTopY    = toY(point.labelY);
    const labelBottomY = labelTopY - lh;
    const labelRect    = { x: labelTopX, y: labelBottomY, w: lw, h: lh };
    const labelCenter  = { x: labelTopX + lw / 2, y: labelBottomY + lh / 2 };

    let lineStart: { x: number; y: number };
    let lineEnd: { x: number; y: number };

    if (point.type === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length >= 2) {
      const nearPerim = nearestPerimeterPoint(labelCenter, point.perimeterPoints, toX, toY);
      lineStart = nearPerim;
      lineEnd   = nearestLabelEdge(nearPerim, labelRect);
    } else {
      const ptPos = { x: toX(point.pointX), y: toY(point.pointY) };
      lineStart = ptPos;
      lineEnd   = nearestLabelEdge(ptPos, labelRect);
    }

    page.drawLine({
      start: lineStart,
      end:   lineEnd,
      color: rgb(0.4, 0.4, 0.4),
      thickness: 1,
      dashArray: [3, 3],
    });
  }

  // 3. Cerchi punto
  for (const point of points) {
    page.drawCircle({
      x: toX(point.pointX),
      y: toY(point.pointY),
      size: dynPointR,
      color: hexToRgbLib(getExportPointColor(point.type)),
    });
  }

  // 4. Etichette (in primo piano)
  for (const point of points) {
    const { width: lw, height: lh } = getLabelDimensions(
      point.labelText, fontBold, fontItalic,
      dynFontSize, dynPadding, dynLineHeight, dynMinLabelW, dynMinLabelH
    );
    const labelTopX    = toX(point.labelX);
    const labelTopY    = toY(point.labelY);
    const labelBottomY = labelTopY - lh;

    const bgColor   = point.labelBackgroundColor ? hexToRgbLib(point.labelBackgroundColor) : hexToRgbLib(EXPORT_DEFAULT_BG);
    const textColor = point.labelTextColor       ? hexToRgbLib(point.labelTextColor)       : rgb(0, 0, 0);

    // Draw EI rating outer border if set
    if (point.eiRating && EI_COLORS[point.eiRating]) {
      const eiColor = hexToRgbLib(EI_COLORS[point.eiRating]);
      const offset = eiBorderWidth / 2;
      page.drawRectangle({
        x: labelTopX - offset,
        y: labelBottomY - offset,
        width: lw + eiBorderWidth,
        height: lh + eiBorderWidth,
        borderColor: eiColor,
        borderWidth: eiBorderWidth,
      });
    }

    page.drawRectangle({
      x: labelTopX,
      y: labelBottomY,
      width: lw,
      height: lh,
      color: bgColor,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 1,
    });

    for (let i = 0; i < point.labelText.length; i++) {
      const line      = point.labelText[i];
      const baselineY = labelTopY - dynPadding - i * dynLineHeight - dynFontSize;
      const textX     = labelTopX + dynPadding;

      if (line.startsWith('foto n. ')) {
        const prefix  = 'foto n. ';
        const prefixW = fontItalic.widthOfTextAtSize(prefix, dynFontSize);
        page.drawText(prefix,              { x: textX,           y: baselineY, font: fontItalic, size: dynFontSize, color: textColor });
        page.drawText(line.substring(8),   { x: textX + prefixW, y: baselineY, font: fontBold,   size: dynFontSize, color: textColor });
      } else if (line.startsWith('Tip. ')) {
        const prefix  = 'Tip. ';
        const prefixW = fontItalic.widthOfTextAtSize(prefix, dynFontSize);
        page.drawText(prefix,              { x: textX,           y: baselineY, font: fontItalic, size: dynFontSize, color: textColor });
        page.drawText(line.substring(5),   { x: textX + prefixW, y: baselineY, font: fontBold,   size: dynFontSize, color: textColor });
      } else {
        page.drawText(line, { x: textX, y: baselineY, font: fontBold, size: dynFontSize, color: textColor });
      }
    }
  }

  // 5. EI Legend (if position is set and there are points with EI ratings)
  if (eiLegendPosition) {
    // Get unique EI ratings used
    const usedRatings = Array.from(new Set(
      points.filter(p => p.eiRating).map(p => p.eiRating!)
    )).sort((a, b) => a - b) as (30 | 60 | 90 | 120 | 180 | 240)[];

    if (usedRatings.length > 0) {
      const legendPadding = 8 * scale;
      const legendFontSize = 10 * scale;
      const legendLineHeight = 14 * scale;
      const legendTitleHeight = 16 * scale;
      const colorBoxSize = 12 * scale;
      const colorBoxBorder = 2.5 * scale;
      const gap = 5 * scale;

      // Calculate legend dimensions
      const titleWidth = fontBold.widthOfTextAtSize('Legenda PPA', legendFontSize);
      let maxTextWidth = titleWidth;
      for (const ei of usedRatings) {
        const textWidth = fontBold.widthOfTextAtSize(`EI ${ei}`, legendFontSize);
        maxTextWidth = Math.max(maxTextWidth, colorBoxSize + gap + textWidth);
      }
      const legendWidth = maxTextWidth + (legendPadding * 2);
      const legendHeight = legendTitleHeight + (usedRatings.length * legendLineHeight) + (legendPadding * 2);

      // Convert normalized position to page coordinates
      const legendX = toX(eiLegendPosition.x);
      const legendTopY = toY(eiLegendPosition.y);
      const legendBottomY = legendTopY - legendHeight;

      // Draw legend background
      page.drawRectangle({
        x: legendX,
        y: legendBottomY,
        width: legendWidth,
        height: legendHeight,
        color: rgb(1, 1, 1),
        borderColor: rgb(0.2, 0.2, 0.2),
        borderWidth: 1,
      });

      // Draw title
      page.drawText('Legenda PPA', {
        x: legendX + legendPadding,
        y: legendTopY - legendPadding - legendFontSize,
        font: fontBold,
        size: legendFontSize,
        color: rgb(0.2, 0.2, 0.2),
      });

      // Draw separator line
      page.drawLine({
        start: { x: legendX + legendPadding, y: legendTopY - legendPadding - legendTitleHeight + 2 * scale },
        end: { x: legendX + legendWidth - legendPadding, y: legendTopY - legendPadding - legendTitleHeight + 2 * scale },
        color: rgb(0.88, 0.88, 0.88),
        thickness: 0.5,
      });

      // Draw each EI rating
      let yOffset = legendPadding + legendTitleHeight;
      for (const ei of usedRatings) {
        const boxX = legendX + legendPadding;
        const boxY = legendTopY - yOffset - colorBoxSize;

        // Draw color box background
        page.drawRectangle({
          x: boxX,
          y: boxY,
          width: colorBoxSize,
          height: colorBoxSize,
          color: hexToRgbLib('#FAFAF0'),
        });

        // Draw EI colored border
        page.drawRectangle({
          x: boxX,
          y: boxY,
          width: colorBoxSize,
          height: colorBoxSize,
          borderColor: hexToRgbLib(EI_COLORS[ei]),
          borderWidth: colorBoxBorder,
        });

        // Draw inner border
        page.drawRectangle({
          x: boxX + colorBoxBorder / 2,
          y: boxY + colorBoxBorder / 2,
          width: colorBoxSize - colorBoxBorder,
          height: colorBoxSize - colorBoxBorder,
          borderColor: rgb(0.2, 0.2, 0.2),
          borderWidth: 0.3,
        });

        // Draw text
        page.drawText(`EI ${ei}`, {
          x: boxX + colorBoxSize + gap,
          y: boxY + colorBoxSize / 2 - legendFontSize / 3,
          font: fontBold,
          size: legendFontSize,
          color: rgb(0.2, 0.2, 0.2),
        });

        yOffset += legendLineHeight;
      }
    }
  }
}

/**
 * Genera PDF vettoriale con sfondo raster (PNG/JPEG) e annotazioni vettoriali.
 * Fallback quando il PDF originale non è disponibile.
 */
async function _buildWithRasterBackground(
  imageBlob: Blob,
  points: ExportPoint[],
  eiLegendPosition?: { x: number; y: number } | null,
  cartiglio?: ExportCartiglioData | null,
): Promise<Uint8Array> {
  const pdfDoc     = await PDFDocument.create();
  const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const imgBytes     = await imageBlob.arrayBuffer();
  const isJpeg       = imageBlob.type === 'image/jpeg' || imageBlob.type === 'image/jpg';
  const embeddedImg  = isJpeg ? await pdfDoc.embedJpg(imgBytes) : await pdfDoc.embedPng(imgBytes);

  const imgW       = embeddedImg.width;
  const imgH       = embeddedImg.height;
  const aspectRatio = imgW / imgH;

  const A4_W = 595.28;
  const A4_H = 841.89;
  const [pageW, basePageH] = aspectRatio > 1 ? [A4_H, A4_W] : [A4_W, A4_H];
  const cartiglioLayout = buildCartiglioLayout(pageW, basePageH, fontBold, fontRegular, cartiglio);
  const cartiglioHeight = cartiglioLayout?.height || 0;
  const pageH = basePageH + cartiglioHeight;

  const scale    = Math.min(pageW / imgW, basePageH / imgH);
  const effectiveW = imgW * scale;
  const effectiveH = imgH * scale;
  const offsetX  = (pageW - effectiveW) / 2;
  const offsetY  = cartiglioHeight + (basePageH - effectiveH) / 2;

  const page = pdfDoc.addPage([pageW, pageH]);
  page.drawImage(embeddedImg, { x: offsetX, y: offsetY, width: effectiveW, height: effectiveH });

  _drawAnnotationsOnPage(page, points, pageH, effectiveW, effectiveH, offsetX, offsetY, scale, fontBold, fontItalic, eiLegendPosition);

  if (cartiglioLayout) {
    drawCartiglio(page, fontBold, fontRegular, cartiglioLayout, cartiglio || {});
  }

  return pdfDoc.save();
}

/**
 * Genera PDF vettoriale con sfondo vettoriale (PDF originale) e annotazioni vettoriali.
 * Supporta rotazione: il PDF di sfondo viene ruotato visivamente tramite embedPage+drawPage,
 * e le annotazioni vengono disegnate nel sistema di coordinate dell'immagine ruotata
 * (nessuna trasformazione dei punti necessaria).
 */
async function _buildFromOriginalPDF(
  pdfBlobBase64: string,
  points: ExportPoint[],
  rotation: number = 0,
  eiLegendPosition?: { x: number; y: number } | null,
  cartiglio?: ExportCartiglioData | null,
): Promise<Uint8Array> {
  // Decodifica Base64 → bytes
  const binaryStr = atob(pdfBlobBase64);
  const srcBytes  = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) srcBytes[i] = binaryStr.charCodeAt(i);

  const srcDoc  = await PDFDocument.load(srcBytes);
  const outDoc  = await PDFDocument.create();

  const fontBold   = await outDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await outDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontRegular = await outDoc.embedFont(StandardFonts.Helvetica);
  const srcPage = srcDoc.getPage(0);
  const origW = srcPage.getWidth();
  const origH = srcPage.getHeight();
  const [pageW, planAreaH] = (rotation === 90 || rotation === 270)
    ? [origH, origW]
    : [origW, origH];
  const cartiglioLayout = buildCartiglioLayout(pageW, planAreaH, fontBold, fontRegular, cartiglio);
  const cartiglioHeight = cartiglioLayout?.height || 0;
  const pageH = planAreaH + cartiglioHeight;
  const page = outDoc.addPage([pageW, pageH]);
  const embedded = await outDoc.embedPage(srcPage);

  let ex: number;
  let ey: number;
  let deg: number;
  switch (rotation) {
    case 90:
      ex = 0;
      ey = origW + cartiglioHeight;
      deg = -90;
      break;
    case 180:
      ex = origW;
      ey = origH + cartiglioHeight;
      deg = 180;
      break;
    case 270:
      ex = origH;
      ey = cartiglioHeight;
      deg = 90;
      break;
    default:
      ex = 0;
      ey = cartiglioHeight;
      deg = 0;
  }

  page.drawPage(embedded, {
    x: ex,
    y: ey,
    width: origW,
    height: origH,
    rotate: degrees(deg),
  });

  _drawAnnotationsOnPage(page, points, pageH, pageW, planAreaH, 0, cartiglioHeight, 0.5, fontBold, fontItalic, eiLegendPosition);

  if (cartiglioLayout) {
    drawCartiglio(page, fontBold, fontRegular, cartiglioLayout, cartiglio || {});
  }

  return outDoc.save();
}

/**
 * Ruota un Blob immagine di `rotation` gradi in senso orario usando un canvas offscreen.
 * Restituisce un nuovo Blob PNG con l'immagine ruotata.
 */
async function rotateBlob(blob: Blob, rotation: number): Promise<Blob> {
  if (!rotation) return blob;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const radians = (rotation * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * cos + img.height * sin);
      canvas.height = Math.round(img.width * sin + img.height * cos);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D not available')); return; }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(radians);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Genera i byte del PDF vettoriale a partire da imageBlob e punti normalizzati.
 * Se pdfBlobBase64 è fornito, usa sempre il PDF originale come sfondo vettoriale
 * (con rotazione visiva della pagina se rotation > 0 — nessuna trasformazione coordinate).
 * Solo se pdfBlobBase64 non è disponibile usa imageBlob rasterizzato come sfondo.
 */
export async function buildFloorPlanVectorPDF(
  imageBlob: Blob,
  points: ExportPoint[],
  pdfBlobBase64?: string,
  rotation: number = 0,
  eiLegendPosition?: { x: number; y: number } | null,
  cartiglio?: ExportCartiglioData | null,
): Promise<Uint8Array> {
  if (pdfBlobBase64) {
    return _buildFromOriginalPDF(pdfBlobBase64, points, rotation, eiLegendPosition, cartiglio);
  }
  const blob = rotation ? await rotateBlob(imageBlob, rotation) : imageBlob;
  return _buildWithRasterBackground(blob, points, eiLegendPosition, cartiglio);
}

/**
 * Esporta la planimetria annotata come PDF vettoriale e lo scarica.
 * Se pdfBlobBase64 è fornito, usa sempre il PDF originale come sfondo vettoriale
 * (con trasformazione delle coordinate per la rotazione).
 */
export async function exportFloorPlanVectorPDF(
  imageBlob: Blob,
  points: ExportPoint[],
  filename: string,
  pdfBlobBase64?: string,
  rotation: number = 0,
  eiLegendPosition?: { x: number; y: number } | null,
  cartiglio?: ExportCartiglioData | null,
): Promise<void> {
  const pdfBytes = await buildFloorPlanVectorPDF(imageBlob, points, pdfBlobBase64, rotation, eiLegendPosition, cartiglio);
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
