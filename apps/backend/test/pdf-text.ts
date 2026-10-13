import { inflateSync } from 'zlib';

/**
 * The text drawn on each page of a PDFKit document, for tests. PDFKit writes
 * each page's content as a compressed stream with text as hex strings inside
 * TJ arrays; this decodes just that, which is all the branding checks need.
 */
export function pdfPages(pdf: Buffer | Uint8Array | { type: 'Buffer'; data: number[] }): string[] {
  // Whatever form the bytes arrive in (a Buffer, a Uint8Array, or a Buffer's JSON).
  const raw = Buffer.from(pdf as any).toString('latin1');
  const pages: string[] = [];
  const streams = raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g);
  for (const [, body] of streams) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(body, 'latin1')).toString('latin1');
    } catch {
      continue; // an image or other binary stream
    }
    if (!/\bBT\b/.test(content)) continue;
    const lines: string[] = [];
    for (const [, array] of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      lines.push([...array.matchAll(/<([0-9a-fA-F]*)>/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join(''));
    }
    pages.push(lines.join('\n'));
  }
  return pages;
}

export const pdfText = (pdf: Buffer) => pdfPages(pdf).join('\n');

/** How many images the document draws (a facility logo, the QR code on each page...). */
export const pdfImageCount = (pdf: Buffer) => (Buffer.from(pdf).toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;
