/**
 * Export utilities for floor plans
 */

import jsPDF from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker - use local worker from node_modules
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

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

    // Convert to data URL
    return canvas.toDataURL('image/png');
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

    // Convert canvas to image
    const imgData = canvas.toDataURL('image/png');

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
    pdf.addImage(imgData, 'PNG', x, y, finalWidth, finalHeight);

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
