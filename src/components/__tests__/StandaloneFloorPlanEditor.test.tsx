import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import StandaloneFloorPlanEditor from '../StandaloneFloorPlanEditor';

const mockProcessFloorPlan = jest.fn();
const mockBlobToBase64 = jest.fn();
const mockCreateStandaloneMap = jest.fn();
const mockUpdateStandaloneMap = jest.fn();
const mockDeleteStandaloneMap = jest.fn();
const mockGetStandaloneMaps = jest.fn();
const mockGetFloorPlanBlobUrl = jest.fn();
const mockRevokeFloorPlanBlobUrl = jest.fn();
const mockExportFloorPlanVectorPDF = jest.fn();

let mockEditorPoints: any[] = [];
let mockEditorGridConfig: any = {};
let mockEditorLegendPosition: { x: number; y: number } | null = null;
let mockEditorRotation = 0;

const mockFloorPlanEditor = jest.fn((props: any) => (
  <div data-testid="mock-floorplan-editor">
    <div data-testid="editor-props">{JSON.stringify({
      initialPoints: props.initialPoints,
      initialGridConfig: props.initialGridConfig,
      initialRotation: props.initialRotation,
    })}</div>
    <button onClick={() => props.onSave?.(mockEditorPoints, mockEditorGridConfig)}>salva-locale</button>
    <button onClick={() => props.onSaveFile?.(mockEditorPoints, mockEditorGridConfig)}>salva-db</button>
    <button onClick={() => props.onOpenFile?.()}>apri-db</button>
    <button onClick={() => props.onRotationChange?.(mockEditorRotation)}>ruota</button>
    <button onClick={() => props.onExportPDF?.({
      points: mockEditorPoints,
      eiLegendPosition: mockEditorLegendPosition,
    })}>export-pdf</button>
  </div>
));

jest.mock('../FloorPlanEditor', () => ({
  __esModule: true,
  default: (props: any) => mockFloorPlanEditor(props),
}));

jest.mock('../../db', () => ({
  createStandaloneMap: (...args: any[]) => mockCreateStandaloneMap(...args),
  updateStandaloneMap: (...args: any[]) => mockUpdateStandaloneMap(...args),
  deleteStandaloneMap: (...args: any[]) => mockDeleteStandaloneMap(...args),
  getStandaloneMaps: (...args: any[]) => mockGetStandaloneMaps(...args),
  getFloorPlanBlobUrl: (...args: any[]) => mockGetFloorPlanBlobUrl(...args),
  revokeFloorPlanBlobUrl: (...args: any[]) => mockRevokeFloorPlanBlobUrl(...args),
}));

jest.mock('../../utils/floorPlanUtils', () => ({
  processFloorPlan: (...args: any[]) => mockProcessFloorPlan(...args),
  blobToBase64: (...args: any[]) => mockBlobToBase64(...args),
}));

jest.mock('../../utils/exportUtils', () => ({
  exportFloorPlanVectorPDF: (...args: any[]) => mockExportFloorPlanVectorPDF(...args),
}));

const currentUser = {
  id: 'user-1',
  email: 'user@example.com',
  username: 'utente',
  role: 'user',
} as any;

const samplePoint = {
  id: 'point-1',
  type: 'generico',
  pointX: 0.12,
  pointY: 0.34,
  labelX: 0.56,
  labelY: 0.78,
  labelText: ['Varco', 'EI 120'],
  customText: 'Varco',
  labelBackgroundColor: '#112233',
  labelTextColor: '#fefefe',
  eiRating: 120,
  perimeterPoints: [{ x: 0.1, y: 0.2 }],
};

const sampleGridConfig = {
  enabled: true,
  rows: 7,
  cols: 9,
  offsetX: 0.02,
  offsetY: 0.03,
};

const createProcessedFloorPlan = (overrides?: Partial<any>) => ({
  fullRes: new Blob(['full-res'], { type: 'image/png' }),
  thumbnail: new Blob(['thumb'], { type: 'image/png' }),
  width: 1200,
  height: 800,
  originalFormat: 'pdf',
  pdfBlob: new Blob(['pdf'], { type: 'application/pdf' }),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEditorPoints = [samplePoint];
  mockEditorGridConfig = sampleGridConfig;
  mockEditorLegendPosition = { x: 0.22, y: 0.11 };
  mockEditorRotation = 90;

  Object.defineProperty(window, 'confirm', {
    writable: true,
    value: jest.fn(() => true),
  });

  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: jest.fn(() => 'blob:preview'),
  });

  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    value: jest.fn(),
  });

  mockGetFloorPlanBlobUrl.mockImplementation(() => 'blob:loaded-map');
});

test('salva mappa standalone preservando labelText, colori, eiRating, gridConfig e rotation', async () => {
  const processed = createProcessedFloorPlan();
  const file = new File(['pdf-content'], 'standalone.pdf', { type: 'application/pdf' });

  mockProcessFloorPlan.mockResolvedValue(processed);
  mockBlobToBase64.mockResolvedValue('pdf-base64');
  mockCreateStandaloneMap.mockResolvedValue({
    id: 'map-1',
    userId: currentUser.id,
    name: 'Mappa prova',
    imageBlob: processed.fullRes,
    thumbnailBlob: processed.thumbnail,
    pdfBlobBase64: 'pdf-base64',
    pdfUrl: 'https://example.com/map-1/original.pdf',
    originalFilename: file.name,
    originalFormat: 'pdf',
    width: processed.width,
    height: processed.height,
    points: [],
    gridEnabled: false,
    gridConfig: { rows: 10, cols: 10, offsetX: 0, offsetY: 0 },
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
    synced: 0,
  });
  mockUpdateStandaloneMap.mockResolvedValue(undefined);

  const { container } = render(
    <StandaloneFloorPlanEditor currentUser={currentUser} onBack={jest.fn()} />
  );

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(mockFloorPlanEditor).toHaveBeenCalled());

  const editorProps = mockFloorPlanEditor.mock.calls[mockFloorPlanEditor.mock.calls.length - 1][0];
  await act(async () => {
    editorProps.onRotationChange?.(mockEditorRotation);
    editorProps.onSaveFile?.(mockEditorPoints, mockEditorGridConfig);
  });

  const dialogInput = await screen.findByPlaceholderText('Nome progetto...');
  fireEvent.change(dialogInput, { target: { value: 'Mappa prova' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salva' }));

  await waitFor(() => expect(mockCreateStandaloneMap).toHaveBeenCalled());
  await waitFor(() => expect(mockUpdateStandaloneMap).toHaveBeenLastCalledWith(
    'map-1',
    expect.objectContaining({
      points: [
        expect.objectContaining({
          id: 'point-1',
          pointType: 'generico',
          customText: 'Varco',
          labelText: ['Varco', 'EI 120'],
          labelBackgroundColor: '#112233',
          labelTextColor: '#fefefe',
          eiRating: 120,
        }),
      ],
      gridEnabled: true,
      gridConfig: {
        rows: 7,
        cols: 9,
        offsetX: 0.02,
        offsetY: 0.03,
      },
      metadata: expect.objectContaining({ rotation: 90 }),
    }),
  ));
});

test('carica mappa standalone ricostruendo punti, griglia e rotation', async () => {
  const loadedMap = {
    id: 'map-loaded',
    userId: currentUser.id,
    name: 'Mappa caricata',
    imageBlob: new Blob(['loaded'], { type: 'image/png' }),
    thumbnailBlob: new Blob(['loaded-thumb'], { type: 'image/png' }),
    pdfBlobBase64: 'loaded-pdf-base64',
    pdfUrl: 'https://example.com/map-loaded/original.pdf',
    imageUrl: 'https://example.com/map-loaded/full.png',
    thumbnailUrl: 'https://example.com/map-loaded/thumb.png',
    originalFilename: 'mappa.pdf',
    originalFormat: 'pdf',
    width: 1000,
    height: 700,
    points: [{
      id: 'saved-point',
      pointType: 'generico',
      pointX: 0.2,
      pointY: 0.3,
      labelX: 0.4,
      labelY: 0.5,
      customText: 'Porta REI',
      labelText: ['Porta REI', 'EI 120'],
      labelBackgroundColor: '#abcdef',
      labelTextColor: '#123456',
      eiRating: 120,
      perimeterPoints: [{ x: 0.2, y: 0.3 }],
    }],
    gridEnabled: true,
    gridConfig: sampleGridConfig,
    metadata: { rotation: 180 },
    createdAt: 1,
    updatedAt: 2,
    synced: 1,
  };

  mockGetStandaloneMaps.mockResolvedValue([loadedMap]);

  render(<StandaloneFloorPlanEditor currentUser={currentUser} onBack={jest.fn()} />);

  fireEvent.click(screen.getByText('Apri da Database'));
  fireEvent.click(await screen.findByRole('button', { name: 'Apri' }));

  await waitFor(() => {
    const lastCall = mockFloorPlanEditor.mock.calls[mockFloorPlanEditor.mock.calls.length - 1]?.[0];
    expect(lastCall.initialRotation).toBe(180);
    expect(lastCall.initialGridConfig).toEqual(sampleGridConfig);
    expect(lastCall.initialPoints).toEqual([
      expect.objectContaining({
        id: 'saved-point',
        labelText: ['Porta REI', 'EI 120'],
        labelBackgroundColor: '#abcdef',
        labelTextColor: '#123456',
        eiRating: 120,
      }),
    ]);
  });
});

test('export standalone usa il PDF originale quando pdfBlobBase64 e disponibile', async () => {
  const processed = createProcessedFloorPlan();
  const file = new File(['pdf-content'], 'standalone.pdf', { type: 'application/pdf' });

  mockProcessFloorPlan.mockResolvedValue(processed);
  mockBlobToBase64.mockResolvedValue('pdf-base64');

  const { container } = render(
    <StandaloneFloorPlanEditor currentUser={currentUser} onBack={jest.fn()} />
  );

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(mockFloorPlanEditor).toHaveBeenCalled());

  const editorProps = mockFloorPlanEditor.mock.calls[mockFloorPlanEditor.mock.calls.length - 1][0];
  await act(async () => {
    editorProps.onRotationChange?.(mockEditorRotation);
  });

  await waitFor(() => {
    const latestProps = mockFloorPlanEditor.mock.calls[mockFloorPlanEditor.mock.calls.length - 1][0];
    expect(latestProps.initialRotation).toBe(90);
  });

  const latestProps = mockFloorPlanEditor.mock.calls[mockFloorPlanEditor.mock.calls.length - 1][0];
  await act(async () => {
    await latestProps.onExportPDF?.({
      points: mockEditorPoints,
      eiLegendPosition: mockEditorLegendPosition,
    });
  });

  await waitFor(() => expect(mockExportFloorPlanVectorPDF).toHaveBeenCalledWith(
    processed.fullRes,
    [
      expect.objectContaining({
        type: 'generico',
        labelText: ['Varco', 'EI 120'],
        labelBackgroundColor: '#112233',
        labelTextColor: '#fefefe',
        eiRating: 120,
      }),
    ],
    'planimetria.pdf',
    'pdf-base64',
    90,
    { x: 0.22, y: 0.11 },
    {
      tavola: '',
      typologyNumbers: [],
      committente: '',
      locali: '',
    },
  ));
});

test('export standalone senza pdfBlobBase64 passa undefined e usa il fallback raster condiviso', async () => {
  const processed = createProcessedFloorPlan({
    originalFormat: 'png',
    pdfBlob: undefined,
  });
  const file = new File(['img-content'], 'standalone.png', { type: 'image/png' });

  mockEditorRotation = 0;
  mockProcessFloorPlan.mockResolvedValue(processed);

  const { container } = render(
    <StandaloneFloorPlanEditor currentUser={currentUser} onBack={jest.fn()} />
  );

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(mockFloorPlanEditor).toHaveBeenCalled());

  const editorProps = mockFloorPlanEditor.mock.calls[mockFloorPlanEditor.mock.calls.length - 1][0];
  await act(async () => {
    await editorProps.onExportPDF?.({
      points: mockEditorPoints,
      eiLegendPosition: mockEditorLegendPosition,
    });
  });

  await waitFor(() => expect(mockExportFloorPlanVectorPDF).toHaveBeenCalledWith(
    processed.fullRes,
    [expect.objectContaining({ type: 'generico' })],
    'planimetria.pdf',
    undefined,
    0,
    { x: 0.22, y: 0.11 },
    {
      tavola: '',
      typologyNumbers: [],
      committente: '',
      locali: '',
    },
  ));
});
