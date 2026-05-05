import {
  FloorPlan,
  FloorPlanPoint,
  MappingEntry,
  Photo,
  Project,
  ensureFloorPlanAsset,
} from '../db';
import {
  buildFloorPlanVectorPDF,
  exportFloorPlanVectorPDF,
  ExportCartiglioData,
  ExportPoint,
} from './exportUtils';

export interface PreparedFloorPlanExport {
  plan: FloorPlan;
  imageBlob?: Blob;
  pdfBlobBase64?: string;
  rotation: number;
}

export function buildFloorPlanExportCartiglio(project: Project, plan: FloorPlan): ExportCartiglioData | null {
  const savedCartiglio = plan.metadata?.cartiglio;
  if (savedCartiglio?.enabled === false) {
    return null;
  }

  const committenteParts = [project.client.trim() || project.title.trim(), project.address.trim()].filter(Boolean);
  return {
    positionX: savedCartiglio?.positionX ?? 0.03,
    positionY: savedCartiglio?.positionY ?? 0.68,
    scale: savedCartiglio?.scale ?? 1,
    tavola: savedCartiglio?.tavola ?? plan.floor,
    typologyNumbers: [...(project.typologies || [])].map((typology) => typology.number).sort((a, b) => a - b),
    typologyValues: { ...(savedCartiglio?.typologyValues || {}) },
    committente: savedCartiglio?.committente ?? committenteParts.join(' - '),
    locali: savedCartiglio?.locali ?? '',
  };
}

export function buildFloorPlanExportPoints(
  rawPoints: FloorPlanPoint[],
  resolveLabelText: (point: FloorPlanPoint) => string[],
): ExportPoint[] {
  return rawPoints.map((point) => ({
    type: point.pointType,
    pointX: point.pointX,
    pointY: point.pointY,
    labelX: point.labelX,
    labelY: point.labelY,
    labelText: resolveLabelText(point),
    perimeterPoints: point.perimeterPoints,
    labelBackgroundColor: point.metadata?.labelBackgroundColor,
    labelTextColor: point.metadata?.labelTextColor,
    eiRating: point.eiRating,
  }));
}

export async function prepareFloorPlanExport(plan: FloorPlan): Promise<PreparedFloorPlanExport | null> {
  const pdfReadyPlan = await ensureFloorPlanAsset(plan.id, 'pdf');
  const fullReadyPlan = pdfReadyPlan?.imageBlob ? pdfReadyPlan : await ensureFloorPlanAsset(plan.id, 'full');
  const exportReadyPlan = fullReadyPlan || pdfReadyPlan;
  const imageBlob = exportReadyPlan?.imageBlob;
  const pdfBlobBase64 = pdfReadyPlan?.pdfBlobBase64 || exportReadyPlan?.pdfBlobBase64;

  if (!exportReadyPlan || (!imageBlob && !pdfBlobBase64)) {
    return null;
  }

  return {
    plan: exportReadyPlan,
    imageBlob,
    pdfBlobBase64,
    rotation: exportReadyPlan.metadata?.rotation || 0,
  };
}

export async function buildPreparedFloorPlanPdf(
  prepared: PreparedFloorPlanExport,
  points: ExportPoint[],
  project: Project,
  sourcePlan: FloorPlan,
): Promise<Uint8Array> {
  return buildFloorPlanVectorPDF(
    prepared.imageBlob || new Blob([], { type: 'image/png' }),
    points,
    prepared.pdfBlobBase64,
    prepared.rotation,
    undefined,
    buildFloorPlanExportCartiglio(project, sourcePlan),
  );
}

export async function exportPreparedFloorPlanPdf(
  prepared: PreparedFloorPlanExport,
  points: ExportPoint[],
  filename: string,
  project: Project,
  sourcePlan: FloorPlan,
): Promise<void> {
  await exportFloorPlanVectorPDF(
    prepared.imageBlob || new Blob([], { type: 'image/png' }),
    points,
    filename,
    prepared.pdfBlobBase64,
    prepared.rotation,
    undefined,
    buildFloorPlanExportCartiglio(project, sourcePlan),
  );
}

export function buildFloorPlanLabelResolver(
  mappings: MappingEntry[],
  mappingPhotos: Record<string, Photo[]>,
  generateMappingLabel: (mapping: MappingEntry, photoCount: number) => string[],
  fallbackLabel: string[] = ['Punto'],
): (point: FloorPlanPoint) => string[] {
  return (point: FloorPlanPoint) => {
    if (point.metadata?.labelText) {
      return point.metadata.labelText;
    }

    const mappingEntry = mappings.find((mapping) => mapping.id === point.mappingEntryId);
    if (!mappingEntry) {
      return fallbackLabel;
    }

    const photos = mappingPhotos[mappingEntry.id] || [];
    return generateMappingLabel(mappingEntry, photos.length);
  };
}
