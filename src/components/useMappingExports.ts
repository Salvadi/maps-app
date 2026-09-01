/**
 * @file useMappingExports
 * @description Hook personalizzato che raccoglie tutta la logica di esportazione
 * della vista mapping: Excel, ZIP con foto, planimetria PDF e aggiornamento etichette.
 * Gestisce internamente i flag di loading (isExporting, isUpdatingLabels).
 */

import { useState } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import {
  Project,
  MappingEntry,
  StructureEntry,
  Photo,
  User,
  FloorPlan,
  FloorPlanPoint,
  ensurePhotoBlob,
  getFloorPlanPoints,
  updateFloorPlanLabelsForMapping,
} from '../db';
import {
  buildFloorPlanExportPoints,
  buildFloorPlanLabelResolver,
  buildPreparedFloorPlanPdf,
  exportPreparedFloorPlanPdf,
  prepareFloorPlanExport,
} from '../utils/floorPlanExport';

// ============================================
// SEZIONE: Interfaccia parametri hook
// Tutti i dati e le funzioni helper provenienti da MappingView.
// ============================================

interface UseMappingExportsParams {
  project: Project;
  mappings: MappingEntry[];
  mappingPhotos: Record<string, Photo[]>;
  /** Structure entries del progetto (opzionale: solo l'export project-level le passa). */
  structures?: StructureEntry[];
  /** Foto delle strutture indicizzate per structureEntryId. */
  structurePhotos?: Record<string, Photo[]>;
  users: User[];
  floorPlans: FloorPlan[];
  floorPlanPoints: Record<string, FloorPlanPoint[]>;
  setFloorPlanPoints: (value: Record<string, FloorPlanPoint[]>) => void;
  getTipologicoNumber: (tipologicoId: string) => string;
  generatePhotoPrefix: (floor: string, room?: string, intervention?: string) => string;
  getUsername: (userId: string) => string;
  generateMappingLabel: (mapping: MappingEntry, photoCount: number) => string[];
}

// ============================================
// SEZIONE: Hook useMappingExports
// ============================================

export function useMappingExports({
  project,
  mappings,
  mappingPhotos,
  structures = [],
  structurePhotos = {},
  users,
  floorPlans,
  floorPlanPoints,
  setFloorPlanPoints,
  getTipologicoNumber,
  generatePhotoPrefix,
  getUsername,
  generateMappingLabel,
}: UseMappingExportsParams) {
  const [isExporting, setIsExporting] = useState(false);
  const [isUpdatingLabels, setIsUpdatingLabels] = useState(false);
  const resolveExportLabel = buildFloorPlanLabelResolver(mappings, mappingPhotos, generateMappingLabel);

  // ============================================
  // SEZIONE: Righe Excel strutture
  // Una riga per struttura (come per gli attraversamenti). Vuoto se il
  // progetto non ha structure entries (caller mapping-only).
  // ============================================
  const buildStructureRows = (): any[] => {
    const data: any[] = [];

    for (const entry of structures) {
      const photos = structurePhotos[entry.id] || [];
      const items = entry.structures.length > 0 ? entry.structures : [null];

      for (const structure of items) {
        const row: any = {};

        if (project.floors && project.floors.length > 1) {
          row['Piano'] = entry.floor;
        }
        if (project.useRoomNumbering) {
          row['Stanza'] = entry.room || '-';
        }
        if (project.useInterventionNumbering) {
          row['Intervento N.'] = entry.intervention || '-';
        }

        const photoNumbers = photos.map((_, idx) => {
          const photoNum = (idx + 1).toString().padStart(2, '0');
          const prefix = generatePhotoPrefix(entry.floor, entry.room, entry.intervention);
          return `${prefix}${photoNum}`;
        }).join(', ');
        row['N. foto'] = photoNumbers || '-';

        if (structure) {
          const strutturaText = structure.struttura === 'Altro' && structure.strutturaCustom
            ? structure.strutturaCustom
            : structure.struttura || '-';
          row['Struttura'] = strutturaText;
          row['Tipo struttura'] = structure.tipoStruttura || '-';
          row['Base (m)'] = structure.base ?? '-';
          row['Altezza (m)'] = structure.altezza ?? '-';
          row['Superficie (mq)'] = structure.superficie ?? '-';
          row['Lunghezza (ml)'] = structure.lunghezza ?? '-';
          row['Tipologico'] = structure.tipologicoId ? getTipologicoNumber(structure.tipologicoId) : '-';
          row['Note'] = structure.notes || '-';
        } else {
          row['Struttura'] = '-';
          row['Tipo struttura'] = '-';
          row['Base (m)'] = '-';
          row['Altezza (m)'] = '-';
          row['Superficie (mq)'] = '-';
          row['Lunghezza (ml)'] = '-';
          row['Tipologico'] = '-';
          row['Note'] = '-';
        }

        const date = new Date(entry.timestamp);
        row['Data'] = date.toLocaleDateString('it-IT');
        row['Ora'] = date.toLocaleTimeString('it-IT');
        row['User'] = getUsername(entry.createdBy);

        data.push(row);
      }
    }

    return data;
  };

  const appendStructureSheet = (wb: XLSX.WorkBook) => {
    const struttureData = buildStructureRows();
    if (struttureData.length === 0) {
      return;
    }
    const wsStrutture = XLSX.utils.json_to_sheet(struttureData);
    wsStrutture['!cols'] = Array(Object.keys(struttureData[0]).length).fill({ wch: 15 });
    XLSX.utils.book_append_sheet(wb, wsStrutture, 'Strutture');
  };

  // ============================================
  // SEZIONE: Export Excel
  // Genera un file .xlsx con tutte le mapping entries e i tipologici.
  // ============================================

  const handleExportExcel = async () => {
    setIsExporting(true);

    try {
      // Prepare data for Excel with conditional columns and multiple rows per attraversamento
      const data: any[] = [];

      for (const mapping of mappings) {
        const photos = mappingPhotos[mapping.id] || [];
        const crossings = mapping.crossings.length > 0 ? mapping.crossings : [null];

        // Create one row per attraversamento
        for (const crossing of crossings) {
          const row: any = {};

          // Conditional column: Piano (only if multiple floors)
          if (project.floors && project.floors.length > 1) {
            row['Piano'] = mapping.floor;
          }

          // Conditional column: Stanza (only if room numbering enabled)
          if (project.useRoomNumbering) {
            row['Stanza'] = mapping.room || '-';
          }

          // Conditional column: Intervento N. (only if intervention numbering enabled)
          if (project.useInterventionNumbering) {
            row['Intervento N.'] = mapping.intervention || '-';
          }

          // N. foto - generate photo numbers with zero padding
          const photoNumbers = photos.map((_, idx) => {
            const photoNum = (idx + 1).toString().padStart(2, '0');
            const prefix = generatePhotoPrefix(mapping.floor, mapping.room, mapping.intervention);
            return `${prefix}${photoNum}`;
          }).join(', ');
          row['N. foto'] = photoNumbers || '-';

          // Crossing data
          if (crossing) {
            row['Supporto'] = crossing.supporto || '-';
            row['Tipo supporto'] = crossing.tipoSupporto || '-';
            const attraversamentoText = crossing.attraversamento === 'Altro' && crossing.attraversamentoCustom
              ? crossing.attraversamentoCustom
              : crossing.attraversamento || '-';
            row['Attraversamento'] = attraversamentoText;
            row['Quantità'] = crossing.quantita || '-';
            row['Diametro'] = crossing.diametro || '-';
            row['Dimensioni'] = crossing.dimensioni || '-';
            row['Tipologico'] = crossing.tipologicoId ? getTipologicoNumber(crossing.tipologicoId) : '-';
            row['Note'] = crossing.notes || '-';
          } else {
            row['Supporto'] = '-';
            row['Tipo supporto'] = '-';
            row['Attraversamento'] = '-';
            row['Quantità'] = '-';
            row['Diametro'] = '-';
            row['Dimensioni'] = '-';
            row['Tipologico'] = '-';
            row['Note'] = '-';
          }

          // Data and User - split date and time
          const date = new Date(mapping.timestamp);
          row['Data'] = date.toLocaleDateString('it-IT');
          row['Ora'] = date.toLocaleTimeString('it-IT');
          row['User'] = getUsername(mapping.createdBy);

          data.push(row);
        }
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);

      // Auto-size columns
      const colCount = Object.keys(data[0] || {}).length;
      ws['!cols'] = Array(colCount).fill({ wch: 15 });

      XLSX.utils.book_append_sheet(wb, ws, 'Mappings');

      // Add Tipologici sheet
      if (project.typologies && project.typologies.length > 0) {
        const tipologiciData = [...project.typologies].sort((a, b) => a.number - b.number).map(tip => {
          const attraversamentoText = tip.attraversamento === 'Altro' && tip.attraversamentoCustom
            ? tip.attraversamentoCustom
            : tip.attraversamento || '-';

          return {
            'Numero': tip.number,
            'Supporto': tip.supporto || '-',
            'Tipo Supporto': tip.tipoSupporto || '-',
            'Attraversamento': attraversamentoText,
            'Marca Prodotto': tip.marcaProdottoUtilizzato || '-',
            'Prodotti Selezionati': tip.prodottiSelezionati.join(', ') || '-',
          };
        });
        const wsTipologici = XLSX.utils.json_to_sheet(tipologiciData);
        wsTipologici['!cols'] = Array(6).fill({ wch: 20 });
        XLSX.utils.book_append_sheet(wb, wsTipologici, 'Tipologici');
      }

      appendStructureSheet(wb);

      XLSX.writeFile(wb, `${project.title}_mappings.xlsx`);

      console.log('Excel exported successfully');
    } catch (error) {
      console.error('Failed to export Excel:', error);
      alert('Failed to export Excel file');
    } finally {
      setIsExporting(false);
    }
  };

  // ============================================
  // SEZIONE: Export ZIP (foto + Excel + planimetrie PDF)
  // Genera un archivio ZIP con foto organizzate per piano/stanza,
  // il file Excel e le planimetrie annotate in PDF.
  // ============================================

  const handleExportZip = async () => {
    setIsExporting(true);

    try {
      const zip = new JSZip();

      // Prepare Excel data with same logic as handleExportExcel
      const data: any[] = [];

      for (const mapping of mappings) {
        const photos = mappingPhotos[mapping.id] || [];
        const crossings = mapping.crossings.length > 0 ? mapping.crossings : [null];

        // Create one row per attraversamento
        for (const crossing of crossings) {
          const row: any = {};

          // Conditional column: Piano (only if multiple floors)
          if (project.floors && project.floors.length > 1) {
            row['Piano'] = mapping.floor;
          }

          // Conditional column: Stanza (only if room numbering enabled)
          if (project.useRoomNumbering) {
            row['Stanza'] = mapping.room || '-';
          }

          // Conditional column: Intervento N. (only if intervention numbering enabled)
          if (project.useInterventionNumbering) {
            row['Intervento N.'] = mapping.intervention || '-';
          }

          // N. foto - generate photo numbers with zero padding
          const photoNumbers = photos.map((_, idx) => {
            const photoNum = (idx + 1).toString().padStart(2, '0');
            const prefix = generatePhotoPrefix(mapping.floor, mapping.room, mapping.intervention);
            return `${prefix}${photoNum}`;
          }).join(', ');
          row['N. foto'] = photoNumbers || '-';

          // Crossing data
          if (crossing) {
            row['Supporto'] = crossing.supporto || '-';
            row['Tipo supporto'] = crossing.tipoSupporto || '-';
            const attraversamentoText = crossing.attraversamento === 'Altro' && crossing.attraversamentoCustom
              ? crossing.attraversamentoCustom
              : crossing.attraversamento || '-';
            row['Attraversamento'] = attraversamentoText;
            row['Quantità'] = crossing.quantita || '-';
            row['Diametro'] = crossing.diametro || '-';
            row['Dimensioni'] = crossing.dimensioni || '-';
            row['Tipologico'] = crossing.tipologicoId ? getTipologicoNumber(crossing.tipologicoId) : '-';
            row['Note'] = crossing.notes || '-';
          } else {
            row['Supporto'] = '-';
            row['Tipo supporto'] = '-';
            row['Attraversamento'] = '-';
            row['Quantità'] = '-';
            row['Diametro'] = '-';
            row['Dimensioni'] = '-';
            row['Tipologico'] = '-';
            row['Note'] = '-';
          }

          // Data and User - split date and time
          const date = new Date(mapping.timestamp);
          row['Data'] = date.toLocaleDateString('it-IT');
          row['Ora'] = date.toLocaleTimeString('it-IT');
          row['User'] = getUsername(mapping.createdBy);

          data.push(row);
        }
      }

      // Create Excel file
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      const colCount = Object.keys(data[0] || {}).length;
      ws['!cols'] = Array(colCount).fill({ wch: 15 });
      XLSX.utils.book_append_sheet(wb, ws, 'Mappings');

      // Add Tipologici sheet
      if (project.typologies && project.typologies.length > 0) {
        const tipologiciData = [...project.typologies].sort((a, b) => a.number - b.number).map(tip => {
          const attraversamentoText = tip.attraversamento === 'Altro' && tip.attraversamentoCustom
            ? tip.attraversamentoCustom
            : tip.attraversamento || '-';

          return {
            'Numero': tip.number,
            'Supporto': tip.supporto || '-',
            'Tipo Supporto': tip.tipoSupporto || '-',
            'Attraversamento': attraversamentoText,
            'Marca Prodotto': tip.marcaProdottoUtilizzato || '-',
            'Prodotti Selezionati': tip.prodottiSelezionati.join(', ') || '-',
          };
        });
        const wsTipologici = XLSX.utils.json_to_sheet(tipologiciData);
        wsTipologici['!cols'] = Array(6).fill({ wch: 20 });
        XLSX.utils.book_append_sheet(wb, wsTipologici, 'Tipologici');
      }

      appendStructureSheet(wb);

      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      zip.file(`${project.title}_mappings.xlsx`, excelBuffer);

      // Add photos organized by Piano/Stanza hierarchy
      for (const mapping of mappings) {
        const photos = mappingPhotos[mapping.id] || [];
        const prefix = generatePhotoPrefix(mapping.floor, mapping.room, mapping.intervention);

        // Build folder path: Piano X / Stanza Y
        let folderPath = '';
        if (project.floors && project.floors.length > 1) {
          folderPath = `Piano ${mapping.floor}/`;
          if (project.useRoomNumbering && mapping.room) {
            folderPath += `Stanza ${mapping.room}/`;
          }
        } else if (project.useRoomNumbering && mapping.room) {
          folderPath = `Stanza ${mapping.room}/`;
        }

        for (let i = 0; i < photos.length; i++) {
          const photo = await ensurePhotoBlob(photos[i].id) || photos[i];
          if (!photo.blob) {
            continue;
          }
          const photoNum = (i + 1).toString().padStart(2, '0');
          const filename = `${prefix}${photoNum}.jpg`;
          const fullPath = folderPath + filename;
          zip.file(fullPath, photo.blob);
        }
      }

      // Add structure photos under the Strutture/ folder (mirror della gerarchia Piano/Stanza)
      for (const entry of structures) {
        const photos = structurePhotos[entry.id] || [];
        const prefix = generatePhotoPrefix(entry.floor, entry.room, entry.intervention);

        let folderPath = 'Strutture/';
        if (project.floors && project.floors.length > 1) {
          folderPath += `Piano ${entry.floor}/`;
          if (project.useRoomNumbering && entry.room) {
            folderPath += `Stanza ${entry.room}/`;
          }
        } else if (project.useRoomNumbering && entry.room) {
          folderPath += `Stanza ${entry.room}/`;
        }

        for (let i = 0; i < photos.length; i++) {
          // getPhotosForStructure non fa write-through cache: il blob va idratato
          // dal signed remoteUrl (ensurePhotoBlob fallirebbe perché manca la riga in Dexie).
          let photo = photos[i];
          if (!photo.blob) {
            const hydrated = await ensurePhotoBlob(photo.id);
            if (hydrated?.blob) {
              photo = hydrated;
            }
          }
          let blob = photo.blob;
          if (!blob && photo.remoteUrl) {
            try {
              const response = await fetch(photo.remoteUrl);
              if (response.ok) {
                blob = await response.blob();
              }
            } catch (error) {
              console.warn(`Failed to fetch structure photo ${photo.id}`, error);
            }
          }
          if (!blob) {
            continue;
          }
          const photoNum = (i + 1).toString().padStart(2, '0');
          zip.file(folderPath + `${prefix}${photoNum}.jpg`, blob);
        }
      }

      // Add annotated floor plans to Planimetrie folder
      for (const plan of floorPlans) {
        const rawPoints = floorPlanPoints[plan.id] || [];

        // Only export if there are points
        if (rawPoints.length === 0) continue;

        const preparedExport = await prepareFloorPlanExport(plan);
        if (!preparedExport) {
          console.warn(`⚠️  Skipping floor plan ${plan.id} - no image blob available`);
          continue;
        }

        const exportPoints = buildFloorPlanExportPoints(rawPoints, resolveExportLabel);

        try {
          const pdfBytes = await buildPreparedFloorPlanPdf(preparedExport, exportPoints, project, plan);
          zip.file(`Planimetrie/Piano_${plan.floor}_annotato.pdf`, pdfBytes);
        } catch (error) {
          console.error(`Error creating PDF for plan ${plan.floor}:`, error);
        }

      }

      // Generate ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      saveAs(zipBlob, `${project.title}_export.zip`);

      console.log('ZIP exported successfully');
    } catch (error) {
      console.error('Failed to export ZIP:', error);
      alert('Failed to export ZIP file');
    } finally {
      setIsExporting(false);
    }
  };

  // ============================================
  // SEZIONE: Aggiornamento etichette planimetria
  // Rigenera le etichette di tutti i punti planimetria
  // usando i dati aggiornati delle mapping entries.
  // ============================================

  const handleUpdateAllLabels = async () => {
    if (!window.confirm('Aggiornare tutte le etichette sulla planimetria con i dati più recenti delle mappature?')) {
      return;
    }

    setIsUpdatingLabels(true);
    let updatedCount = 0;
    let errorCount = 0;

    try {
      // Update labels for each mapping that has floor plan points
      for (const mapping of mappings) {
        try {
          const photos = mappingPhotos[mapping.id] || [];
          await updateFloorPlanLabelsForMapping(mapping.id, () =>
            generateMappingLabel(mapping, photos.length)
          );
          updatedCount++;
        } catch (error) {
          console.error(`Error updating labels for mapping ${mapping.id}:`, error);
          errorCount++;
        }
      }

      // Reload floor plan points to reflect changes
      const pointsMap: Record<string, FloorPlanPoint[]> = {};
      for (const plan of floorPlans) {
        const points = await getFloorPlanPoints(plan.id);
        pointsMap[plan.id] = points;
      }
      setFloorPlanPoints(pointsMap);

      if (errorCount === 0) {
        alert(`✓ Aggiornate con successo le etichette di ${updatedCount} mappature!`);
      } else {
        alert(`⚠️ Aggiornate ${updatedCount} etichette, ${errorCount} errori. Controlla la console per dettagli.`);
      }
    } catch (error) {
      console.error('Error updating floor plan labels:', error);
      alert('Errore durante l\'aggiornamento delle etichette. Riprova.');
    } finally {
      setIsUpdatingLabels(false);
    }
  };

  // ============================================
  // SEZIONE: Export planimetria singola in PDF
  // Genera PDF vettoriale con pdf-lib a partire da imageBlob e FloorPlanPoint[].
  // ============================================

  const handleExportFloorPlan = async (plan: FloorPlan) => {
    try {
      const preparedExport = await prepareFloorPlanExport(plan);
      if (!preparedExport) {
        alert('Errore: immagine della planimetria non disponibile.');
        return;
      }

      const rawPoints = floorPlanPoints[plan.id] || [];
      const exportPoints = buildFloorPlanExportPoints(rawPoints, resolveExportLabel);

      await exportPreparedFloorPlanPdf(preparedExport, exportPoints, `Piano_${plan.floor}_annotato.pdf`, project, plan);
      const qualityNote = preparedExport.pdfBlobBase64 ? ' (sfondo vettoriale)' : ' (sfondo raster)';
      alert(`✅ Planimetria esportata in PDF${qualityNote}`);
    } catch (error) {
      console.error('Failed to export floor plan:', error);
      alert('Errore durante l\'esportazione della planimetria');
    }
  };

  return {
    isExporting,
    isUpdatingLabels,
    handleExportExcel,
    handleExportZip,
    handleExportFloorPlan,
    handleUpdateAllLabels,
  };
}
