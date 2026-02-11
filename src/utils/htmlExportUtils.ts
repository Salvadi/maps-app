import type { Project, MappingEntry, Photo } from '../db/database';
import logoLeft from '../assets/letterhead/logo-left.png';
import logoRight from '../assets/letterhead/logo-right1.jpg';
import footerBanner from '../assets/letterhead/header-banner.jpg';

type MappingWithPhotos = Omit<MappingEntry, 'photos'> & {
  photos: Photo[];
};

interface GroupedMapping {
  floor: string;
  room: string;
  intervention: string;
  mappings: MappingWithPhotos[];
}


/**
 * Extract numeric value from string for sorting
 */
function extractNumber(str: string): number {
  const match = str.match(/\d+/);
  return match ? parseInt(match[0], 10) : NaN;
}

/**
 * Compare function for sorting floors and rooms numerically when possible
 */
function compareAlphanumeric(a: string, b: string): number {
  const numA = extractNumber(a);
  const numB = extractNumber(b);

  // If both have numbers, compare numerically
  if (!isNaN(numA) && !isNaN(numB)) {
    if (numA !== numB) {
      return numA - numB;
    }
  }

  // Otherwise, compare alphabetically
  return a.localeCompare(b, 'it');
}

/**
 * Group mappings by floor, room, and intervention
 */
function groupMappings(mappings: MappingWithPhotos[], project: Project): GroupedMapping[] {
  const groups: { [key: string]: GroupedMapping } = {};

  mappings.forEach((mapping) => {
    const floor = mapping.floor || 'Piano non specificato';
    const room = mapping.room || 'Vano non specificato';
    const intervention = mapping.intervention || 'Intervento non specificato';
    const key = `${floor}|${room}|${intervention}`;

    if (!groups[key]) {
      groups[key] = {
        floor,
        room,
        intervention,
        mappings: [],
      };
    }

    groups[key].mappings.push(mapping);
  });

  // Sort groups by floor, then room, then intervention
  return Object.values(groups).sort((a, b) => {
    // First compare floors
    const floorCompare = compareAlphanumeric(a.floor, b.floor);
    if (floorCompare !== 0) return floorCompare;

    // Then compare rooms
    const roomCompare = compareAlphanumeric(a.room, b.room);
    if (roomCompare !== 0) return roomCompare;

    // Finally compare interventions
    return a.intervention.localeCompare(b.intervention, 'it');
  });
}

/**
 * Get label from options
 */
function getLabelFromOptions(
  value: string,
  options: { value: string; label: string }[]
): string {
  const option = options.find((opt) => opt.value === value);
  return option ? option.label : value;
}

/**
 * Resize header image
 */
async function resizeHeaderImage(url: string, maxHeight: number = 60): Promise<string> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);

        // Calculate new dimensions maintaining aspect ratio
        const aspectRatio = img.width / img.height;
        const height = Math.min(img.height, maxHeight);
        const width = height * aspectRatio;

        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Convert to base64 with compression
        try {
          const base64 = canvas.toDataURL('image/jpeg', 0.8);
          resolve(base64);
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image'));
      };

      img.src = objectUrl;
    });
  } catch (error) {
    console.error('Error resizing header image:', error);
    return '';
  }
}

/**
 * Generate HTML header with letterhead images
 */
async function generateHeader(): Promise<string> {
  const leftLogoBase64 = await resizeHeaderImage(logoLeft, 50);
  const rightLogoBase64 = await resizeHeaderImage(logoRight, 40);

  return `
    <div class="header">
      <table style="width: 100%; border: none;">
        <tr>
          <td style="width: 33%; text-align: left; border: none; vertical-align: middle;">
            ${leftLogoBase64 ? `<img src="${leftLogoBase64}" style="max-height: 50px; width: auto;" alt="Logo sinistra">` : ''}
          </td>
          <td style="width: 34%; text-align: center; border: none; vertical-align: middle;">
            <strong style="font-size: 18pt; color: #003366;">OPIFIRESAFE</strong>
          </td>
          <td style="width: 33%; text-align: right; border: none; vertical-align: middle;">
            ${rightLogoBase64 ? `<img src="${rightLogoBase64}" style="max-height: 40px; width: auto;" alt="Logo destra">` : ''}
          </td>
        </tr>
      </table>
      <hr style="border: none; border-bottom: 2px solid #003366; margin-top: 10px; margin-bottom: 20px;">
    </div>
  `;
}

/**
 * Generate HTML footer with letterhead banner
 */
async function generateFooter(): Promise<string> {
  const bannerBase64 = await resizeHeaderImage(footerBanner, 80);

  return `
    <div class="footer" style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #003366;">
      ${bannerBase64 ? `<img src="${bannerBase64}" style="width: 100%; max-width: 100%; height: auto; display: block;" alt="Footer">` : ''}
    </div>
  `;
}

/**
 * Generate CSS for A4 page layout
 */
function generateCSS(): string {
  return `
    @page {
      size: A4;
      margin: 2cm 2cm 2cm 2cm;
    }

    @media print {
      body {
        margin: 0;
        padding: 0;
      }

      .page-break {
        page-break-before: always;
      }

      .no-page-break {
        page-break-inside: avoid;
      }

      thead {
        display: table-header-group;
      }

      tfoot {
        display: table-footer-group;
      }
    }

    html {
      background-color: #ffffff;
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: 'Calibri', 'Arial', sans-serif;
      font-size: 11pt;
      line-height: 1.4;
      color: #000000;
      margin: 0;
      padding: 20px;
      background-color: #ffffff;
    }

    .page {
      width: 21cm;
      min-height: 29.7cm;
      margin: 0 auto;
      background: white;
      padding: 2cm;
      box-shadow: 0 0 10px rgba(0,0,0,0.1);
    }

    .header {
      margin-bottom: 30px;
    }

    h1 {
      text-align: center;
      font-size: 16pt;
      font-weight: bold;
      margin: 20px 0 10px 0;
      color: #003366;
    }

    .address {
      text-align: center;
      font-size: 12pt;
      margin-bottom: 30px;
      color: #333333;
    }

    h2 {
      font-size: 14pt;
      font-weight: bold;
      margin-top: 30px;
      margin-bottom: 15px;
      padding: 8px 12px;
      background-color: #003366;
      color: white;
      page-break-after: avoid;
    }

    h3 {
      font-size: 12pt;
      font-weight: bold;
      margin-top: 20px;
      margin-bottom: 10px;
      padding: 6px 10px;
      background-color: #4472C4;
      color: white;
      page-break-after: avoid;
    }

    h4 {
      font-size: 11pt;
      font-weight: bold;
      margin-top: 15px;
      margin-bottom: 10px;
      padding: 4px 8px;
      background-color: #8EA9DB;
      color: #000000;
      page-break-after: avoid;
    }

    .photo-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin: 20px 0;
      page-break-inside: avoid;
    }

    .photo-item {
      text-align: center;
      page-break-inside: avoid;
    }

    .photo-item img {
      max-width: 100%;
      height: auto;
      border: 1px solid #ddd;
      display: block;
      margin: 0 auto;
    }

    .photo-caption {
      font-style: italic;
      font-size: 9pt;
      margin-top: 5px;
      color: #666666;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      page-break-inside: avoid;
    }

    table, th, td {
      border: 1px solid #000000;
    }

    th {
      background-color: #4472C4;
      color: white;
      font-weight: bold;
      padding: 8px;
      text-align: left;
      font-size: 10pt;
    }

    td {
      padding: 6px 8px;
      font-size: 10pt;
      vertical-align: top;
    }

    tr:nth-child(even) {
      background-color: #F2F2F2;
    }

    .no-data {
      text-align: center;
      font-style: italic;
      color: #999999;
      padding: 20px;
    }
  `;
}

/**
 * Resize and compress image to reduce file size
 */
async function resizeImage(blob: Blob, maxWidth: number = 800, maxHeight: number = 600, quality: number = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calculate new dimensions maintaining aspect ratio
      let width = img.width;
      let height = img.height;

      if (width > maxWidth || height > maxHeight) {
        const aspectRatio = width / height;

        if (width > height) {
          width = maxWidth;
          height = width / aspectRatio;
        } else {
          height = maxHeight;
          width = height * aspectRatio;
        }
      }

      // Create canvas and draw resized image
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Convert to base64 with compression
      try {
        const base64 = canvas.toDataURL('image/jpeg', quality);
        resolve(base64);
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}


/**
 * Generate photo prefix for naming
 */
function generatePhotoPrefix(
  floor: string,
  room: string | undefined,
  intervention: string | undefined,
  project: Project
): string {
  const parts: string[] = [];

  // Add floor
  parts.push(`P${floor}`);

  // Add room if numbering is enabled and room is specified
  if (project.useRoomNumbering && room) {
    parts.push(`S${room}`);
  }

  // Add intervention if numbering is enabled and intervention is specified
  if (project.useInterventionNumbering && intervention) {
    parts.push(`I${intervention}`);
  }

  return parts.length > 0 ? parts.join('_') + '_' : '';
}

/**
 * Generate photos grid HTML
 */
async function generatePhotosGrid(
  photos: Photo[],
  photoPrefix: string
): Promise<string> {
  if (photos.length === 0) {
    return '<p class="no-data">Nessuna foto disponibile</p>';
  }

  let html = '<div class="photo-grid">';

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const photoNum = (i + 1).toString().padStart(2, '0');
    const photoName = `${photoPrefix}${photoNum}`;

    // Resize and compress image to reduce file size
    const photoBase64 = await resizeImage(photo.blob, 800, 600, 0.7);
    html += `
      <div class="photo-item">
        <img src="${photoBase64}" alt="${photoName}">
        <div class="photo-caption">${photoName}</div>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

/**
 * Generate table HTML for mapping details
 */
function generateMappingTable(
  mapping: MappingWithPhotos,
  project: Project,
  supportoOptions: { value: string; label: string }[],
  tipoSupportoOptions: { value: string; label: string }[],
  attraversamentoOptions: { value: string; label: string }[]
): string {
  // Check if mapping has any crossings with tipologico
  const hasTipologico = mapping.crossings.some(c => c.tipologicoId);

  if (!hasTipologico) {
    return '';
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th style="width: 12%;">Foto</th>
          <th style="width: 22%;">Supporto</th>
          <th style="width: 22%;">Attraversamento</th>
          <th style="width: 10%;">Q.tà</th>
          <th style="width: 12%;">Ø/Dim</th>
          <th style="width: 12%;">Tip.</th>
          <th style="width: 10%;">Note</th>
        </tr>
      </thead>
      <tbody>
  `;

  // Calculate photo range
  const photoRange = mapping.photos.length > 0
    ? mapping.photos.length === 1
      ? `Foto ${1}`
      : `Foto ${1}-${mapping.photos.length}`
    : '';

  // Process each crossing
  const crossingsToProcess = mapping.crossings.length > 0 ? mapping.crossings : [];

  for (const crossing of crossingsToProcess) {
    // Skip row if no tipologico
    if (!crossing || !crossing.tipologicoId) {
      continue;
    }

    const supportoLabel = crossing.supporto
      ? getLabelFromOptions(crossing.supporto, supportoOptions)
      : '-';
    const tipoSupportoLabel = crossing.tipoSupporto
      ? getLabelFromOptions(crossing.tipoSupporto, tipoSupportoOptions)
      : '-';
    const supportoComplete = `${supportoLabel} ${tipoSupportoLabel}`.trim();

    const attraversamentoText =
      crossing.attraversamento === 'Altro' && crossing.attraversamentoCustom
        ? crossing.attraversamentoCustom
        : crossing.attraversamento
        ? getLabelFromOptions(crossing.attraversamento, attraversamentoOptions)
        : '-';

    // Get tipologico number
    const tipologico = project.typologies.find(t => t.id === crossing.tipologicoId);
    const tipologicoText = tipologico ? `Tip. ${tipologico.number}` : '-';

    html += `
      <tr>
        <td>${photoRange || '-'}</td>
        <td>${supportoComplete}</td>
        <td>${attraversamentoText}</td>
        <td>${crossing.quantita?.toString() || '-'}</td>
        <td>${crossing.diametro || crossing.dimensioni || '-'}</td>
        <td>${tipologicoText}</td>
        <td>${crossing.notes || '-'}</td>
      </tr>
    `;
  }

  html += `
      </tbody>
    </table>
  `;

  return html;
}

/**
 * Export mappings to HTML file
 */
export async function exportMappingsToHTML(
  project: Project,
  mappings: MappingWithPhotos[],
  supportoOptions: { value: string; label: string }[],
  tipoSupportoOptions: { value: string; label: string }[],
  attraversamentoOptions: { value: string; label: string }[]
): Promise<void> {
  try {
    // Group mappings
    const grouped = groupMappings(mappings, project);

    // Generate header and footer
    const headerHtml = await generateHeader();
    const footerHtml = await generateFooter();

    // Start HTML document
    let html = `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${project.title}</title>
  <style>
    ${generateCSS()}
  </style>
</head>
<body>
  <div class="page">
    ${headerHtml}

    <h1>${project.title}</h1>
    <div class="address">${project.address}</div>
`;

    // Generate content for each group
    for (const group of grouped) {
      html += `
    <h2>Piano: ${group.floor}</h2>
    <h3>Vano: ${group.room}</h3>
    <h4>Intervento: ${group.intervention}</h4>
`;

      // Process each mapping in the group
      for (const mapping of group.mappings) {
        // Generate photo prefix
        const photoPrefix = generatePhotoPrefix(
          group.floor,
          group.room,
          group.intervention,
          project
        );

        // Add photos if available
        if (mapping.photos && mapping.photos.length > 0) {
          html += await generatePhotosGrid(mapping.photos, photoPrefix);
        }

        // Add mapping table if tipologico exists
        const tableHtml = generateMappingTable(
          mapping,
          project,
          supportoOptions,
          tipoSupportoOptions,
          attraversamentoOptions
        );

        if (tableHtml) {
          html += tableHtml;
        }
      }
    }

    // Add footer before closing page
    html += `
    ${footerHtml}
  </div>
</body>
</html>
`;

    // Create blob and download
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.title.replace(/[^a-z0-9]/gi, '_')}_report.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log('HTML report exported successfully');
  } catch (error) {
    console.error('Error exporting HTML report:', error);
    throw error;
  }
}
