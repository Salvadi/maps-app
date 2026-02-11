import type { Project, MappingEntry, Photo } from '../db/database';
import headerImage1 from '../assets/image1.png';
import headerImage2 from '../assets/image2.jpg';
import headerImage3 from '../assets/image3.jpeg';

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
 * Convert image URL to base64
 */
async function imageUrlToBase64(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting image to base64:', error);
    return '';
  }
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

  return Object.values(groups);
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
 * Generate HTML header with letterhead images
 */
async function generateHeader(): Promise<string> {
  const img1Base64 = await imageUrlToBase64(headerImage1);
  const img2Base64 = await imageUrlToBase64(headerImage2);
  const img3Base64 = await imageUrlToBase64(headerImage3);

  return `
    <div class="header">
      <table style="width: 100%; border: none;">
        <tr>
          <td style="width: 33%; text-align: left; border: none;">
            ${img1Base64 ? `<img src="${img1Base64}" style="max-height: 50px; width: auto;" alt="Logo 1">` : ''}
          </td>
          <td style="width: 34%; text-align: center; border: none;">
            <strong style="font-size: 18pt; color: #003366;">OPIFIRESAFE</strong>
          </td>
          <td style="width: 33%; text-align: right; border: none;">
            ${img2Base64 ? `<img src="${img2Base64}" style="max-height: 40px; width: auto; margin-right: 10px;" alt="Logo 2">` : ''}
            ${img3Base64 ? `<img src="${img3Base64}" style="max-height: 40px; width: auto;" alt="Logo 3">` : ''}
          </td>
        </tr>
      </table>
      <hr style="border: none; border-bottom: 2px solid #003366; margin-top: 10px; margin-bottom: 20px;">
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
      background: white;
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
 * Convert blob to base64
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
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

    const photoBase64 = await blobToBase64(photo.blob);
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

    // Generate header
    const headerHtml = await generateHeader();

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

    // Close HTML document
    html += `
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
