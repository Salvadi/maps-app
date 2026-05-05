import { PDFDocument, degrees } from 'pdf-lib';
import { buildFloorPlanVectorPDF } from '../exportUtils';

async function createRotatedPdfBase64(width: number, height: number, rotation: number): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([width, height]);
  page.drawText('test', { x: 20, y: 20 });
  page.setRotation(degrees(rotation));
  const bytes = await doc.save();
  return Buffer.from(bytes).toString('base64');
}

describe('buildFloorPlanVectorPDF', () => {
  test('preserva l\'orientamento orizzontale di un PDF con rotazione nativa 90 gradi', async () => {
    const pdfBlobBase64 = await createRotatedPdfBase64(595, 842, 90);

    const exportedBytes = await buildFloorPlanVectorPDF(
      new Blob(['unused'], { type: 'image/png' }),
      [],
      pdfBlobBase64,
      0,
    );

    const exportedDoc = await PDFDocument.load(exportedBytes);
    const exportedPage = exportedDoc.getPage(0);

    expect(exportedPage.getWidth()).toBeGreaterThan(exportedPage.getHeight());
  });

  test('combina la rotazione nativa del PDF con quella applicata dall\'utente', async () => {
    const pdfBlobBase64 = await createRotatedPdfBase64(595, 842, 90);

    const exportedBytes = await buildFloorPlanVectorPDF(
      new Blob(['unused'], { type: 'image/png' }),
      [],
      pdfBlobBase64,
      90,
    );

    const exportedDoc = await PDFDocument.load(exportedBytes);
    const exportedPage = exportedDoc.getPage(0);

    expect(exportedPage.getHeight()).toBeGreaterThan(exportedPage.getWidth());
  });
});
