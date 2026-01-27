/**
 * Certificate Structure Detector
 *
 * Detects the structure type of fire seal certificates based on
 * text patterns and layout characteristics. Used to apply the
 * appropriate chunking strategy.
 */

import { CertificateStructureType } from '../../db/database';
import { PageContent, TextItem, detectTables } from './pdfProcessor';

export interface StructurePattern {
  type: CertificateStructureType;
  indicators: RegExp[];
  negativeIndicators?: RegExp[];
  minScore: number;
  chunkingStrategy: ChunkingStrategy;
  typicalSections: string[];
  description: string;
}

export type ChunkingStrategy =
  | 'section_based'    // Split by detected sections
  | 'table_aware'      // Preserve table integrity
  | 'page_based'       // One chunk per page
  | 'paragraph_based'  // Split by paragraphs
  | 'sliding_window';  // Fixed-size sliding window

export interface StructureDetectionResult {
  structureType: CertificateStructureType;
  confidence: number;
  chunkingStrategy: ChunkingStrategy;
  detectedIndicators: string[];
  suggestedSections: string[];
}

/**
 * Structure patterns for different certificate types
 */
export const STRUCTURE_PATTERNS: StructurePattern[] = [
  {
    type: 'promat_standard',
    indicators: [
      /PROMAT\s+S\.?p\.?A/i,
      /PROMAT\s+(?:Italia|GmbH|International)/i,
      /PROMASTOP/i,
      /PROMASEAL/i,
      /PROMAFLEX/i,
      /PROMAFOAM/i,
      /PROMAPAINT/i,
      /Etag\s+0\d{2}/i,
      /ETA[-\s]?\d{2}\/\d{4}/i,
    ],
    minScore: 2,
    chunkingStrategy: 'section_based',
    typicalSections: [
      'Descrizione del prodotto',
      'Campo di applicazione',
      'Caratteristiche tecniche',
      'Classificazione',
      'Metodo di installazione',
      'Condizioni di utilizzo'
    ],
    description: 'Certificati Promat - struttura per sezioni con schede tecniche'
  },
  {
    type: 'af_systems_tabular',
    indicators: [
      /AF\s+Systems/i,
      /AF[-\s]?Seal/i,
      /AF[-\s]?Panel/i,
      /AF[-\s]?Collar/i,
      /AF[-\s]?Board/i,
      /AF[-\s]?Coat/i,
      /Tabella\s+\d+/i,
      /Table\s+\d+/i,
    ],
    minScore: 2,
    chunkingStrategy: 'table_aware',
    typicalSections: [
      'Applicazione',
      'Dati tecnici',
      'Istruzioni di posa',
      'Tabelle prestazionali',
      'Certificazioni'
    ],
    description: 'Certificati AF Systems - focus su tabelle prestazionali'
  },
  {
    type: 'hilti_technical',
    indicators: [
      /Hilti/i,
      /CFS[-\s]?[A-Z]/i,
      /CP\s*\d{3}/i,
      /Technical\s+Data\s+Sheet/i,
      /Firestop\s+System/i,
      /Hilti\s+AG/i,
    ],
    minScore: 2,
    chunkingStrategy: 'page_based',
    typicalSections: [
      'Product Description',
      'Application',
      'Technical Data',
      'Installation',
      'Approvals',
      'System Components'
    ],
    description: 'Schede tecniche Hilti - layout per pagina con grafica'
  },
  {
    type: 'global_building',
    indicators: [
      /Global\s+Building/i,
      /GB[-\s]?Fire/i,
      /FireSeal/i,
      /FireStop/i,
      /FireProtect/i,
      /GB[-\s]?Seal/i,
    ],
    minScore: 2,
    chunkingStrategy: 'paragraph_based',
    typicalSections: [
      'Uso previsto',
      'Classificazione',
      'Posa in opera',
      'Caratteristiche',
      'Prestazioni'
    ],
    description: 'Certificati Global Building - struttura per paragrafi'
  },
  {
    type: 'generic',
    indicators: [
      /ETA[-\s]?\d{2}\/\d{4}/i,
      /DoP/i,
      /Dichiarazione\s+di\s+Prestazione/i,
      /Declaration\s+of\s+Performance/i,
      /Certificato/i,
      /Certificate/i,
      /REI\s*\d+/i,
      /EI\s*\d+/i,
    ],
    minScore: 1,
    chunkingStrategy: 'sliding_window',
    typicalSections: [],
    description: 'Certificato generico - chunking standard con sliding window'
  }
];

/**
 * Detect the structure type of a certificate
 */
export function detectStructure(
  pages: PageContent[],
  brandHint?: string
): StructureDetectionResult {
  // Combine text from first few pages for analysis
  const samplePages = pages.slice(0, Math.min(5, pages.length));
  const sampleText = samplePages.map(p => p.text).join('\n');

  // Check for tables in the document
  const hasTabularContent = samplePages.some(page =>
    page.textItems && detectTables(page.textItems)
  );

  // Score each pattern
  const scores: Array<{
    pattern: StructurePattern;
    score: number;
    matchedIndicators: string[];
  }> = [];

  for (const pattern of STRUCTURE_PATTERNS) {
    let score = 0;
    const matchedIndicators: string[] = [];

    // Check positive indicators
    for (const indicator of pattern.indicators) {
      if (indicator.test(sampleText)) {
        score++;
        matchedIndicators.push(indicator.source);
      }
    }

    // Check negative indicators (reduce score)
    if (pattern.negativeIndicators) {
      for (const negIndicator of pattern.negativeIndicators) {
        if (negIndicator.test(sampleText)) {
          score -= 0.5;
        }
      }
    }

    // Bonus for brand hint match
    if (brandHint) {
      const brandLower = brandHint.toLowerCase();
      if (
        (pattern.type === 'promat_standard' && brandLower.includes('promat')) ||
        (pattern.type === 'af_systems_tabular' && brandLower.includes('af')) ||
        (pattern.type === 'hilti_technical' && brandLower.includes('hilti')) ||
        (pattern.type === 'global_building' && brandLower.includes('global'))
      ) {
        score += 2;
      }
    }

    // Bonus for table content matching tabular strategy
    if (hasTabularContent && pattern.chunkingStrategy === 'table_aware') {
      score += 1;
    }

    scores.push({ pattern, score, matchedIndicators });
  }

  // Sort by score (descending)
  scores.sort((a, b) => b.score - a.score);

  // Select best match if score meets minimum threshold
  const best = scores[0];
  const secondBest = scores[1];

  // Calculate confidence
  let confidence = 0;
  if (best.score >= best.pattern.minScore) {
    // Confidence based on score and gap to second best
    const gap = secondBest ? best.score - secondBest.score : best.score;
    confidence = Math.min(1, (best.score / 5) * 0.5 + (gap / 3) * 0.5);
  }

  // If confidence is too low, fall back to generic
  const selectedPattern = confidence >= 0.3 ? best.pattern : STRUCTURE_PATTERNS.find(p => p.type === 'generic')!;

  // Detect sections in the document
  const suggestedSections = detectSections(sampleText, selectedPattern.typicalSections);

  return {
    structureType: selectedPattern.type,
    confidence: Math.round(confidence * 100) / 100,
    chunkingStrategy: selectedPattern.chunkingStrategy,
    detectedIndicators: best.matchedIndicators,
    suggestedSections
  };
}

/**
 * Detect sections in document text
 */
function detectSections(text: string, typicalSections: string[]): string[] {
  const detectedSections: string[] = [];

  // Check for typical sections
  for (const section of typicalSections) {
    const pattern = new RegExp(section.replace(/\s+/g, '\\s*'), 'i');
    if (pattern.test(text)) {
      detectedSections.push(section);
    }
  }

  // Also detect numbered sections
  const numberedSectionPattern = /^(\d+\.?\d*\.?\s+[A-Z][^.]+)/gm;
  let match;
  while ((match = numberedSectionPattern.exec(text)) !== null) {
    const section = match[1].trim();
    if (section.length > 5 && section.length < 100 && !detectedSections.includes(section)) {
      detectedSections.push(section);
    }
  }

  return detectedSections.slice(0, 20); // Limit to 20 sections
}

/**
 * Get chunking strategy details for a structure type
 */
export function getChunkingStrategyDetails(strategy: ChunkingStrategy): {
  maxChunkSize: number;
  overlapSize: number;
  preserveTables: boolean;
  preserveParagraphs: boolean;
  description: string;
} {
  switch (strategy) {
    case 'section_based':
      return {
        maxChunkSize: 1000,
        overlapSize: 100,
        preserveTables: true,
        preserveParagraphs: true,
        description: 'Divide per sezioni logiche del documento, mantenendo integrità semantica'
      };

    case 'table_aware':
      return {
        maxChunkSize: 800,
        overlapSize: 50,
        preserveTables: true,
        preserveParagraphs: false,
        description: 'Preserva integrità delle tabelle, estrae righe come chunk separati'
      };

    case 'page_based':
      return {
        maxChunkSize: 1500,
        overlapSize: 150,
        preserveTables: true,
        preserveParagraphs: true,
        description: 'Un chunk per pagina, con overlap tra pagine adiacenti'
      };

    case 'paragraph_based':
      return {
        maxChunkSize: 600,
        overlapSize: 80,
        preserveTables: false,
        preserveParagraphs: true,
        description: 'Divide per paragrafi naturali del testo'
      };

    case 'sliding_window':
    default:
      return {
        maxChunkSize: 500,
        overlapSize: 100,
        preserveTables: false,
        preserveParagraphs: false,
        description: 'Finestra scorrevole standard con overlap fisso'
      };
  }
}

/**
 * Extract fire seal specific metadata from text
 */
export function extractFireSealMetadata(text: string): {
  reiValues: string[];
  supportTypes: string[];
  crossingTypes: string[];
  products: string[];
  certificationNumber?: string;
} {
  const reiValues: Set<string> = new Set();
  const supportTypes: Set<string> = new Set();
  const crossingTypes: Set<string> = new Set();
  const products: Set<string> = new Set();

  // Extract REI/EI values
  const reiPatterns = [
    /(?:REI|EI)\s*(\d{2,3})/gi,
    /(?:REI|EI)[-\s]?(\d{2,3})/gi,
    /resistenza\s+al\s+fuoco[:\s]+(?:REI|EI)\s*(\d{2,3})/gi,
  ];

  for (const pattern of reiPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = parseInt(match[1], 10);
      if ([30, 60, 90, 120, 180, 240].includes(value)) {
        reiValues.add(`EI ${value}`);
      }
    }
  }

  // Extract support types
  const supportPatterns = [
    /parete/gi,
    /solaio/gi,
    /soffitto/gi,
    /muro/gi,
    /wall/gi,
    /floor/gi,
    /ceiling/gi,
  ];

  for (const pattern of supportPatterns) {
    if (pattern.test(text)) {
      const type = pattern.source.toLowerCase();
      if (type === 'parete' || type === 'muro' || type === 'wall') {
        supportTypes.add('Parete');
      } else if (type === 'solaio' || type === 'floor') {
        supportTypes.add('Solaio');
      } else if (type === 'soffitto' || type === 'ceiling') {
        supportTypes.add('Soffitto');
      }
    }
  }

  // Extract crossing types
  const crossingPatterns = [
    /cavi|cables?/gi,
    /tubi|pipes?|tubazioni/gi,
    /canali|canalette|cable\s+trays?/gi,
    /giunti?|joints?/gi,
    /attraversament[oi]/gi,
    /penetrazion[ei]/gi,
  ];

  const crossingMap: Record<string, string> = {
    'cavi': 'Cavi',
    'cables': 'Cavi',
    'cable': 'Cavi',
    'tubi': 'Tubi',
    'pipes': 'Tubi',
    'pipe': 'Tubi',
    'tubazioni': 'Tubi',
    'canali': 'Canali',
    'canalette': 'Canali',
    'cable trays': 'Canali',
    'cable tray': 'Canali',
    'giunti': 'Giunti',
    'giunto': 'Giunti',
    'joints': 'Giunti',
    'joint': 'Giunti',
  };

  for (const pattern of crossingPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const key = match[0].toLowerCase();
      const mappedType = crossingMap[key];
      if (mappedType) {
        crossingTypes.add(mappedType);
      }
    }
  }

  // Extract product names (brand-specific patterns)
  const productPatterns = [
    /PROMASTOP[-\s]?[A-Z]{1,3}/gi,
    /PROMASEAL[-\s]?[A-Z0-9]+/gi,
    /PROMAFOAM[-\s]?[A-Z0-9]+/gi,
    /AF[-\s]?(?:Seal|Panel|Collar|Board|Coat)[-\s]?[A-Z0-9]*/gi,
    /CFS[-\s]?[A-Z][-\s]?[A-Z0-9]*/gi,
    /CP\s*\d{3}[A-Z]*/gi,
    /GB[-\s]?(?:Fire|Seal|Stop)[-\s]?[A-Z0-9]*/gi,
  ];

  for (const pattern of productPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const product = match[0].trim().toUpperCase();
      if (product.length >= 4) {
        products.add(product);
      }
    }
  }

  // Extract certification number
  let certificationNumber: string | undefined;
  const certPatterns = [
    /ETA[-\s]?(\d{2}\/\d{4})/i,
    /DoP[-\s]?([A-Z0-9\-]+)/i,
    /(?:Certificato|Certificate)\s*(?:n\.|N°|#)?\s*([A-Z0-9\-\/]+)/i,
  ];

  for (const pattern of certPatterns) {
    const match = pattern.exec(text);
    if (match) {
      certificationNumber = match[1] || match[0];
      break;
    }
  }

  return {
    reiValues: Array.from(reiValues).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      return numA - numB;
    }),
    supportTypes: Array.from(supportTypes),
    crossingTypes: Array.from(crossingTypes),
    products: Array.from(products),
    certificationNumber
  };
}
