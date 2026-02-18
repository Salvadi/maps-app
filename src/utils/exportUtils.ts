/**
 * Export utilities for floor plans
 */

import jsPDF from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';

// Set up PDF.js worker - use unpkg CDN for better compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/**
 * Convert PDF file to image data URL
 * @param file The PDF file to convert
 * @returns Promise with the image data URL
 */
export const convertPDFToImage = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Get first page
    const page = await pdf.getPage(1);

    // Set scale for good quality
    const scale = 2.0;
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Could not get canvas context');
    }

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas
    } as any).promise;

    // Convert to data URL using JPEG for better compression
    // Quality 0.95 ensures high quality while significantly reducing file size
    return canvas.toDataURL('image/jpeg', 0.95);
  } catch (error) {
    console.error('Error converting PDF to image:', error);
    throw new Error('Errore durante la conversione del PDF');
  }
};

/**
 * Export canvas as PDF
 * @param canvas The canvas element to export
 * @param filename The name of the PDF file
 */
export const exportCanvasToPDF = (canvas: HTMLCanvasElement, filename: string = 'planimetria.pdf'): void => {
  try {
    // Get canvas dimensions
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    // Calculate PDF dimensions (A4 landscape or portrait based on aspect ratio)
    const aspectRatio = canvasWidth / canvasHeight;
    let pdfWidth: number;
    let pdfHeight: number;

    if (aspectRatio > 1) {
      // Landscape
      pdfWidth = 297; // A4 width in mm (landscape)
      pdfHeight = 210; // A4 height in mm (landscape)
    } else {
      // Portrait
      pdfWidth = 210; // A4 width in mm (portrait)
      pdfHeight = 297; // A4 height in mm (portrait)
    }

    // Create PDF with appropriate orientation
    const pdf = new jsPDF({
      orientation: aspectRatio > 1 ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Convert canvas to image using JPEG for better compression
    // Quality 0.92 provides excellent quality with much smaller file size
    const imgData = canvas.toDataURL('image/jpeg', 0.92);

    // Calculate scaling to fit image in PDF while maintaining aspect ratio
    const imgAspectRatio = canvasWidth / canvasHeight;
    const pdfAspectRatio = pdfWidth / pdfHeight;

    let finalWidth = pdfWidth;
    let finalHeight = pdfHeight;
    let x = 0;
    let y = 0;

    if (imgAspectRatio > pdfAspectRatio) {
      // Image is wider than PDF
      finalHeight = pdfWidth / imgAspectRatio;
      y = (pdfHeight - finalHeight) / 2;
    } else {
      // Image is taller than PDF
      finalWidth = pdfHeight * imgAspectRatio;
      x = (pdfWidth - finalWidth) / 2;
    }

    // Add image to PDF
    pdf.addImage(imgData, 'JPEG', x, y, finalWidth, finalHeight);

    // Save PDF
    pdf.save(filename);
  } catch (error) {
    console.error('Error exporting PDF:', error);
    throw new Error('Errore durante l\'esportazione PDF');
  }
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
}

// Costanti tipografiche dell'export (in pt)
const EXPORT_FONT_SIZE = 10;
const EXPORT_LINE_HEIGHT = 14;
const EXPORT_PADDING = 6;
const EXPORT_MIN_LABEL_W = 52;
const EXPORT_MIN_LABEL_H = 27;
const EXPORT_POINT_RADIUS = 4;
const EXPORT_DEFAULT_BG = '#FAFAF0';

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

/** Calcola dimensioni etichetta usando i font pdf-lib (in pt) */
function getLabelDimensions(
  lines: string[],
  fontBold: PDFFont,
  fontItalic: PDFFont
): { width: number; height: number } {
  let maxWidth = 0;
  for (const line of lines) {
    let lineWidth: number;
    if (line.startsWith('foto n. ')) {
      lineWidth = fontItalic.widthOfTextAtSize('foto n. ', EXPORT_FONT_SIZE)
               + fontBold.widthOfTextAtSize(line.substring(8), EXPORT_FONT_SIZE);
    } else if (line.startsWith('Tip. ')) {
      lineWidth = fontItalic.widthOfTextAtSize('Tip. ', EXPORT_FONT_SIZE)
               + fontBold.widthOfTextAtSize(line.substring(5), EXPORT_FONT_SIZE);
    } else {
      lineWidth = fontBold.widthOfTextAtSize(line, EXPORT_FONT_SIZE);
    }
    if (lineWidth > maxWidth) maxWidth = lineWidth;
  }
  return {
    width:  Math.max(maxWidth + EXPORT_PADDING * 2, EXPORT_MIN_LABEL_W),
    height: Math.max(lines.length * EXPORT_LINE_HEIGHT + EXPORT_PADDING * 2, EXPORT_MIN_LABEL_H),
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

/**
 * Genera i byte del PDF vettoriale a partire da imageBlob e punti normalizzati.
 * Usata internamente per l'export diretto e per il ZIP.
 */
export async function buildFloorPlanVectorPDF(
  imageBlob: Blob,
  points: ExportPoint[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fontBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Embed immagine (JPEG o PNG)
  const imgBytes = await imageBlob.arrayBuffer();
  const isJpeg = imageBlob.type === 'image/jpeg' || imageBlob.type === 'image/jpg';
  const embeddedImg = isJpeg
    ? await pdfDoc.embedJpg(imgBytes)
    : await pdfDoc.embedPng(imgBytes);

  const imgW = embeddedImg.width;
  const imgH = embeddedImg.height;
  const aspectRatio = imgW / imgH;

  // A4 in punti (1 pt = 1/72 inch)
  const A4_W = 595.28;
  const A4_H = 841.89;
  const [pageW, pageH] = aspectRatio > 1 ? [A4_H, A4_W] : [A4_W, A4_H];

  // Scala proporzionale per far stare l'immagine nella pagina
  const scale = Math.min(pageW / imgW, pageH / imgH);
  const effectiveW = imgW * scale;
  const effectiveH = imgH * scale;
  const offsetX = (pageW - effectiveW) / 2;
  const offsetY = (pageH - effectiveH) / 2;

  // Helper coordinate: normalizzato → PDF (origine bottom-left, Y verso l'alto)
  const toX = (nx: number) => offsetX + nx * effectiveW;
  const toY = (ny: number) => offsetY + (1 - ny) * effectiveH;  // flip Y

  // Helper per drawSvgPath (usa coordinate SVG, Y verso il basso)
  // Con drawSvgPath({ x:0, y:pageH }): PDF_y = pageH - SVG_y
  // → SVG_y = pageH - PDF_y = pageH - offsetY - (1-ny)*effectiveH
  const toSvgY = (ny: number) => (pageH - offsetY - effectiveH) + ny * effectiveH;

  const page = pdfDoc.addPage([pageW, pageH]);

  // Immagine di sfondo
  page.drawImage(embeddedImg, {
    x: offsetX,
    y: offsetY,
    width: effectiveW,
    height: effectiveH,
  });

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
    const { width: lw, height: lh } = getLabelDimensions(point.labelText, fontBold, fontItalic);
    const labelTopX = toX(point.labelX);
    const labelTopY = toY(point.labelY);           // PDF Y del bordo superiore
    const labelBottomY = labelTopY - lh;           // PDF Y del bordo inferiore
    const labelRect = { x: labelTopX, y: labelBottomY, w: lw, h: lh };
    const labelCenter = { x: labelTopX + lw / 2, y: labelBottomY + lh / 2 };

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
    const ptX = toX(point.pointX);
    const ptY = toY(point.pointY);
    page.drawCircle({
      x: ptX,
      y: ptY,
      size: EXPORT_POINT_RADIUS,
      color: hexToRgbLib(getExportPointColor(point.type)),
    });
  }

  // 4. Etichette (in primo piano)
  for (const point of points) {
    const { width: lw, height: lh } = getLabelDimensions(point.labelText, fontBold, fontItalic);
    const labelTopX   = toX(point.labelX);
    const labelTopY   = toY(point.labelY);
    const labelBottomY = labelTopY - lh;

    const bgColor   = point.labelBackgroundColor ? hexToRgbLib(point.labelBackgroundColor) : hexToRgbLib(EXPORT_DEFAULT_BG);
    const textColor = point.labelTextColor       ? hexToRgbLib(point.labelTextColor)       : rgb(0, 0, 0);

    // Rettangolo sfondo
    page.drawRectangle({
      x: labelTopX,
      y: labelBottomY,
      width: lw,
      height: lh,
      color: bgColor,
      borderColor: rgb(0.2, 0.2, 0.2),
      borderWidth: 1,
    });

    // Testo riga per riga
    for (let i = 0; i < point.labelText.length; i++) {
      const line = point.labelText[i];
      // baseline = top_etichetta − padding − offset_riga − dimensione_font
      const baselineY = labelTopY - EXPORT_PADDING - i * EXPORT_LINE_HEIGHT - EXPORT_FONT_SIZE;
      const textX = labelTopX + EXPORT_PADDING;

      if (line.startsWith('foto n. ')) {
        const prefix = 'foto n. ';
        const prefixW = fontItalic.widthOfTextAtSize(prefix, EXPORT_FONT_SIZE);
        page.drawText(prefix, { x: textX,           y: baselineY, font: fontItalic, size: EXPORT_FONT_SIZE, color: textColor });
        page.drawText(line.substring(8), { x: textX + prefixW, y: baselineY, font: fontBold,   size: EXPORT_FONT_SIZE, color: textColor });
      } else if (line.startsWith('Tip. ')) {
        const prefix = 'Tip. ';
        const prefixW = fontItalic.widthOfTextAtSize(prefix, EXPORT_FONT_SIZE);
        page.drawText(prefix, { x: textX,           y: baselineY, font: fontItalic, size: EXPORT_FONT_SIZE, color: textColor });
        page.drawText(line.substring(5), { x: textX + prefixW, y: baselineY, font: fontBold,   size: EXPORT_FONT_SIZE, color: textColor });
      } else {
        page.drawText(line, { x: textX, y: baselineY, font: fontBold, size: EXPORT_FONT_SIZE, color: textColor });
      }
    }
  }

  return await pdfDoc.save();
}

/**
 * Esporta la planimetria annotata come PDF vettoriale e lo scarica.
 * @param imageBlob  Blob dell'immagine planimetria (PNG o JPEG)
 * @param points     Punti con posizioni e etichette normalizzati
 * @param filename   Nome del file PDF da scaricare
 */
export async function exportFloorPlanVectorPDF(
  imageBlob: Blob,
  points: ExportPoint[],
  filename: string
): Promise<void> {
  const pdfBytes = await buildFloorPlanVectorPDF(imageBlob, points);
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export canvas as PNG
 * @param canvas The canvas element to export
 * @param filename The name of the PNG file
 */
export const exportCanvasToPNG = (canvas: HTMLCanvasElement, filename: string = 'planimetria.png'): void => {
  try {
    canvas.toBlob((blob) => {
      if (!blob) {
        throw new Error('Failed to create blob from canvas');
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  } catch (error) {
    console.error('Error exporting PNG:', error);
    throw new Error('Errore durante l\'esportazione PNG');
  }
};
