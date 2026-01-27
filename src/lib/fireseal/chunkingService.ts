/**
 * Chunking Service
 *
 * Splits PDF content into semantic chunks suitable for embedding
 * and retrieval. Supports different strategies based on document structure.
 */

import { ChunkMetadata } from '../../db/database';
import { PageContent, extractSectionHeaders } from './pdfProcessor';
import {
  ChunkingStrategy,
  getChunkingStrategyDetails,
  extractFireSealMetadata
} from './structureDetector';

export interface ChunkData {
  pageNumber: number;
  chunkIndex: number;
  content: string;
  metadata: ChunkMetadata;
}

export interface ChunkingOptions {
  strategy: ChunkingStrategy;
  maxChunkSize?: number;
  overlapSize?: number;
  minChunkSize?: number;
}

const DEFAULT_MAX_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP_SIZE = 100;
const DEFAULT_MIN_CHUNK_SIZE = 50;

/**
 * Split document pages into chunks using the specified strategy
 */
export function chunkDocument(
  pages: PageContent[],
  options: ChunkingOptions
): ChunkData[] {
  const { strategy } = options;
  const strategyDetails = getChunkingStrategyDetails(strategy);

  const maxChunkSize = options.maxChunkSize || strategyDetails.maxChunkSize || DEFAULT_MAX_CHUNK_SIZE;
  const overlapSize = options.overlapSize || strategyDetails.overlapSize || DEFAULT_OVERLAP_SIZE;
  const minChunkSize = options.minChunkSize || DEFAULT_MIN_CHUNK_SIZE;

  let chunks: ChunkData[] = [];

  switch (strategy) {
    case 'section_based':
      chunks = chunkBySections(pages, maxChunkSize, overlapSize, minChunkSize);
      break;

    case 'table_aware':
      chunks = chunkTableAware(pages, maxChunkSize, overlapSize, minChunkSize);
      break;

    case 'page_based':
      chunks = chunkByPage(pages, maxChunkSize, overlapSize, minChunkSize);
      break;

    case 'paragraph_based':
      chunks = chunkByParagraphs(pages, maxChunkSize, overlapSize, minChunkSize);
      break;

    case 'sliding_window':
    default:
      chunks = chunkSlidingWindow(pages, maxChunkSize, overlapSize, minChunkSize);
      break;
  }

  // Enrich metadata with fire seal specific info
  return enrichChunkMetadata(chunks);
}

/**
 * Section-based chunking: split by detected sections
 */
function chunkBySections(
  pages: PageContent[],
  maxSize: number,
  overlap: number,
  minSize: number
): ChunkData[] {
  const chunks: ChunkData[] = [];

  for (const page of pages) {
    const sections = extractSectionHeaders(page.text);
    const text = page.text;

    if (sections.length === 0) {
      // No sections detected, fall back to paragraph-based
      const pageChunks = chunkTextByParagraphs(text, page.pageNumber, maxSize, overlap, minSize);
      chunks.push(...pageChunks);
      continue;
    }

    // Split by sections
    let lastIndex = 0;
    let chunkIndex = 0;

    for (const section of sections) {
      const sectionIndex = text.indexOf(section, lastIndex);
      if (sectionIndex === -1) continue;

      // Content before this section (if any)
      if (sectionIndex > lastIndex) {
        const beforeContent = text.substring(lastIndex, sectionIndex).trim();
        if (beforeContent.length >= minSize) {
          const subChunks = splitLongText(beforeContent, maxSize, overlap);
          for (const content of subChunks) {
            chunks.push({
              pageNumber: page.pageNumber,
              chunkIndex: chunkIndex++,
              content,
              metadata: {}
            });
          }
        }
      }

      // Find end of section (next section or end of text)
      const nextSectionIndex = sections
        .slice(sections.indexOf(section) + 1)
        .map(s => text.indexOf(s, sectionIndex + section.length))
        .filter(i => i > 0)
        .sort((a, b) => a - b)[0] || text.length;

      const sectionContent = text.substring(sectionIndex, nextSectionIndex).trim();

      if (sectionContent.length >= minSize) {
        const subChunks = splitLongText(sectionContent, maxSize, overlap);
        for (const content of subChunks) {
          chunks.push({
            pageNumber: page.pageNumber,
            chunkIndex: chunkIndex++,
            content,
            metadata: { sectionTitle: section }
          });
        }
      }

      lastIndex = nextSectionIndex;
    }

    // Remaining content after last section
    if (lastIndex < text.length) {
      const remaining = text.substring(lastIndex).trim();
      if (remaining.length >= minSize) {
        const subChunks = splitLongText(remaining, maxSize, overlap);
        for (const content of subChunks) {
          chunks.push({
            pageNumber: page.pageNumber,
            chunkIndex: chunkIndex++,
            content,
            metadata: {}
          });
        }
      }
    }
  }

  return chunks;
}

/**
 * Table-aware chunking: preserve table rows as atomic units
 */
function chunkTableAware(
  pages: PageContent[],
  maxSize: number,
  overlap: number,
  minSize: number
): ChunkData[] {
  const chunks: ChunkData[] = [];

  for (const page of pages) {
    const text = page.text;
    let chunkIndex = 0;

    // Detect table-like content (lines with multiple tab/space separations)
    const lines = text.split('\n');
    let currentChunk = '';
    let inTable = false;
    let tableContent = '';

    for (const line of lines) {
      // Heuristic: line is part of table if it has multiple "columns"
      const isTableRow = isLikelyTableRow(line);

      if (isTableRow) {
        // Save any non-table content before this
        if (currentChunk.trim().length >= minSize) {
          const subChunks = splitLongText(currentChunk.trim(), maxSize, overlap);
          for (const content of subChunks) {
            chunks.push({
              pageNumber: page.pageNumber,
              chunkIndex: chunkIndex++,
              content,
              metadata: { tableData: false }
            });
          }
          currentChunk = '';
        }

        // Accumulate table content
        tableContent += line + '\n';
        inTable = true;
      } else {
        // If we were in a table, save it
        if (inTable && tableContent.trim().length >= minSize) {
          // Split table into smaller chunks if needed
          const tableChunks = splitLongText(tableContent.trim(), maxSize, overlap);
          for (const content of tableChunks) {
            chunks.push({
              pageNumber: page.pageNumber,
              chunkIndex: chunkIndex++,
              content,
              metadata: { tableData: true }
            });
          }
          tableContent = '';
          inTable = false;
        }

        currentChunk += line + '\n';
      }
    }

    // Save remaining content
    if (tableContent.trim().length >= minSize) {
      const tableChunks = splitLongText(tableContent.trim(), maxSize, overlap);
      for (const content of tableChunks) {
        chunks.push({
          pageNumber: page.pageNumber,
          chunkIndex: chunkIndex++,
          content,
          metadata: { tableData: true }
        });
      }
    }

    if (currentChunk.trim().length >= minSize) {
      const subChunks = splitLongText(currentChunk.trim(), maxSize, overlap);
      for (const content of subChunks) {
        chunks.push({
          pageNumber: page.pageNumber,
          chunkIndex: chunkIndex++,
          content,
          metadata: { tableData: false }
        });
      }
    }
  }

  return chunks;
}

/**
 * Page-based chunking: one or more chunks per page
 */
function chunkByPage(
  pages: PageContent[],
  maxSize: number,
  overlap: number,
  minSize: number
): ChunkData[] {
  const chunks: ChunkData[] = [];

  for (const page of pages) {
    const text = page.text.trim();

    if (text.length < minSize) continue;

    if (text.length <= maxSize) {
      // Entire page fits in one chunk
      chunks.push({
        pageNumber: page.pageNumber,
        chunkIndex: 0,
        content: text,
        metadata: {}
      });
    } else {
      // Split page into multiple chunks with overlap
      const subChunks = splitLongText(text, maxSize, overlap);
      subChunks.forEach((content, index) => {
        chunks.push({
          pageNumber: page.pageNumber,
          chunkIndex: index,
          content,
          metadata: {}
        });
      });
    }
  }

  // Add cross-page overlap for context
  return addCrossPageOverlap(chunks, overlap, pages);
}

/**
 * Paragraph-based chunking: split by natural paragraphs
 */
function chunkByParagraphs(
  pages: PageContent[],
  maxSize: number,
  overlap: number,
  minSize: number
): ChunkData[] {
  const chunks: ChunkData[] = [];

  for (const page of pages) {
    const pageChunks = chunkTextByParagraphs(page.text, page.pageNumber, maxSize, overlap, minSize);
    chunks.push(...pageChunks);
  }

  return chunks;
}

/**
 * Helper: chunk text by paragraphs
 */
function chunkTextByParagraphs(
  text: string,
  pageNumber: number,
  maxSize: number,
  overlap: number,
  minSize: number
): ChunkData[] {
  const chunks: ChunkData[] = [];

  // Split by double newlines (paragraphs)
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);

  let currentChunk = '';
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 1 <= maxSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    } else {
      // Save current chunk
      if (currentChunk.length >= minSize) {
        chunks.push({
          pageNumber,
          chunkIndex: chunkIndex++,
          content: currentChunk,
          metadata: {}
        });
      }

      // Start new chunk with overlap
      if (currentChunk.length > overlap) {
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + '\n\n' + paragraph;
      } else {
        currentChunk = paragraph;
      }

      // If paragraph itself is too long, split it
      if (currentChunk.length > maxSize) {
        const subChunks = splitLongText(currentChunk, maxSize, overlap);
        subChunks.slice(0, -1).forEach(content => {
          chunks.push({
            pageNumber,
            chunkIndex: chunkIndex++,
            content,
            metadata: {}
          });
        });
        currentChunk = subChunks[subChunks.length - 1];
      }
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length >= minSize) {
    chunks.push({
      pageNumber,
      chunkIndex: chunkIndex++,
      content: currentChunk,
      metadata: {}
    });
  }

  return chunks;
}

/**
 * Sliding window chunking: fixed-size chunks with overlap
 */
function chunkSlidingWindow(
  pages: PageContent[],
  maxSize: number,
  overlap: number,
  minSize: number
): ChunkData[] {
  const chunks: ChunkData[] = [];

  // Combine all pages with page markers
  const pageTexts = pages.map(p => ({
    pageNumber: p.pageNumber,
    text: p.text.trim()
  }));

  for (const pageText of pageTexts) {
    const { pageNumber, text } = pageText;

    if (text.length < minSize) continue;

    const subChunks = splitLongText(text, maxSize, overlap);
    subChunks.forEach((content, index) => {
      if (content.length >= minSize) {
        chunks.push({
          pageNumber,
          chunkIndex: index,
          content,
          metadata: {}
        });
      }
    });
  }

  return chunks;
}

/**
 * Split long text into chunks with overlap
 */
function splitLongText(text: string, maxSize: number, overlap: number): string[] {
  if (text.length <= maxSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxSize, text.length);

    // Try to break at sentence or word boundary
    if (end < text.length) {
      const breakPoint = findBreakPoint(text, start, end);
      if (breakPoint > start) {
        end = breakPoint;
      }
    }

    chunks.push(text.substring(start, end).trim());

    // Move start with overlap
    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}

/**
 * Find a good break point (end of sentence or word)
 */
function findBreakPoint(text: string, start: number, maxEnd: number): number {
  // Look for sentence boundary
  const sentenceEnd = text.lastIndexOf('.', maxEnd);
  if (sentenceEnd > start + (maxEnd - start) / 2) {
    return sentenceEnd + 1;
  }

  // Look for word boundary
  const spaceIndex = text.lastIndexOf(' ', maxEnd);
  if (spaceIndex > start + (maxEnd - start) / 2) {
    return spaceIndex;
  }

  return maxEnd;
}

/**
 * Check if a line looks like a table row
 */
function isLikelyTableRow(line: string): boolean {
  // Table rows often have:
  // - Multiple tabs
  // - Multiple consecutive spaces (column separators)
  // - Numeric values separated by spaces
  // - Consistent pattern of spaces

  const tabCount = (line.match(/\t/g) || []).length;
  const multiSpaceCount = (line.match(/\s{2,}/g) || []).length;
  const hasNumbers = /\d+/.test(line);

  return tabCount >= 2 || (multiSpaceCount >= 2 && hasNumbers);
}

/**
 * Add cross-page overlap context
 */
function addCrossPageOverlap(
  chunks: ChunkData[],
  overlap: number,
  pages: PageContent[]
): ChunkData[] {
  // For page-based chunking, add context from adjacent pages
  return chunks.map((chunk, index) => {
    const prevChunk = chunks[index - 1];
    const nextChunk = chunks[index + 1];

    // If this is the first chunk of a page and there's a previous page
    if (chunk.chunkIndex === 0 && prevChunk && prevChunk.pageNumber !== chunk.pageNumber) {
      const overlapText = prevChunk.content.slice(-overlap);
      chunk.content = `[...] ${overlapText}\n\n${chunk.content}`;
    }

    return chunk;
  });
}

/**
 * Enrich chunk metadata with fire seal specific information
 */
function enrichChunkMetadata(chunks: ChunkData[]): ChunkData[] {
  return chunks.map(chunk => {
    const metadata = extractFireSealMetadata(chunk.content);

    return {
      ...chunk,
      metadata: {
        ...chunk.metadata,
        reiContext: metadata.reiValues[0],
        supportContext: metadata.supportTypes[0],
        crossingContext: metadata.crossingTypes[0],
        productContext: metadata.products.length > 0 ? metadata.products : undefined
      }
    };
  });
}

/**
 * Estimate number of tokens in text (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token for English/Italian text
  return Math.ceil(text.length / 4);
}

/**
 * Get chunk statistics
 */
export function getChunkStats(chunks: ChunkData[]): {
  totalChunks: number;
  avgChunkSize: number;
  minChunkSize: number;
  maxChunkSize: number;
  estimatedTotalTokens: number;
  chunksPerPage: Record<number, number>;
} {
  const sizes = chunks.map(c => c.content.length);
  const chunksPerPage: Record<number, number> = {};

  for (const chunk of chunks) {
    chunksPerPage[chunk.pageNumber] = (chunksPerPage[chunk.pageNumber] || 0) + 1;
  }

  return {
    totalChunks: chunks.length,
    avgChunkSize: sizes.length > 0 ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0,
    minChunkSize: sizes.length > 0 ? Math.min(...sizes) : 0,
    maxChunkSize: sizes.length > 0 ? Math.max(...sizes) : 0,
    estimatedTotalTokens: chunks.reduce((sum, c) => sum + estimateTokens(c.content), 0),
    chunksPerPage
  };
}
