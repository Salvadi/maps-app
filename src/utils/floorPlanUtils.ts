/**
 * Floor Plan Utilities
 * Handles conversion, processing, and storage of floor plans
 */

import imageCompression from 'browser-image-compression';
import { supabase } from '../lib/supabase';

// PDF.js library will be loaded dynamically
declare const pdfjsLib: any;

/**
 * Convert Blob to Base64 string for storage in IndexedDB
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract base64 part after "data:...;base64,"
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert Base64 string back to Blob
 * Converts a Base64-encoded string back to a Blob object for use in export operations
 */
export function base64ToBlob(base64: string, mimeType: string = 'application/pdf'): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Load PDF.js library dynamically
 */
async function loadPdfJs(): Promise<void> {
  if (typeof pdfjsLib !== 'undefined') {
    return; // Already loaded
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      // Set worker
      (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(script);
  });
}

/**
 * Convert PDF first page to PNG at 2x resolution
 * Also returns the original PDF blob for vector preservation
 */
async function pdfToPng(file: File): Promise<{ png: Blob; pdfBlob: Blob }> {
  await loadPdfJs();

  const arrayBuffer = await file.arrayBuffer();

  // Save the original PDF blob for vector preservation
  const pdfBlob = new Blob([arrayBuffer], { type: 'application/pdf' });

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1); // Get first page

  const viewport = page.getViewport({ scale: 2.0 }); // 2x resolution
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Failed to get canvas context');
  }

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve({ png: blob, pdfBlob });
      } else {
        reject(new Error('Failed to convert canvas to blob'));
      }
    }, 'image/png');
  });
}

/**
 * Convert image to PNG at 2x resolution (if smaller, upscale; if larger, maintain)
 */
async function imageToPng2x(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Set canvas to 2x original size (or maintain if already high res)
      const targetWidth = Math.max(img.width * 2, img.width);
      const targetHeight = Math.max(img.height * 2, img.height);

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      // Draw image scaled to canvas size
      context.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to blob'));
        }
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Generate thumbnail from image blob (512px max dimension)
 */
async function generateThumbnail(blob: Blob): Promise<Blob> {
  const options = {
    maxSizeMB: 0.5,
    maxWidthOrHeight: 512,
    useWebWorker: true,
  };

  try {
    const file = new File([blob], 'thumbnail.png', { type: 'image/png' });
    const compressed = await imageCompression(file, options);
    return compressed;
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    throw error;
  }
}

/**
 * Get image dimensions from blob
 */
async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Process floor plan file (PDF or image) to PNG 2x + thumbnail
 */
export async function processFloorPlan(file: File): Promise<{
  fullRes: Blob;
  thumbnail: Blob;
  width: number;
  height: number;
  originalFormat: string;
  pdfBlob?: Blob; // Original PDF blob if input was PDF (for vector preservation)
}> {
  let fullRes: Blob;
  let pdfBlob: Blob | undefined;
  const originalFormat = file.type.split('/')[1] || file.name.split('.').pop() || 'unknown';

  // Convert to PNG 2x based on file type
  if (file.type === 'application/pdf') {
    const { png, pdfBlob: pdf } = await pdfToPng(file);
    fullRes = png;
    pdfBlob = pdf;
  } else if (file.type.startsWith('image/')) {
    fullRes = await imageToPng2x(file);
  } else {
    throw new Error('Unsupported file format. Please upload PDF or image file.');
  }

  // Generate thumbnail
  const thumbnail = await generateThumbnail(fullRes);

  // Get dimensions
  const { width, height } = await getImageDimensions(fullRes);

  return {
    fullRes,
    thumbnail,
    width,
    height,
    originalFormat,
    pdfBlob,
  };
}

/**
 * Upload floor plan to Supabase Storage
 */
export async function uploadFloorPlan(
  projectId: string,
  floor: string,
  fullRes: Blob,
  thumbnail: Blob,
  userId: string,
  pdfBlob?: Blob // Optional original PDF for vector preservation
): Promise<{ fullResUrl: string; thumbnailUrl: string; pdfUrl?: string }> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const timestamp = Date.now();
  const fullResPath = `${projectId}/${floor}/fullres_${timestamp}.png`;
  const thumbnailPath = `${projectId}/${floor}/thumb_${timestamp}.png`;
  const pdfPath = pdfBlob ? `${projectId}/${floor}/original_${timestamp}.pdf` : undefined;

  // Upload full resolution
  const { error: fullResError } = await supabase.storage
    .from('planimetrie')
    .upload(fullResPath, fullRes, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });

  if (fullResError) {
    throw new Error(`Failed to upload full resolution image: ${fullResError.message}`);
  }

  // Upload thumbnail
  const { error: thumbnailError } = await supabase.storage
    .from('planimetrie')
    .upload(thumbnailPath, thumbnail, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });

  if (thumbnailError) {
    // Clean up full res if thumbnail fails
    await supabase.storage.from('planimetrie').remove([fullResPath]);
    throw new Error(`Failed to upload thumbnail: ${thumbnailError.message}`);
  }

  // Upload original PDF if provided
  let pdfUrl: string | undefined;
  if (pdfBlob && pdfPath) {
    const { error: pdfError } = await supabase.storage
      .from('planimetrie')
      .upload(pdfPath, pdfBlob, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      });

    if (pdfError) {
      console.warn(`Failed to upload original PDF: ${pdfError.message}`);
      // Don't fail the whole upload if PDF fails - still upload the PNG
    } else {
      const { data: pdfUrlData } = supabase.storage
        .from('planimetrie')
        .getPublicUrl(pdfPath);
      pdfUrl = pdfUrlData.publicUrl;
    }
  }

  // Get public URLs
  const { data: fullResUrlData } = supabase.storage
    .from('planimetrie')
    .getPublicUrl(fullResPath);

  const { data: thumbnailUrlData } = supabase.storage
    .from('planimetrie')
    .getPublicUrl(thumbnailPath);

  return {
    fullResUrl: fullResUrlData.publicUrl,
    thumbnailUrl: thumbnailUrlData.publicUrl,
    pdfUrl,
  };
}

/**
 * Delete floor plan from Supabase Storage
 */
export async function deleteFloorPlan(imageUrl: string, thumbnailUrl?: string, pdfUrl?: string): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const paths: string[] = [];

  // Extract path from full URL
  const extractPath = (url: string): string | null => {
    const match = url.match(/planimetrie\/(.+)$/);
    return match ? match[1] : null;
  };

  const fullResPath = extractPath(imageUrl);
  if (fullResPath) {
    paths.push(fullResPath);
  }

  if (thumbnailUrl) {
    const thumbPath = extractPath(thumbnailUrl);
    if (thumbPath) {
      paths.push(thumbPath);
    }
  }

  if (pdfUrl) {
    const pdfPath = extractPath(pdfUrl);
    if (pdfPath) {
      paths.push(pdfPath);
    }
  }

  if (paths.length > 0) {
    const { error } = await supabase.storage
      .from('planimetrie')
      .remove(paths);

    if (error) {
      console.error('Error deleting floor plan from storage:', error);
      throw error;
    }
  }
}

/**
 * Upload standalone map to Supabase Storage
 */
export async function uploadStandaloneMap(
  mapId: string,
  fullRes: Blob,
  thumbnail: Blob,
  userId: string
): Promise<{ fullResUrl: string; thumbnailUrl: string }> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const timestamp = Date.now();
  const fullResPath = `standalone/${userId}/${mapId}/fullres_${timestamp}.png`;
  const thumbnailPath = `standalone/${userId}/${mapId}/thumb_${timestamp}.png`;

  // Upload full resolution
  const { error: fullResError } = await supabase.storage
    .from('planimetrie')
    .upload(fullResPath, fullRes, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });

  if (fullResError) {
    throw new Error(`Failed to upload full resolution image: ${fullResError.message}`);
  }

  // Upload thumbnail
  const { error: thumbnailError } = await supabase.storage
    .from('planimetrie')
    .upload(thumbnailPath, thumbnail, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });

  if (thumbnailError) {
    // Clean up full res if thumbnail fails
    await supabase.storage.from('planimetrie').remove([fullResPath]);
    throw new Error(`Failed to upload thumbnail: ${thumbnailError.message}`);
  }

  // Get public URLs
  const { data: fullResUrlData } = supabase.storage
    .from('planimetrie')
    .getPublicUrl(fullResPath);

  const { data: thumbnailUrlData } = supabase.storage
    .from('planimetrie')
    .getPublicUrl(thumbnailPath);

  return {
    fullResUrl: fullResUrlData.publicUrl,
    thumbnailUrl: thumbnailUrlData.publicUrl,
  };
}

/**
 * Download floor plan image as blob
 */
export async function downloadFloorPlanImage(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error('Failed to download floor plan image');
  }
  return response.blob();
}

/**
 * Export types
 */
export interface FloorPlanData {
  id: string;
  projectId: string;
  floor: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  originalFilename: string;
  originalFormat: string;
  width: number;
  height: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FloorPlanPoint {
  id: string;
  floorPlanId: string;
  mappingEntryId: string;
  pointType: 'parete' | 'solaio' | 'perimetro' | 'generico';
  pointX: number; // Normalized 0-1
  pointY: number; // Normalized 0-1
  labelX: number; // Normalized 0-1
  labelY: number; // Normalized 0-1
  perimeterPoints?: Array<{ x: number; y: number }>; // For 'perimetro' type
  customText?: string; // For 'generico' type
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StandaloneMap {
  id: string;
  userId: string;
  name: string;
  description?: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  originalFilename: string;
  width: number;
  height: number;
  points: Array<Omit<FloorPlanPoint, 'id' | 'floorPlanId' | 'mappingEntryId' | 'createdBy' | 'createdAt' | 'updatedAt'>>;
  gridEnabled: boolean;
  gridConfig: {
    rows: number;
    cols: number;
    offsetX: number;
    offsetY: number;
  };
  createdAt: string;
  updatedAt: string;
}
