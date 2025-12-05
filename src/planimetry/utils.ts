import { MapPoint, MapLine, PointType } from './types';
import { getPointIconSVGString } from './components/PointIcons';

/**
 * Renders the map with all points, lines, and markers onto a canvas and returns a Blob (JPEG).
 */
export const renderMapToBlob = async (
    imageSrc: string,
    points: MapPoint[],
    lines: MapLine[] = [],
    markerScale: number = 1
): Promise<Blob | null> => {
    try {
        const img = new Image();
        img.src = imageSrc;

        // Wait for main image to load
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error("Errore caricamento immagine originale"));
        });

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Impossibile creare contesto canvas");

        // Set canvas to full resolution
        canvas.width = Math.ceil(img.naturalWidth);
        canvas.height = Math.ceil(img.naturalHeight);

        // Fill background with white (Crucial for WebP/Transparent PNGs)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw base plan
        ctx.save();
        ctx.drawImage(img, 0, 0);
        ctx.restore();

        // Calc sizes
        // Using ratio approx 1/45th of width to match screen appearance relative to image size
        const basePixelSize = (canvas.width / 45) * markerScale;

        const badgeSize = basePixelSize * 0.4;
        const fontSize = badgeSize * 0.7;

        // --- DRAW LINES (User Drawn) ---
        // Render these first so markers appear on top
        if (lines && lines.length > 0) {
            ctx.lineCap = 'round';
            for (const line of lines) {
                const sx = (line.startX / 100) * canvas.width;
                const sy = (line.startY / 100) * canvas.height;
                const ex = (line.endX / 100) * canvas.width;
                const ey = (line.endY / 100) * canvas.height;

                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.strokeStyle = line.color;
                ctx.lineWidth = basePixelSize * 0.12; // Slightly thicker than marker leads
                ctx.globalAlpha = 0.8;
                ctx.stroke();
                ctx.globalAlpha = 1.0;
            }
        }

        // Helper to load an image from SVG string
        const loadSvgIcon = (svgString: string): Promise<HTMLImageElement> => {
            return new Promise((resolve, reject) => {
                const iconImg = new Image();
                iconImg.onload = () => resolve(iconImg);
                iconImg.onerror = () => reject(new Error("Errore caricamento icona"));
                iconImg.src = svgString;
            });
        };

        // Preload icons
        const iconCache: Record<string, HTMLImageElement> = {};
        const uniqueTypes = Array.from(new Set(points.map(p => p.type))) as PointType[];

        for (const t of uniqueTypes) {
            try {
                // Using Red-600 (#dc2626) as standard export color
                iconCache[t] = await loadSvgIcon(getPointIconSVGString(t, '#dc2626'));
            } catch (e) {
                console.warn(`Could not load icon for type ${t}`, e);
            }
        }

        // --- DRAW MARKER LEADER LINES ---
        ctx.strokeStyle = '#dc2626'; // Red-600
        ctx.lineWidth = basePixelSize * 0.08;
        ctx.lineCap = 'round';

        for (const point of points) {
             const x = (point.x / 100) * canvas.width;
             const y = (point.y / 100) * canvas.height;

             if (point.targetX !== undefined && point.targetY !== undefined) {
                 // Check if actually different from badge position (with tolerance)
                 if (Math.abs(point.targetX - point.x) > 0.1 || Math.abs(point.targetY - point.y) > 0.1) {
                     const tx = (point.targetX / 100) * canvas.width;
                     const ty = (point.targetY / 100) * canvas.height;

                     // Draw Line
                     ctx.beginPath();
                     ctx.moveTo(tx, ty);
                     ctx.lineTo(x, y);
                     ctx.stroke();

                     // Draw Target Dot
                     ctx.beginPath();
                     ctx.arc(tx, ty, basePixelSize * 0.1, 0, 2 * Math.PI);
                     ctx.fillStyle = '#dc2626';
                     ctx.fill();
                 }
             }
        }

        // --- DRAW MARKERS ---
        for (const point of points) {
            const x = (point.x / 100) * canvas.width;
            const y = (point.y / 100) * canvas.height;

            // Draw White Circle Background
            ctx.beginPath();
            ctx.arc(x, y, basePixelSize / 2, 0, 2 * Math.PI);
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.strokeStyle = '#dc2626';
            ctx.lineWidth = basePixelSize * 0.05;
            ctx.stroke();

            // Draw SVG Icon
            const iconImg = iconCache[point.type];
            if (iconImg) {
                const iconW = basePixelSize * 0.6;
                const iconH = basePixelSize * 0.6;
                ctx.drawImage(iconImg, x - iconW/2, y - iconH/2, iconW, iconH);
            }

            // Draw Badge Circle
            const badgeX = x + basePixelSize/2.8;
            const badgeY = y - basePixelSize/2.8;

            ctx.beginPath();
            ctx.arc(badgeX, badgeY, badgeSize / 2, 0, 2 * Math.PI);
            ctx.fillStyle = '#dc2626';
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = basePixelSize * 0.03;
            ctx.stroke();

            // Draw Number
            ctx.fillStyle = 'white';
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(point.number.toString(), badgeX, badgeY + (fontSize*0.1));
        }

        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                resolve(blob);
            }, 'image/jpeg', 0.9);
        });

    } catch (err) {
        console.error("Error generating map image:", err);
        return null;
    }
};

/**
 * Gets image dimensions from a data URL
 */
export const getImageDimensions = (src: string): Promise<{ w: number, h: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = src;
    });
};

/**
 * Generate a unique ID
 */
export const generateId = (): string => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15);
};
