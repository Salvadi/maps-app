/**
 * PDF Processor Service
 *
 * Extracts text content from PDF files using pdf.js.
 * Preserves page numbers and basic structure for chunking.
 */

import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker (using CDN as in existing app)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

export interface PageContent {
  pageNumber: number;
  text: string;
  textItems: TextItem[];
}

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
}

export interface PDFProcessingResult {
  pageCount: number;
  pages: PageContent[];
  metadata: PDFMetadata;
}

export interface PDFMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}

export interface ProcessingProgress {
  currentPage: number;
  totalPages: number;
  percentage: number;
}

/**
 * Extract text content from a PDF file
 */
export async function extractTextFromPDF(
  pdfBlob: Blob,
  onProgress?: (progress: ProcessingProgress) => void
): Promise<PDFProcessingResult> {
  // Convert blob to ArrayBuffer
  const arrayBuffer = await pdfBlob.arrayBuffer();

  // Load PDF document
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    useSystemFonts: true
  });

  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;

  // Extract metadata
  const metadata = await extractMetadata(pdf);

  // Extract text from each page
  const pages: PageContent[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const pageContent = await extractPageContent(page, i);
    pages.push(pageContent);

    // Report progress
    if (onProgress) {
      onProgress({
        currentPage: i,
        totalPages: pageCount,
        percentage: Math.round((i / pageCount) * 100)
      });
    }
  }

  return {
    pageCount,
    pages,
    metadata
  };
}

/**
 * Extract metadata from PDF document
 */
async function extractMetadata(pdf: pdfjsLib.PDFDocumentProxy): Promise<PDFMetadata> {
  try {
    const metadataObj = await pdf.getMetadata();
    const info = metadataObj.info as Record<string, any>;

    return {
      title: info?.Title,
      author: info?.Author,
      subject: info?.Subject,
      keywords: info?.Keywords,
      creator: info?.Creator,
      producer: info?.Producer,
      creationDate: info?.CreationDate ? parsePDFDate(info.CreationDate) : undefined,
      modificationDate: info?.ModDate ? parsePDFDate(info.ModDate) : undefined
    };
  } catch (error) {
    console.warn('Failed to extract PDF metadata:', error);
    return {};
  }
}

/**
 * Extract text content from a single page
 */
async function extractPageContent(
  page: pdfjsLib.PDFPageProxy,
  pageNumber: number
): Promise<PageContent> {
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1.0 });

  const textItems: TextItem[] = [];
  let fullText = '';

  for (const item of textContent.items) {
    if ('str' in item && item.str) {
      const textItem = item as any;

      // Get position (transform matrix: [scaleX, skewX, skewY, scaleY, translateX, translateY])
      const transform = textItem.transform || [1, 0, 0, 1, 0, 0];
      const x = transform[4];
      const y = viewport.height - transform[5]; // Flip Y coordinate
      const width = textItem.width || 0;
      const height = textItem.height || Math.abs(transform[3]);

      textItems.push({
        text: textItem.str,
        x,
        y,
        width,
        height,
        fontName: textItem.fontName,
        fontSize: height
      });

      // Build full text with proper spacing
      if (textItem.hasEOL) {
        fullText += textItem.str + '\n';
      } else {
        fullText += textItem.str + ' ';
      }
    }
  }

  // Clean up the text
  const cleanedText = cleanText(fullText);

  return {
    pageNumber,
    text: cleanedText,
    textItems
  };
}

/**
 * Clean extracted text
 */
function cleanText(text: string): string {
  return text
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Fix common OCR/extraction issues
    .replace(/\s*-\s*/g, '-')
    // Remove excessive line breaks
    .replace(/\n{3,}/g, '\n\n')
    // Trim lines
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    // Final trim
    .trim();
}

/**
 * Parse PDF date string format: D:YYYYMMDDHHmmSSOHH'mm'
 */
function parsePDFDate(dateString: string): Date | undefined {
  try {
    if (!dateString) return undefined;

    // Remove 'D:' prefix if present
    let str = dateString.replace(/^D:/, '');

    // Extract date components
    const year = parseInt(str.substring(0, 4), 10);
    const month = parseInt(str.substring(4, 6) || '01', 10) - 1;
    const day = parseInt(str.substring(6, 8) || '01', 10);
    const hour = parseInt(str.substring(8, 10) || '00', 10);
    const minute = parseInt(str.substring(10, 12) || '00', 10);
    const second = parseInt(str.substring(12, 14) || '00', 10);

    return new Date(year, month, day, hour, minute, second);
  } catch {
    return undefined;
  }
}

/**
 * Extract text from specific pages only
 */
export async function extractTextFromPages(
  pdfBlob: Blob,
  pageNumbers: number[]
): Promise<PageContent[]> {
  const arrayBuffer = await pdfBlob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages: PageContent[] = [];

  for (const pageNum of pageNumbers) {
    if (pageNum >= 1 && pageNum <= pdf.numPages) {
      const page = await pdf.getPage(pageNum);
      const pageContent = await extractPageContent(page, pageNum);
      pages.push(pageContent);
    }
  }

  return pages;
}

/**
 * Get PDF page count without full extraction
 */
export async function getPDFPageCount(pdfBlob: Blob): Promise<number> {
  const arrayBuffer = await pdfBlob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf.numPages;
}

/**
 * Check if PDF has selectable text (not just scanned images)
 */
export async function hasSelectorableText(pdfBlob: Blob): Promise<boolean> {
  try {
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Check first few pages for text content
    const pagesToCheck = Math.min(3, pdf.numPages);
    let totalTextLength = 0;

    for (let i = 1; i <= pagesToCheck; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();

      for (const item of textContent.items) {
        if ('str' in item && item.str) {
          totalTextLength += item.str.length;
        }
      }
    }

    // If average text per page is very low, it's likely a scanned document
    const avgTextPerPage = totalTextLength / pagesToCheck;
    return avgTextPerPage > 100; // Threshold: at least 100 chars per page
  } catch (error) {
    console.error('Error checking PDF text content:', error);
    return false;
  }
}

/**
 * Detect if text contains tables (heuristic based on column alignment)
 */
export function detectTables(textItems: TextItem[]): boolean {
  if (textItems.length < 10) return false;

  // Group items by Y position (rows)
  const rowGroups = new Map<number, TextItem[]>();
  const tolerance = 5; // Y position tolerance for same row

  for (const item of textItems) {
    const roundedY = Math.round(item.y / tolerance) * tolerance;
    const existing = rowGroups.get(roundedY) || [];
    existing.push(item);
    rowGroups.set(roundedY, existing);
  }

  // Count rows with multiple items (potential table rows)
  let multiItemRows = 0;
  Array.from(rowGroups.values()).forEach(items => {
    if (items.length >= 3) {
      multiItemRows++;
    }
  });

  // If more than 30% of rows have multiple items, likely a table
  return multiItemRows / rowGroups.size > 0.3;
}

/**
 * Extract potential section headers from text
 */
export function extractSectionHeaders(text: string): string[] {
  const headers: string[] = [];

  // Common patterns for section headers in technical documents
  const patterns = [
    /^(\d+\.?\s+[A-Z][^.]+)$/gm,           // "1. Introduction" or "1 Introduction"
    /^([A-Z][A-Z\s]+)$/gm,                  // "INTRODUCTION"
    /^(Art\.\s*\d+[^.]+)/gm,               // "Art. 1 - Descrizione"
    /^(Allegato\s+[A-Z0-9]+)/gmi,          // "Allegato A"
    /^(Tabella\s+\d+)/gmi,                 // "Tabella 1"
    /^(Figura\s+\d+)/gmi,                  // "Figura 1"
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const header = match[1].trim();
      if (header.length > 3 && header.length < 100) {
        headers.push(header);
      }
    }
  }

  return Array.from(new Set(headers)); // Remove duplicates
}
