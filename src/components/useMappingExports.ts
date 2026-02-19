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
import jsPDF from 'jspdf';
import { exportCanvasToPDF, exportFloorPlanVectorPDF, buildFloorPlanVectorPDF } from '../utils/exportUtils';
import { base64ToBlob } from '../utils/floorPlanUtils';
import {
  Project,
  MappingEntry,
  Photo,
  User,
  FloorPlan,
  FloorPlanPoint,
  getFloorPlanBlobUrl,
  getFloorPlanPoints,
  updateFloorPlanLabelsForMapping,
} from '../db';

// ============================================
// SEZIONE: Interfaccia parametri hook
// Tutti i dati e le funzioni helper provenienti da MappingView.
// ============================================

interface UseMappingExportsParams {
  project: Project;
  mappings: MappingEntry[];
  mappingPhotos: Record<string, Photo[]>;
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
          const photo = photos[i];
          const photoNum = (i + 1).toString().padStart(2, '0');
          const filename = `${prefix}${photoNum}.jpg`;
          const fullPath = folderPath + filename;
          zip.file(fullPath, photo.blob);
        }
      }

      // Add annotated floor plans to Planimetrie folder
      for (const plan of floorPlans) {
        const points = floorPlanPoints[plan.id] || [];

        // Only export if there are points
        if (points.length === 0) continue;

        try {
          // Try vector export if original PDF is available
          if (plan.pdfBlobBase64) {
            const pdfBlob = base64ToBlob(plan.pdfBlobBase64, 'application/pdf');

            // Build ExportPoint array
            const exportPoints = points.map((point) => {
              let labelText: string[] = point.metadata?.labelText || ['Punto'];
              if (!point.metadata?.labelText) {
                const mappingEntry = mappings.find(m => m.id === point.mappingEntryId);
                if (mappingEntry) {
                  const photos = mappingPhotos[mappingEntry.id] || [];
                  labelText = generateMappingLabel(mappingEntry, photos.length);
                }
              }

              return {
                id: point.id,
                type: point.pointType as 'parete' | 'solaio' | 'perimetro' | 'generico',
                pointX: point.pointX,
                pointY: point.pointY,
                labelX: point.labelX,
                labelY: point.labelY,
                labelText,
                perimeterPoints: point.perimeterPoints,
                customText: point.customText,
                labelBackgroundColor: point.metadata?.labelBackgroundColor,
                labelTextColor: point.metadata?.labelTextColor,
              };
            });

            // Export as vector PDF bytes
            const pdfBytes = await buildFloorPlanVectorPDF(pdfBlob, exportPoints, plan.width, plan.height);
            zip.file(`Planimetrie/Piano_${plan.floor}_annotato.pdf`, pdfBytes);
          } else {
            // Fallback to raster export if no original PDF
            console.warn(`⚠️  Using raster export for floor plan ${plan.id} - no original PDF available`);

            if (!plan.imageBlob) {
              console.warn(`⚠️  Skipping floor plan ${plan.id} - no image blob available`);
              continue;
            }

            // Canvas-based raster export (legacy)
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;

            const img = new Image();
            const imageUrl = getFloorPlanBlobUrl(plan.imageBlob);

            await new Promise<void>((resolve, reject) => {
              img.onload = () => {
                try {
                  canvas.width = img.width;
                  canvas.height = img.height;
                  ctx.drawImage(img, 0, 0);

                  // Draw points (simplified)
                  points.forEach((point) => {
                    const pointX = point.pointX * img.width;
                    const pointY = point.pointY * img.height;

                    let pointColor = '#333333';
                    switch (point.pointType) {
                      case 'parete': pointColor = '#0066FF'; break;
                      case 'solaio': pointColor = '#00CC66'; break;
                      case 'perimetro': pointColor = '#FF6600'; break;
                      case 'generico': pointColor = '#9933FF'; break;
                    }

                    ctx.fillStyle = pointColor;
                    ctx.beginPath();
                    ctx.arc(pointX, pointY, 8, 0, 2 * Math.PI);
                    ctx.fill();
                  });

                  const canvasWidth = canvas.width;
                  const canvasHeight = canvas.height;
                  const aspectRatio = canvasWidth / canvasHeight;

                  const pdf = new jsPDF({
                    orientation: aspectRatio > 1 ? 'landscape' : 'portrait',
                    unit: 'mm',
                    format: 'a4'
                  });

                  const pdfWidth = aspectRatio > 1 ? 297 : 210;
                  const pdfHeight = aspectRatio > 1 ? 210 : 297;
                  const imgData = canvas.toDataURL('image/png');
                  const imgAspectRatio = canvasWidth / canvasHeight;
                  const pdfAspectRatio = pdfWidth / pdfHeight;

                  let finalWidth = pdfWidth;
                  let finalHeight = pdfHeight;
                  let x = 0;
                  let y = 0;

                  if (imgAspectRatio > pdfAspectRatio) {
                    finalHeight = pdfWidth / imgAspectRatio;
                    y = (pdfHeight - finalHeight) / 2;
                  } else {
                    finalWidth = pdfHeight * imgAspectRatio;
                    x = (pdfWidth - finalWidth) / 2;
                  }

                  pdf.addImage(imgData, 'PNG', x, y, finalWidth, finalHeight);
                  const pdfBlob = pdf.output('blob');
                  zip.file(`Planimetrie/Piano_${plan.floor}_annotato.pdf`, pdfBlob);

                  URL.revokeObjectURL(imageUrl);
                  resolve();
                } catch (error) {
                  reject(error);
                }
              };

              img.onerror = () => {
                URL.revokeObjectURL(imageUrl);
                reject(new Error('Failed to load image'));
              };

              img.src = imageUrl;
            });
          }
        } catch (error) {
          console.error(`Error exporting floor plan ${plan.id} to ZIP:`, error);
          // Continue with other floor plans even if one fails
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
  // Renderizza su canvas la planimetria annotata con punti ed etichette,
  // poi esporta in PDF tramite exportCanvasToPDF.
  // ============================================

  const handleExportFloorPlan = async (plan: FloorPlan) => {
    try {
      // Check if pdfBlobBase64 is available (original PDF for vector preservation)
      if (!plan.pdfBlobBase64) {
        // Fallback to raster export if no original PDF
        console.warn('No original PDF blob found, using raster export fallback');
        if (!plan.imageBlob) {
          if (plan.imageUrl) {
            alert('La planimetria deve essere scaricata da Supabase. Prova a sincronizzare il progetto e riprova.');
          } else {
            alert('Errore: immagine della planimetria non disponibile.');
          }
          return;
        }
        // Use old canvas-based export as fallback
        const points = floorPlanPoints[plan.id] || [];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        const imageUrl = getFloorPlanBlobUrl(plan.imageBlob);

        return new Promise<void>((resolve) => {
          img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            // Draw points (simplified raster fallback)
            points.forEach((point) => {
              const pointX = point.pointX * img.width;
              const pointY = point.pointY * img.height;

              let pointColor = '#333333';
              switch (point.pointType) {
                case 'parete': pointColor = '#0066FF'; break;
                case 'solaio': pointColor = '#00CC66'; break;
                case 'perimetro': pointColor = '#FF6600'; break;
                case 'generico': pointColor = '#9933FF'; break;
              }

              ctx.fillStyle = pointColor;
              ctx.beginPath();
              ctx.arc(pointX, pointY, 8, 0, 2 * Math.PI);
              ctx.fill();
            });

            try {
              exportCanvasToPDF(canvas, `Piano_${plan.floor}_annotato.pdf`);
              alert('⚠️ Esportazione raster (PDF originale non disponibile). Reimportare la planimetria per l\'export vettoriale.');
            } catch (error) {
              console.error('Export PDF error:', error);
              alert('❌ Errore durante l\'esportazione PDF');
            }

            URL.revokeObjectURL(imageUrl);
            resolve();
          };

          img.src = imageUrl;
        });
      }

      // Vector export: convert Base64 back to Blob and export
      const pdfBlob = base64ToBlob(plan.pdfBlobBase64, 'application/pdf');
      const points = floorPlanPoints[plan.id] || [];

      // Build ExportPoint array for pdf-lib
      const exportPoints = points.map((point) => {
        // Get label text from metadata or generate from mapping entry
        let labelText: string[] = point.metadata?.labelText || ['Punto'];
        if (!point.metadata?.labelText) {
          const mappingEntry = mappings.find(m => m.id === point.mappingEntryId);
          if (mappingEntry) {
            const photos = mappingPhotos[mappingEntry.id] || [];
            labelText = generateMappingLabel(mappingEntry, photos.length);
          }
        }

        return {
          id: point.id,
          type: point.pointType as 'parete' | 'solaio' | 'perimetro' | 'generico',
          pointX: point.pointX,
          pointY: point.pointY,
          labelX: point.labelX,
          labelY: point.labelY,
          labelText,
          perimeterPoints: point.perimeterPoints,
          customText: point.customText,
          labelBackgroundColor: point.metadata?.labelBackgroundColor,
          labelTextColor: point.metadata?.labelTextColor,
        };
      });

      // Export as vector PDF
      await exportFloorPlanVectorPDF(
        pdfBlob,
        exportPoints,
        plan.width,
        plan.height,
        `Piano_${plan.floor}_annotato.pdf`
      );

      alert('✅ Planimetria esportata in PDF vettoriale');
    } catch (error) {
      console.error('Failed to export floor plan:', error);
      alert('❌ Errore durante l\'esportazione della planimetria');
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
