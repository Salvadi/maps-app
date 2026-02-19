/**
 * Export utilities for floor plans
 */

import jsPDF from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb } from 'pdf-lib';
import { saveAs } from 'file-saver';

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

// ============================================
// SEZIONE: Export PDF Vettoriale
// Funzioni per esportare planimetrie come PDF 100% vettoriale usando pdf-lib
// ============================================

/**
 * Type for export-compatible CanvasPoint
 */
interface ExportPoint {
  id: string;
  type: 'parete' | 'solaio' | 'perimetro' | 'generico';
  pointX: number; // Normalized 0-1
  pointY: number; // Normalized 0-1
  labelX: number; // Normalized 0-1
  labelY: number; // Normalized 0-1
  labelText: string[];
  perimeterPoints?: Array<{ x: number; y: number }>;
  customText?: string;
  labelBackgroundColor?: string;
  labelTextColor?: string;
}

/**
 * Convert hex color to RGB components in [0,1] range for pdf-lib
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 0.2, g: 0.2, b: 0.2 }; // default gray
  }
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}

/**
 * Get color for point type
 */
function getPointColorForType(type: string): { r: number; g: number; b: number } {
  switch (type) {
    case 'parete':
      return { r: 0, g: 0.4, b: 1 }; // #0066FF
    case 'solaio':
      return { r: 0, g: 0.8, b: 0.4 }; // #00CC66
    case 'perimetro':
      return { r: 1, g: 0.4, b: 0 }; // #FF6600
    case 'generico':
      return { r: 0.6, g: 0.2, b: 1 }; // #9933FF
    default:
      return { r: 0.2, g: 0.2, b: 0.2 };
  }
}

/**
 * Build vector PDF from original PDF blob with annotations
 * @param pdfBlob The original PDF file as Blob
 * @param points Array of canvas points to annotate
 * @param imgWidth Width of the floor plan image in pixels
 * @param imgHeight Height of the floor plan image in pixels
 * @returns Uint8Array with PDF data
 */
export async function buildFloorPlanVectorPDF(
  pdfBlob: Blob,
  points: ExportPoint[],
  imgWidth: number,
  imgHeight: number
): Promise<Uint8Array> {
  try {
    console.log('🔍 buildFloorPlanVectorPDF - pdfBlob size:', pdfBlob.size, 'bytes');

    const pdfBytes = await pdfBlob.arrayBuffer();
    console.log('📄 PDF bytes loaded:', pdfBytes.byteLength);

    const srcDoc = await PDFDocument.load(pdfBytes);
    console.log('✅ PDF loaded, pages:', srcDoc.getPageCount());

    const outDoc = await PDFDocument.create();

    // Copy first page to preserve original vector content
    const [page] = await outDoc.copyPages(srcDoc, [0]);
    outDoc.addPage(page);

    const { width: pageW, height: pageH } = page.getSize();
    console.log('📐 Page size:', pageW, 'x', pageH);

    // Conversion function from normalized coordinates to PDF page coordinates
    // Note: PDF has origin at bottom-left, image has origin at top-left
    const toPageCoords = (nx: number, ny: number) => ({
      x: nx * pageW,
      y: pageH - ny * pageH, // Invert Y axis
    });

    const FONT_SIZE = 14; // pt (match canvas editor exactly)
    const LABEL_PADDING = 8; // pt (match canvas editor exactly)
    const POINT_RADIUS = 4; // pt
    const CONNECTING_LINE_WIDTH = 0.5; // pt
    const LINE_HEIGHT = 18; // pt (spacing between lines, match canvas editor)

    // Add annotations for each point
    for (const point of points) {
      const pointPos = toPageCoords(point.pointX, point.pointY);
      const labelPos = toPageCoords(point.labelX, point.labelY);
      const pointColor = getPointColorForType(point.type);

      // 1. Draw perimeter if applicable
      if (point.type === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
        const perimeterColor = rgb(pointColor.r, pointColor.g, pointColor.b);
        for (let i = 0; i < point.perimeterPoints.length - 1; i++) {
          const p1 = toPageCoords(point.perimeterPoints[i].x, point.perimeterPoints[i].y);
          const p2 = toPageCoords(point.perimeterPoints[i + 1].x, point.perimeterPoints[i + 1].y);
          page.drawLine({
            start: p1,
            end: p2,
            thickness: 1.5,
            color: perimeterColor,
            dashArray: [6, 3],
          });
        }
      }

      // Calculate label dimensions early (needed for both lines and rectangles)
      const labelBgColor = point.labelBackgroundColor
        ? hexToRgb(point.labelBackgroundColor)
        : { r: 0.98, g: 0.98, b: 0.94 }; // light beige

      const approxLineWidth = FONT_SIZE * 6.5; // improved estimate for text width
      const labelTextColor = point.labelTextColor
        ? hexToRgb(point.labelTextColor)
        : { r: 0.2, g: 0.2, b: 0.2 };

      // Calculate exact label height and width to match canvas editor
      const textBlockHeight = point.labelText.length * LINE_HEIGHT;
      const labelHeight = textBlockHeight + LABEL_PADDING * 2;
      const labelWidth = Math.max(approxLineWidth, 70) + LABEL_PADDING * 2;

      const labelRectLeft = labelPos.x - labelWidth / 2;
      const labelRectRight = labelPos.x + labelWidth / 2;
      const labelRectTop = labelPos.y;
      const labelRectBottom = labelPos.y - labelHeight;

      // 2. Draw connecting line FIRST (so it appears behind label)
      let connectionEnd = labelPos;
      const distances = [
        { edge: { x: labelPos.x, y: labelRectTop }, dist: Math.abs(pointPos.y - labelRectTop) }, // top
        { edge: { x: labelPos.x, y: labelRectBottom }, dist: Math.abs(pointPos.y - labelRectBottom) }, // bottom
        { edge: { x: labelRectLeft, y: labelPos.y }, dist: Math.abs(pointPos.x - labelRectLeft) }, // left
        { edge: { x: labelRectRight, y: labelPos.y }, dist: Math.abs(pointPos.x - labelRectRight) }, // right
      ];
      const nearest = distances.reduce((a, b) => (a.dist < b.dist ? a : b));
      connectionEnd = nearest.edge;

      page.drawLine({
        start: pointPos,
        end: connectionEnd,
        thickness: CONNECTING_LINE_WIDTH,
        color: rgb(0.4, 0.4, 0.4),
        dashArray: [2, 2],
      });

      // 3. Draw point circle
      page.drawCircle({
        x: pointPos.x,
        y: pointPos.y,
        size: POINT_RADIUS,
        color: rgb(pointColor.r, pointColor.g, pointColor.b),
      });

      // 4. Draw label background rectangle
      page.drawRectangle({
        x: labelPos.x - labelWidth / 2,
        y: labelPos.y - labelHeight,
        width: labelWidth,
        height: labelHeight,
        color: rgb(labelBgColor.r, labelBgColor.g, labelBgColor.b),
        borderColor: rgb(0.2, 0.2, 0.2),
        borderWidth: 0.5,
      });

      // 5. Draw label text lines - CENTER VERTICALLY in label
      const labelCenter = labelPos.y - labelHeight / 2;
      const textTop = labelCenter + textBlockHeight / 2;
      for (let i = 0; i < point.labelText.length; i++) {
        const line = point.labelText[i];
        const y = textTop - (i + 1) * LINE_HEIGHT + LINE_HEIGHT / 2;
        page.drawText(line, {
          x: labelPos.x - labelWidth / 2 + LABEL_PADDING,
          y: y,
          size: FONT_SIZE,
          color: rgb(labelTextColor.r, labelTextColor.g, labelTextColor.b),
        });
      }
    }

    return await outDoc.save();
  } catch (error) {
    console.error('Error building vector PDF:', error);
    throw new Error('Errore durante la creazione del PDF vettoriale');
  }
}

/**
 * Export floor plan as vector PDF
 * @param pdfBlob The original PDF blob to preserve vector content
 * @param points Array of points to export
 * @param imgWidth Width of the image
 * @param imgHeight Height of the image
 * @param filename Name for the exported file
 */
export async function exportFloorPlanVectorPDF(
  pdfBlob: Blob,
  points: ExportPoint[],
  imgWidth: number,
  imgHeight: number,
  filename: string = 'planimetria.pdf'
): Promise<void> {
  try {
    const pdfBytes = await buildFloorPlanVectorPDF(pdfBlob, points, imgWidth, imgHeight);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    saveAs(blob, filename);
  } catch (error) {
    console.error('Error exporting vector PDF:', error);
    throw new Error('Errore durante l\'esportazione del PDF vettoriale');
  }
}
