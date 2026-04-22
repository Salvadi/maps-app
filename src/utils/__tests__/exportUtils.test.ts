import { PDFDocument } from 'pdf-lib';
import { buildFloorPlanVectorPDF } from '../exportUtils';

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0VcAAAAASUVORK5CYII=';

test('buildFloorPlanVectorPDF aggiunge cartiglio compilabile e allunga la pagina', async () => {
  const pngBytes = Uint8Array.from(Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));
  const imageBlob = new Blob([pngBytes], { type: 'image/png' }) as Blob & {
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
  imageBlob.arrayBuffer = async () => pngBytes.buffer.slice(
    pngBytes.byteOffset,
    pngBytes.byteOffset + pngBytes.byteLength,
  );

  const pdfBytes = await buildFloorPlanVectorPDF(
    imageBlob,
    [],
    undefined,
    0,
    null,
    {
      tavola: '0',
      typologyNumbers: Array.from({ length: 20 }, (_, index) => index + 1),
      committente: 'Cliente Test',
      locali: '',
    },
  );

  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPage(0);

  expect(page.getHeight()).toBeGreaterThan(841.89);
  expect(pdfDoc.getForm().getFields()).toHaveLength(24);
});
