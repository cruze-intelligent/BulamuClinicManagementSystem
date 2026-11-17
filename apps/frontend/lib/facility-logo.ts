'use client';

import { useEffect, useState } from 'react';

/**
 * The facility's logo: made ready for upload on this device (any photo or
 * image the browser can open - resized and compressed to well under the
 * 500 KB the server accepts, as a PNG or JPEG documents can carry), and kept on
 * the device once seen, so the sidebar shows it offline too.
 */

/** The longest side a logo needs: it prints at about 3 cm wide and shows at 40 px in the app. */
export const LOGO_MAX_SIDE = 600;
/** What an optimised logo should stay under - the server's limit is 500 KB. */
export const LOGO_TARGET_BYTES = 300 * 1024;

/** The size to draw an image at so its longest side is at most `max`, keeping its shape. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Bytes in a base64 data URL. */
export const dataUrlBytes = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new Error("This image can't be opened on this device. Save it as a PNG or JPEG and try again.");
  } finally {
    // The decoded image stays usable after the object URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** True when any pixel is see-through - then the logo stays a PNG so its background stays clear. */
function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

/**
 * Turns any image the browser can open (a phone photo, a WebP, a large PNG)
 * into a logo ready to upload: at most 600 px on its longest side, and a PNG
 * (where it has a see-through background) or a JPEG, under about 300 KB.
 */
export async function optimiseLogo(file: File): Promise<{ dataUrl: string; bytes: number; width: number; height: number }> {
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|svg|heic|heif)$/i.test(file.name)) {
    throw new Error('Choose an image file (a PNG, JPEG or photo).');
  }
  const image = await loadImage(file);
  let max = LOGO_MAX_SIDE;
  let best: { dataUrl: string; bytes: number; width: number; height: number } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { width, height } = fitWithin(image.naturalWidth || image.width, image.naturalHeight || image.height, max);
    if (!width || !height) throw new Error('This image is empty - choose another.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error("This device can't prepare the image - try a smaller PNG or JPEG.");
    context.drawImage(image, 0, 0, width, height);
    const transparent = hasTransparency(context, width, height);
    if (!transparent) {
      // A JPEG has no see-through parts: paint white behind, as the document header shows it.
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    const dataUrl = transparent ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', attempt === 0 ? 0.9 : 0.8);
    best = { dataUrl, bytes: dataUrlBytes(dataUrl), width, height };
    if (best.bytes <= LOGO_TARGET_BYTES) return best;
    max = Math.round(max * 0.75);
  }
  return best!;
}

// --- Keeping the logo on this device ------------------------------------------

const API = process.env.NEXT_PUBLIC_API_URL;
const cacheKey = (clinicId: string) => `facilityLogo_${clinicId}`;
const checkedKey = (clinicId: string) => `facilityLogoChecked_${clinicId}`;
const EVENT = 'bulamu:facility-logo';

function cached(clinicId: string): string | null {
  try {
    return localStorage.getItem(cacheKey(clinicId));
  } catch {
    return null;
  }
}

/** Keeps (or forgets) the logo on this device and tells anything showing it. */
export function rememberFacilityLogo(clinicId: string, dataUrl: string | null) {
  try {
    if (dataUrl) localStorage.setItem(cacheKey(clinicId), dataUrl);
    else localStorage.removeItem(cacheKey(clinicId));
    sessionStorage.setItem(checkedKey(clinicId), '1');
  } catch {
    // Storage full or blocked: it is fetched again next time.
  }
  window.dispatchEvent(new Event(EVENT));
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** The facility's logo as an image address, or null when it has none - checked with the server once a session. */
export function useFacilityLogo(clinicId: string | null | undefined): string | null {
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    if (!clinicId) return;
    const show = () => setLogo(cached(clinicId));
    show();
    window.addEventListener(EVENT, show);

    let checked = false;
    try {
      checked = sessionStorage.getItem(checkedKey(clinicId)) === '1';
    } catch {
      // Without session storage it is simply checked again.
    }
    if (!checked && navigator.onLine) {
      fetch(`${API}/clinics/${clinicId}/logo`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
        .then(async (res) => {
          if (res.status === 404) return rememberFacilityLogo(clinicId, null);
          if (res.ok) rememberFacilityLogo(clinicId, await blobToDataUrl(await res.blob()));
        })
        .catch(() => {
          // Offline or unreachable: the copy on this device is shown.
        });
    }
    return () => window.removeEventListener(EVENT, show);
  }, [clinicId]);

  return logo;
}
