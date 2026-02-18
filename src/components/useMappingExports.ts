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
import { exportCanvasToPDF } from '../utils/exportUtils';
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

        // Skip if no imageBlob available
        if (!plan.imageBlob) {
          console.warn(`⚠️  Skipping floor plan ${plan.id} - no image blob available`);
          continue;
        }

        // Generate annotated floor plan image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const img = new Image();
        const imageUrl = getFloorPlanBlobUrl(plan.imageBlob);

        // Wait for image to load using a Promise
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            // Draw points and labels (same logic as handleExportFloorPlan)
            points.forEach((point) => {
              const pointX = point.pointX * img.width;
              const pointY = point.pointY * img.height;
              const labelX = point.labelX * img.width;
              const labelY = point.labelY * img.height;

              let pointColor = '#333333';
              switch (point.pointType) {
                case 'parete': pointColor = '#0066FF'; break;
                case 'solaio': pointColor = '#00CC66'; break;
                case 'perimetro': pointColor = '#FF6600'; break;
                case 'generico': pointColor = '#9933FF'; break;
              }

              if (point.pointType === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
                ctx.strokeStyle = pointColor;
                ctx.lineWidth = 3;
                ctx.beginPath();
                const firstPoint = point.perimeterPoints[0];
                ctx.moveTo(firstPoint.x * img.width, firstPoint.y * img.height);
                for (let i = 1; i < point.perimeterPoints.length; i++) {
                  const p = point.perimeterPoints[i];
                  ctx.lineTo(p.x * img.width, p.y * img.height);
                }
                ctx.stroke();

                point.perimeterPoints.forEach(p => {
                  ctx.fillStyle = pointColor;
                  ctx.beginPath();
                  ctx.arc(p.x * img.width, p.y * img.height, 6, 0, 2 * Math.PI);
                  ctx.fill();
                  ctx.fillStyle = '#FFFFFF';
                  ctx.beginPath();
                  ctx.arc(p.x * img.width, p.y * img.height, 3, 0, 2 * Math.PI);
                  ctx.fill();
                });
              } else {
                ctx.fillStyle = pointColor;
                ctx.beginPath();
                ctx.arc(pointX, pointY, 8, 0, 2 * Math.PI);
                ctx.fill();
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 2;
                ctx.stroke();
              }

              // Get label text from metadata if available, otherwise generate from mapping entry
              let labelText: string[] = point.metadata?.labelText || ['Punto'];

              if (!point.metadata?.labelText) {
                const mappingEntry = mappings.find(m => m.id === point.mappingEntryId);
                if (mappingEntry) {
                  const photos = mappingPhotos[mappingEntry.id] || [];
                  labelText = generateMappingLabel(mappingEntry, photos.length);
                }
              }

              const padding = 8;
              const fontSize = 14;
              const lineHeight = 18;
              const minWidth = 70;
              const minHeight = 36;
              ctx.font = `bold ${fontSize}px Arial`;
              const maxWidth = Math.max(...labelText.map(line => ctx.measureText(line).width));
              const labelWidth = Math.max(maxWidth + (padding * 2), minWidth);
              const labelHeight = Math.max((labelText.length * lineHeight) + (padding * 2), minHeight);

              // Use custom colors if available
              const bgColor = point.metadata?.labelBackgroundColor || 'rgba(255, 255, 255, 0.95)';
              const textColor = point.metadata?.labelTextColor || '#000000';

              ctx.fillStyle = bgColor;
              ctx.strokeStyle = '#333333';
              ctx.lineWidth = 2;
              ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
              ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);

              ctx.fillStyle = textColor;
              ctx.textBaseline = 'top';
              labelText.forEach((line, index) => {
                const yPos = labelY + padding + (index * lineHeight);
                let xPos = labelX + padding;

                if (line.startsWith('foto n. ')) {
                  ctx.font = `italic ${fontSize}px Arial`;
                  const intText = 'foto n. ';
                  ctx.fillText(intText, xPos, yPos);
                  xPos += ctx.measureText(intText).width;
                  ctx.font = `bold ${fontSize}px Arial`;
                  ctx.fillText(line.substring(8), xPos, yPos);
                } else if (line.startsWith('Tip. ')) {
                  ctx.font = `italic ${fontSize}px Arial`;
                  const tipText = 'Tip. ';
                  ctx.fillText(tipText, xPos, yPos);
                  xPos += ctx.measureText(tipText).width;
                  ctx.font = `bold ${fontSize}px Arial`;
                  ctx.fillText(line.substring(5), xPos, yPos);
                } else {
                  ctx.font = `bold ${fontSize}px Arial`;
                  ctx.fillText(line, xPos, yPos);
                }
              });

              ctx.strokeStyle = '#666666';
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 5]);

              const labelCenterX = labelX + labelWidth / 2;
              const labelCenterY = labelY + labelHeight / 2;

              if (point.pointType === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
                let minDistance = Infinity;
                let closestX = pointX;
                let closestY = pointY;

                for (let i = 0; i < point.perimeterPoints.length - 1; i++) {
                  const p1 = point.perimeterPoints[i];
                  const p2 = point.perimeterPoints[i + 1];
                  const p1x = p1.x * img.width;
                  const p1y = p1.y * img.height;
                  const p2x = p2.x * img.width;
                  const p2y = p2.y * img.height;

                  const dx = p2x - p1x;
                  const dy = p2y - p1y;
                  const lengthSquared = dx * dx + dy * dy;
                  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((labelCenterX - p1x) * dx + (labelCenterY - p1y) * dy) / lengthSquared));
                  const closestOnSeg = { x: p1x + t * dx, y: p1y + t * dy };

                  const distance = Math.sqrt(
                    Math.pow(closestOnSeg.x - labelCenterX, 2) +
                    Math.pow(closestOnSeg.y - labelCenterY, 2)
                  );

                  if (distance < minDistance) {
                    minDistance = distance;
                    closestX = closestOnSeg.x;
                    closestY = closestOnSeg.y;
                  }
                }

                const edges = [
                  { x: labelCenterX, y: labelY },
                  { x: labelCenterX, y: labelY + labelHeight },
                  { x: labelX, y: labelCenterY },
                  { x: labelX + labelWidth, y: labelCenterY },
                ];

                let minEdgeDist = Infinity;
                let targetX = labelCenterX;
                let targetY = labelCenterY;

                edges.forEach(edge => {
                  const distance = Math.sqrt(
                    Math.pow(edge.x - closestX, 2) +
                    Math.pow(edge.y - closestY, 2)
                  );
                  if (distance < minEdgeDist) {
                    minEdgeDist = distance;
                    targetX = edge.x;
                    targetY = edge.y;
                  }
                });

                ctx.beginPath();
                ctx.moveTo(closestX, closestY);
                ctx.lineTo(targetX, targetY);
                ctx.stroke();
              } else {
                const edges = [
                  { x: labelCenterX, y: labelY },
                  { x: labelCenterX, y: labelY + labelHeight },
                  { x: labelX, y: labelCenterY },
                  { x: labelX + labelWidth, y: labelCenterY },
                ];

                let minDistance = Infinity;
                let targetX = labelCenterX;
                let targetY = labelCenterY;

                edges.forEach(edge => {
                  const distance = Math.sqrt(
                    Math.pow(edge.x - pointX, 2) +
                    Math.pow(edge.y - pointY, 2)
                  );
                  if (distance < minDistance) {
                    minDistance = distance;
                    targetX = edge.x;
                    targetY = edge.y;
                  }
                });

                ctx.beginPath();
                ctx.moveTo(pointX, pointY);
                ctx.lineTo(targetX, targetY);
                ctx.stroke();
              }

              ctx.setLineDash([]);
            });

            // Convert canvas to PDF blob and add to ZIP
            try {
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

              resolve();
            } catch (error) {
              console.error('Error creating PDF for ZIP:', error);
              reject(error);
            }

            URL.revokeObjectURL(imageUrl);
          };

          img.src = imageUrl;
        });
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
      // Check if imageBlob is available
      if (!plan.imageBlob) {
        if (plan.imageUrl) {
          alert('La planimetria deve essere scaricata da Supabase. Prova a sincronizzare il progetto e riprova.');
        } else {
          alert('Errore: immagine della planimetria non disponibile.');
        }
        return;
      }

      const points = floorPlanPoints[plan.id] || [];

      // Create canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Load image
      const img = new Image();
      const imageUrl = getFloorPlanBlobUrl(plan.imageBlob);

      img.onload = () => {
        // Set canvas size to image size
        canvas.width = img.width;
        canvas.height = img.height;

        // Draw image
        ctx.drawImage(img, 0, 0);

        // Draw points and labels
        points.forEach((point) => {
          const pointX = point.pointX * img.width;
          const pointY = point.pointY * img.height;
          const labelX = point.labelX * img.width;
          const labelY = point.labelY * img.height;

          // Get point color based on type
          let pointColor = '#333333';
          switch (point.pointType) {
            case 'parete':
              pointColor = '#0066FF';
              break;
            case 'solaio':
              pointColor = '#00CC66';
              break;
            case 'perimetro':
              pointColor = '#FF6600';
              break;
            case 'generico':
              pointColor = '#9933FF';
              break;
          }

          // Draw perimeter if exists
          if (point.pointType === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
            ctx.strokeStyle = pointColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            const firstPoint = point.perimeterPoints[0];
            ctx.moveTo(firstPoint.x * img.width, firstPoint.y * img.height);
            for (let i = 1; i < point.perimeterPoints.length; i++) {
              const p = point.perimeterPoints[i];
              ctx.lineTo(p.x * img.width, p.y * img.height);
            }
            ctx.stroke();

            // Draw vertices
            point.perimeterPoints.forEach(p => {
              ctx.fillStyle = pointColor;
              ctx.beginPath();
              ctx.arc(p.x * img.width, p.y * img.height, 6, 0, 2 * Math.PI);
              ctx.fill();
              ctx.fillStyle = '#FFFFFF';
              ctx.beginPath();
              ctx.arc(p.x * img.width, p.y * img.height, 3, 0, 2 * Math.PI);
              ctx.fill();
            });
          } else {
            // Draw point marker
            ctx.fillStyle = pointColor;
            ctx.beginPath();
            ctx.arc(pointX, pointY, 8, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          // Get label text from metadata if available, otherwise generate from mapping entry
          let labelText: string[] = point.metadata?.labelText || ['Punto'];

          if (!point.metadata?.labelText) {
            const mappingEntry = mappings.find(m => m.id === point.mappingEntryId);
            if (mappingEntry) {
              const photos = mappingPhotos[mappingEntry.id] || [];
              labelText = generateMappingLabel(mappingEntry, photos.length);
            }
          }

          // Draw label
          const padding = 8;
          const fontSize = 14;
          const lineHeight = 18;
          const minWidth = 70;
          const minHeight = 36;
          ctx.font = `bold ${fontSize}px Arial`;
          const maxWidth = Math.max(...labelText.map(line => ctx.measureText(line).width));
          const labelWidth = Math.max(maxWidth + (padding * 2), minWidth);
          const labelHeight = Math.max((labelText.length * lineHeight) + (padding * 2), minHeight);

          // Use custom colors if available
          const bgColor = point.metadata?.labelBackgroundColor || 'rgba(255, 255, 255, 0.95)';
          const textColor = point.metadata?.labelTextColor || '#000000';

          ctx.fillStyle = bgColor;
          ctx.strokeStyle = '#333333';
          ctx.lineWidth = 2;
          ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
          ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);

          ctx.fillStyle = textColor;
          ctx.textBaseline = 'top';
          labelText.forEach((line, index) => {
            const yPos = labelY + padding + (index * lineHeight);
            let xPos = labelX + padding;

            if (line.startsWith('foto n. ')) {
              ctx.font = `italic ${fontSize}px Arial`;
              const intText = 'foto n. ';
              ctx.fillText(intText, xPos, yPos);
              xPos += ctx.measureText(intText).width;
              ctx.font = `bold ${fontSize}px Arial`;
              ctx.fillText(line.substring(8), xPos, yPos);
            } else if (line.startsWith('Tip. ')) {
              ctx.font = `italic ${fontSize}px Arial`;
              const tipText = 'Tip. ';
              ctx.fillText(tipText, xPos, yPos);
              xPos += ctx.measureText(tipText).width;
              ctx.font = `bold ${fontSize}px Arial`;
              ctx.fillText(line.substring(5), xPos, yPos);
            } else {
              ctx.font = `bold ${fontSize}px Arial`;
              ctx.fillText(line, xPos, yPos);
            }
          });

          // Draw connecting line
          ctx.strokeStyle = '#666666';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);

          const labelCenterX = labelX + labelWidth / 2;
          const labelCenterY = labelY + labelHeight / 2;

          if (point.pointType === 'perimetro' && point.perimeterPoints && point.perimeterPoints.length > 1) {
            let minDistance = Infinity;
            let closestX = pointX;
            let closestY = pointY;

            for (let i = 0; i < point.perimeterPoints.length - 1; i++) {
              const p1 = point.perimeterPoints[i];
              const p2 = point.perimeterPoints[i + 1];
              const p1x = p1.x * img.width;
              const p1y = p1.y * img.height;
              const p2x = p2.x * img.width;
              const p2y = p2.y * img.height;

              const dx = p2x - p1x;
              const dy = p2y - p1y;
              const lengthSquared = dx * dx + dy * dy;
              const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((labelCenterX - p1x) * dx + (labelCenterY - p1y) * dy) / lengthSquared));
              const closestOnSeg = { x: p1x + t * dx, y: p1y + t * dy };

              const distance = Math.sqrt(
                Math.pow(closestOnSeg.x - labelCenterX, 2) +
                Math.pow(closestOnSeg.y - labelCenterY, 2)
              );

              if (distance < minDistance) {
                minDistance = distance;
                closestX = closestOnSeg.x;
                closestY = closestOnSeg.y;
              }
            }

            const edges = [
              { x: labelCenterX, y: labelY },
              { x: labelCenterX, y: labelY + labelHeight },
              { x: labelX, y: labelCenterY },
              { x: labelX + labelWidth, y: labelCenterY },
            ];

            let minEdgeDist = Infinity;
            let targetX = labelCenterX;
            let targetY = labelCenterY;

            edges.forEach(edge => {
              const distance = Math.sqrt(
                Math.pow(edge.x - closestX, 2) +
                Math.pow(edge.y - closestY, 2)
              );
              if (distance < minEdgeDist) {
                minEdgeDist = distance;
                targetX = edge.x;
                targetY = edge.y;
              }
            });

            ctx.beginPath();
            ctx.moveTo(closestX, closestY);
            ctx.lineTo(targetX, targetY);
            ctx.stroke();
          } else {
            const edges = [
              { x: labelCenterX, y: labelY },
              { x: labelCenterX, y: labelY + labelHeight },
              { x: labelX, y: labelCenterY },
              { x: labelX + labelWidth, y: labelCenterY },
            ];

            let minDistance = Infinity;
            let targetX = labelCenterX;
            let targetY = labelCenterY;

            edges.forEach(edge => {
              const distance = Math.sqrt(
                Math.pow(edge.x - pointX, 2) +
                Math.pow(edge.y - pointY, 2)
              );
              if (distance < minDistance) {
                minDistance = distance;
                targetX = edge.x;
                targetY = edge.y;
              }
            });

            ctx.beginPath();
            ctx.moveTo(pointX, pointY);
            ctx.lineTo(targetX, targetY);
            ctx.stroke();
          }

          ctx.setLineDash([]);
        });

        // Export as PDF
        try {
          exportCanvasToPDF(canvas, `Piano_${plan.floor}_annotato.pdf`);
          alert('✅ Planimetria esportata in PDF');
        } catch (error) {
          console.error('Export PDF error:', error);
          alert('❌ Errore durante l\'esportazione PDF');
        }

        // Clean up
        URL.revokeObjectURL(imageUrl);
      };

      img.src = imageUrl;
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
