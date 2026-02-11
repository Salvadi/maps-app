/**
 * DOCX Export Utilities
 * Functions to export mappings and photos to Word documents
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableCell,
  TableRow,
  WidthType,
  AlignmentType,
  HeadingLevel,
  ImageRun,
  BorderStyle,
  Header,
} from 'docx';
import { saveAs } from 'file-saver';
import type { Project, MappingEntry, Photo } from '../db/database';

// Import header images
import headerImage1 from '../assets/image1.png';
import headerImage2 from '../assets/image2.jpg';
import headerImage3 from '../assets/image3.jpeg';

type MappingWithPhotos = Omit<MappingEntry, 'photos'> & {
  photos: Photo[];
};

interface GroupedMapping {
  floor: string;
  rooms: {
    room: string;
    interventions: {
      intervention: string;
      mappings: MappingWithPhotos[];
    }[];
  }[];
}

/**
 * Group mappings by floor, room, and intervention
 */
function groupMappingsByFloorRoomIntervention(
  mappings: MappingWithPhotos[],
  project: Project
): GroupedMapping[] {
  const grouped = new Map<string, Map<string, Map<string, MappingWithPhotos[]>>>();

  // Group by floor -> room -> intervention
  for (const mapping of mappings) {
    const floor = mapping.floor;
    const room = mapping.room || '';
    const intervention = mapping.intervention || '';

    if (!grouped.has(floor)) {
      grouped.set(floor, new Map());
    }
    const floorMap = grouped.get(floor)!;

    if (!floorMap.has(room)) {
      floorMap.set(room, new Map());
    }
    const roomMap = floorMap.get(room)!;

    if (!roomMap.has(intervention)) {
      roomMap.set(intervention, []);
    }
    roomMap.get(intervention)!.push(mapping);
  }

  // Convert to array structure and sort
  const result: GroupedMapping[] = [];

  // Sort floors numerically
  const sortedFloors = Array.from(grouped.keys()).sort((a, b) => parseFloat(a) - parseFloat(b));

  for (const floor of sortedFloors) {
    const floorMap = grouped.get(floor)!;
    const rooms: GroupedMapping['rooms'] = [];

    // Sort rooms
    const sortedRooms = Array.from(floorMap.keys()).sort();

    for (const room of sortedRooms) {
      const roomMap = floorMap.get(room)!;
      const interventions: GroupedMapping['rooms'][0]['interventions'] = [];

      // Sort interventions
      const sortedInterventions = Array.from(roomMap.keys()).sort((a, b) => {
        const numA = parseInt(a) || 0;
        const numB = parseInt(b) || 0;
        return numA - numB;
      });

      for (const intervention of sortedInterventions) {
        const mappingsList = roomMap.get(intervention)!;
        interventions.push({
          intervention,
          mappings: mappingsList,
        });
      }

      rooms.push({ room, interventions });
    }

    result.push({ floor, rooms });
  }

  return result;
}

/**
 * Generate photo filename prefix
 */
function generatePhotoPrefix(
  floor: string,
  room: string | undefined,
  intervention: string | undefined,
  project: Project
): string {
  const parts: string[] = [];

  if (project.floors && project.floors.length > 1) {
    parts.push(`P${floor}`);
  }

  if (project.useRoomNumbering && room) {
    parts.push(`S${room}`);
  }

  if (project.useInterventionNumbering && intervention) {
    parts.push(`Int${intervention}`);
  }

  return parts.length > 0 ? parts.join('_') + '_' : '';
}

/**
 * Get label from options
 */
function getLabel(options: { value: string; label: string }[], value: string): string {
  const option = options.find(opt => opt.value === value);
  return option?.label || value;
}

/**
 * Create document header with letterhead images
 */
async function createDocumentHeader(): Promise<Header> {
  // Load header images
  const loadImage = async (url: string): Promise<Uint8Array> => {
    const response = await fetch(url);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  };

  const image1Data = await loadImage(headerImage1);
  const image2Data = await loadImage(headerImage2);
  const image3Data = await loadImage(headerImage3);

  return new Header({
    children: [
      new Paragraph({
        children: [
          new ImageRun({
            data: image1Data,
            transformation: {
              width: 200,
              height: 50,
            },
            type: 'png',
          }),
        ],
        alignment: AlignmentType.LEFT,
      }),
      new Paragraph({
        children: [
          new ImageRun({
            data: image2Data,
            transformation: {
              width: 150,
              height: 40,
            },
            type: 'jpg',
          }),
          new TextRun({ text: '  ' }),
          new ImageRun({
            data: image3Data,
            transformation: {
              width: 150,
              height: 40,
            },
            type: 'jpg',
          }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 200 },
      }),
    ],
  });
}

/**
 * Create title section with project name and address
 */
function createTitleSection(project: Project): Paragraph[] {
  return [
    new Paragraph({
      text: project.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      text: project.address || '',
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  ];
}

/**
 * Create floor heading
 */
function createFloorHeading(floor: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: `Piano ${floor}`,
        bold: true,
        size: 28,
      }),
    ],
    spacing: { before: 400, after: 200 },
  });
}

/**
 * Create room/intervention info table
 */
function createRoomInterventionTable(
  room: string | undefined,
  intervention: string | undefined,
  project: Project
): Table {
  const cells: TableCell[] = [];

  // Add "Stanza:" and value if room numbering is enabled
  if (project.useRoomNumbering) {
    cells.push(
      new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'Stanza:', bold: true })],
          }),
        ],
        width: { size: 20, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [new Paragraph({ text: room || '-' })],
        width: { size: 30, type: WidthType.PERCENTAGE },
      })
    );
  }

  // Add "Intervento:" and value if intervention numbering is enabled
  if (project.useInterventionNumbering) {
    cells.push(
      new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'Intervento:', bold: true })],
          }),
        ],
        width: { size: 20, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [new Paragraph({ text: intervention || '-' })],
        width: { size: 30, type: WidthType.PERCENTAGE },
      })
    );
  }

  return new Table({
    rows: [
      new TableRow({
        children: cells,
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
    },
  });
}

/**
 * Create photo grid with captions
 */
async function createPhotoGrid(
  mappings: MappingWithPhotos[],
  floor: string,
  room: string | undefined,
  intervention: string | undefined,
  project: Project
): Promise<Paragraph[]> {
  const paragraphs: Paragraph[] = [];

  // Collect all photos from all mappings
  const allPhotos: { blob: Blob; name: string }[] = [];

  for (const mapping of mappings) {
    const prefix = generatePhotoPrefix(floor, room, intervention, project);

    for (let i = 0; i < mapping.photos.length; i++) {
      const photo = mapping.photos[i];
      const photoNum = (i + 1).toString().padStart(2, '0');
      const photoName = `${prefix}${photoNum}`;

      allPhotos.push({
        blob: photo.blob,
        name: photoName,
      });
    }
  }

  // Create rows of photos (2 per row)
  const photosPerRow = 2;
  for (let i = 0; i < allPhotos.length; i += photosPerRow) {
    const rowPhotos = allPhotos.slice(i, i + photosPerRow);

    // Create table for photo row
    const cells: TableCell[] = [];

    for (const photo of rowPhotos) {
      // Convert blob to base64 data URL
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(photo.blob);
      });

      // Extract base64 data (remove data:image/jpeg;base64, prefix)
      const base64Data = base64.split(',')[1];
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      cells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new ImageRun({
                  data: bytes,
                  transformation: {
                    width: 250,
                    height: 250,
                  },
                  type: 'jpg',
                }),
              ],
              alignment: AlignmentType.CENTER,
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: photo.name,
                  italics: true,
                  size: 18,
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 100 },
            }),
          ],
          width: { size: 50, type: WidthType.PERCENTAGE },
          margins: {
            top: 100,
            bottom: 100,
            left: 100,
            right: 100,
          },
        })
      );
    }

    // Add empty cell if odd number of photos
    if (cells.length === 1) {
      cells.push(
        new TableCell({
          children: [new Paragraph('')],
          width: { size: 50, type: WidthType.PERCENTAGE },
        })
      );
    }

    paragraphs.push(
      new Paragraph({
        children: [
          new Table({
            rows: [
              new TableRow({
                children: cells,
              }),
            ],
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
          }) as any,
        ],
      })
    );
  }

  return paragraphs;
}

/**
 * Create details table
 */
function createDetailsTable(
  mappings: MappingWithPhotos[],
  floor: string,
  room: string | undefined,
  intervention: string | undefined,
  project: Project,
  supportoOptions: { value: string; label: string }[],
  tipoSupportoOptions: { value: string; label: string }[],
  attraversamentoOptions: { value: string; label: string }[]
): Table {
  const rows: TableRow[] = [];

  // Header row
  rows.push(
    new TableRow({
      children: [
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Foto', bold: true })],
            }),
          ],
          shading: { fill: 'E0E0E0' },
        }),
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Supporto', bold: true })],
            }),
          ],
          shading: { fill: 'E0E0E0' },
        }),
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Attraversamento', bold: true })],
            }),
          ],
          shading: { fill: 'E0E0E0' },
        }),
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Quantità', bold: true })],
            }),
          ],
          shading: { fill: 'E0E0E0' },
        }),
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Dimensioni', bold: true })],
            }),
          ],
          shading: { fill: 'E0E0E0' },
        }),
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Tipologico', bold: true })],
            }),
          ],
          shading: { fill: 'E0E0E0' },
        }),
      ],
      tableHeader: true,
    })
  );

  // Data rows
  for (const mapping of mappings) {
    const prefix = generatePhotoPrefix(floor, room, intervention, project);

    // Generate photo range
    let photoRange = '';
    if (mapping.photos.length > 0) {
      if (mapping.photos.length === 1) {
        photoRange = `${prefix}01`;
      } else {
        const lastNum = mapping.photos.length.toString().padStart(2, '0');
        photoRange = `${prefix}01-${lastNum}`;
      }
    }

    // Process each crossing
    const crossingsToProcess = mapping.crossings.length > 0 ? mapping.crossings : [null];

    for (const crossing of crossingsToProcess) {
      // Skip row if no tipologico
      if (!crossing || !crossing.tipologicoId) {
        continue;
      }

      const supportoLabel = crossing.supporto
        ? getLabel(supportoOptions, crossing.supporto)
        : '-';
      const tipoSupportoLabel = crossing.tipoSupporto
        ? getLabel(tipoSupportoOptions, crossing.tipoSupporto)
        : '-';
      const supportoComplete = `${supportoLabel} ${tipoSupportoLabel}`.trim();

      const attraversamentoText =
        crossing.attraversamento === 'Altro' && crossing.attraversamentoCustom
          ? crossing.attraversamentoCustom
          : crossing.attraversamento
          ? getLabel(attraversamentoOptions, crossing.attraversamento)
          : '-';

      // Get tipologico number
      const tipologico = project.typologies.find(t => t.id === crossing.tipologicoId);
      const tipologicoText = tipologico ? `Tip. ${tipologico.number}` : '-';

      rows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ text: photoRange || '-' })],
            }),
            new TableCell({
              children: [new Paragraph({ text: supportoComplete })],
            }),
            new TableCell({
              children: [new Paragraph({ text: attraversamentoText })],
            }),
            new TableCell({
              children: [new Paragraph({ text: crossing.quantita?.toString() || '-' })],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  text: crossing.diametro || crossing.dimensioni || '-',
                }),
              ],
            }),
            new TableCell({
              children: [new Paragraph({ text: tipologicoText })],
            }),
          ],
        })
      );
    }
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
    },
  });
}

/**
 * Export project mappings to DOCX report
 */
export async function exportMappingsToDOCX(
  project: Project,
  mappings: MappingWithPhotos[],
  supportoOptions: { value: string; label: string }[],
  tipoSupportoOptions: { value: string; label: string }[],
  attraversamentoOptions: { value: string; label: string }[]
): Promise<void> {
  try {
    // Create document header with letterhead
    const documentHeader = await createDocumentHeader();

    // Group mappings
    const grouped = groupMappingsByFloorRoomIntervention(mappings, project);

    // Build document sections
    const sections: (Paragraph | Table)[] = [];

    // Add title section
    sections.push(...createTitleSection(project));

    // Process each floor
    for (const floorGroup of grouped) {
      sections.push(createFloorHeading(floorGroup.floor));

      // Process each room
      for (const roomGroup of floorGroup.rooms) {
        // Process each intervention
        for (const interventionGroup of roomGroup.interventions) {
          // Add room/intervention info table
          sections.push(
            createRoomInterventionTable(
              roomGroup.room,
              interventionGroup.intervention,
              project
            )
          );

          // Add spacing
          sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));

          // Add photos
          const photoGrid = await createPhotoGrid(
            interventionGroup.mappings,
            floorGroup.floor,
            roomGroup.room,
            interventionGroup.intervention,
            project
          );
          sections.push(...photoGrid);

          // Add spacing
          sections.push(new Paragraph({ text: '', spacing: { after: 200 } }));

          // Add details table
          sections.push(
            createDetailsTable(
              interventionGroup.mappings,
              floorGroup.floor,
              roomGroup.room,
              interventionGroup.intervention,
              project,
              supportoOptions,
              tipoSupportoOptions,
              attraversamentoOptions
            )
          );

          // Add spacing after each intervention
          sections.push(new Paragraph({ text: '', spacing: { after: 400 } }));
        }
      }
    }

    // Create document with header
    const doc = new Document({
      sections: [
        {
          properties: {},
          headers: {
            default: documentHeader,
          },
          children: sections,
        },
      ],
    });

    // Generate and save
    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${project.title}_report.docx`);

    console.log('DOCX report exported successfully');
  } catch (error) {
    console.error('Error exporting DOCX report:', error);
    throw error;
  }
}
