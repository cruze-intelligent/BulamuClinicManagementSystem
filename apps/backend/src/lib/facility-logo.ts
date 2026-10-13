import PDFDocument from 'pdfkit';
import { prisma } from './prisma';

export const MAX_LOGO_BYTES = 500 * 1024;

/** The facility's logo for its documents, or null if it hasn't added one. Never throws. */
export async function facilityLogo(clinicId: string): Promise<Buffer | null> {
  try {
    const logo = await prisma.clinicLogo.findUnique({ where: { clinicId }, select: { data: true } });
    return logo ? Buffer.from(logo.data) : null;
  } catch {
    return null;
  }
}

/**
 * Checks an uploaded logo: a PNG or JPEG (what PDF documents can carry), not
 * too large, and one the PDF library can actually draw. Accepts a data URL or
 * plain base64.
 */
export function parseLogo(input: unknown): { data: Buffer; mimeType: string } | { error: string } {
  if (typeof input !== 'string' || !input) return { error: 'Choose an image to upload' };
  const base64 = input.replace(/^data:[^;]+;base64,/, '');
  const data = Buffer.from(base64, 'base64');
  if (data.length === 0) return { error: 'The image could not be read' };
  if (data.length > MAX_LOGO_BYTES) return { error: 'The logo must be smaller than 500 KB' };

  const isPng = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (!isPng && !isJpeg) return { error: 'The logo must be a PNG or JPEG image' };

  try {
    // openImage is part of PDFKit but missing from its type definitions.
    (new PDFDocument({ autoFirstPage: false }) as unknown as { openImage(src: Buffer): unknown }).openImage(data);
  } catch {
    return { error: 'This image could not be used - try saving it again as a PNG or JPEG' };
  }
  return { data, mimeType: isPng ? 'image/png' : 'image/jpeg' };
}
