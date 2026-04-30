import { shouldUseOriginalPdfBackgroundForExport } from '../exportUtils';

describe('shouldUseOriginalPdfBackgroundForExport', () => {
  test('usa il PDF originale solo senza rotazioni', () => {
    expect(shouldUseOriginalPdfBackgroundForExport(0, 0)).toBe(true);
    expect(shouldUseOriginalPdfBackgroundForExport(360, 720)).toBe(true);
  });

  test('disattiva il PDF originale se il sorgente ha una rotazione nativa', () => {
    expect(shouldUseOriginalPdfBackgroundForExport(90, 0)).toBe(false);
    expect(shouldUseOriginalPdfBackgroundForExport(270, 0)).toBe(false);
  });

  test('disattiva il PDF originale se l\'utente ha ruotato la planimetria', () => {
    expect(shouldUseOriginalPdfBackgroundForExport(0, 90)).toBe(false);
    expect(shouldUseOriginalPdfBackgroundForExport(0, 180)).toBe(false);
  });
});
