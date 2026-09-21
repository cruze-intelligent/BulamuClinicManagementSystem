import path from 'node:path';

/**
 * Recognises what an uploaded document actually is.
 *
 * The browser-declared MIME type and the file extension are supplied by the
 * uploader and can be wrong or hostile, so the type is decided from the file's
 * own leading bytes ("magic numbers"). Anything that is not a recognised
 * clinical-document format is refused, which keeps executables, scripts, HTML
 * and SVG (all able to run code when opened) out of a patient's record.
 */

export type DocumentKind = 'pdf' | 'image' | 'word' | 'spreadsheet' | 'presentation' | 'text' | 'dicom' | 'other';

export interface DocumentFormat {
  mimeType: string;
  extension: string; // with leading dot, lower case
  label: string;
  kind: DocumentKind;
  /** Can a browser show it inline (a new tab) without extra software? */
  previewable: boolean;
}

const FORMATS = {
  pdf: { mimeType: 'application/pdf', extension: '.pdf', label: 'PDF document', kind: 'pdf', previewable: true },
  jpeg: { mimeType: 'image/jpeg', extension: '.jpg', label: 'JPEG image', kind: 'image', previewable: true },
  png: { mimeType: 'image/png', extension: '.png', label: 'PNG image', kind: 'image', previewable: true },
  gif: { mimeType: 'image/gif', extension: '.gif', label: 'GIF image', kind: 'image', previewable: true },
  webp: { mimeType: 'image/webp', extension: '.webp', label: 'WebP image', kind: 'image', previewable: true },
  heic: { mimeType: 'image/heic', extension: '.heic', label: 'HEIC photo', kind: 'image', previewable: false },
  tiff: { mimeType: 'image/tiff', extension: '.tif', label: 'TIFF image', kind: 'image', previewable: false },
  dicom: { mimeType: 'application/dicom', extension: '.dcm', label: 'DICOM imaging study', kind: 'dicom', previewable: false },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx', label: 'Word document', kind: 'word', previewable: false },
  doc: { mimeType: 'application/msword', extension: '.doc', label: 'Word document', kind: 'word', previewable: false },
  xlsx: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: '.xlsx', label: 'Excel spreadsheet', kind: 'spreadsheet', previewable: false },
  xls: { mimeType: 'application/vnd.ms-excel', extension: '.xls', label: 'Excel spreadsheet', kind: 'spreadsheet', previewable: false },
  pptx: { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extension: '.pptx', label: 'PowerPoint presentation', kind: 'presentation', previewable: false },
  ppt: { mimeType: 'application/vnd.ms-powerpoint', extension: '.ppt', label: 'PowerPoint presentation', kind: 'presentation', previewable: false },
  csv: { mimeType: 'text/csv', extension: '.csv', label: 'CSV spreadsheet', kind: 'spreadsheet', previewable: false },
  txt: { mimeType: 'text/plain', extension: '.txt', label: 'Text file', kind: 'text', previewable: false },
} as const satisfies Record<string, DocumentFormat>;

type FormatKey = keyof typeof FORMATS;

/** Human description shown when the uploaded format is refused. */
export const SUPPORTED_FORMATS_MESSAGE =
  'This file type is not supported. Upload a PDF, an image (JPEG, PNG, WebP, HEIC, TIFF), a Word, Excel or PowerPoint file, a text or CSV file, or a DICOM imaging study.';

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString('latin1');

// Files extension-only formats sharing a container signature.
const OLE_HEADER = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'heif'];

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
  } catch {
    // A multi-byte character can be cut at the end of the sample; tolerate that.
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, sample.length - 3));
    } catch {
      return false;
    }
  }
  return true;
}

function detectKey(buf: Buffer, fileName: string): FormatKey | null {
  const ext = path.extname(fileName).toLowerCase();

  if (buf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return 'pdf';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(buf, 0, 4) === 'GIF8') return 'gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
  if (startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  if (ascii(buf, 4, 8) === 'ftyp' && HEIF_BRANDS.includes(ascii(buf, 8, 12))) return 'heic';
  if (ascii(buf, 128, 132) === 'DICM') return 'dicom';

  // Office Open XML files are ZIP archives; the entry names say which kind.
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) && buf.includes(Buffer.from('[Content_Types].xml'))) {
    if (buf.includes(Buffer.from('word/'))) return 'docx';
    if (buf.includes(Buffer.from('xl/'))) return 'xlsx';
    if (buf.includes(Buffer.from('ppt/'))) return 'pptx';
    return null;
  }

  // Legacy Office files share one container; only the extension tells them apart.
  if (startsWith(buf, OLE_HEADER)) {
    if (ext === '.doc') return 'doc';
    if (ext === '.xls') return 'xls';
    if (ext === '.ppt') return 'ppt';
    return null;
  }

  // Plain text is only accepted when the name says text, and never markup.
  if ((ext === '.txt' || ext === '.csv') && looksLikeText(buf)) {
    const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
    if (head.startsWith('<') || head.startsWith('#!')) return null;
    return ext === '.csv' ? 'csv' : 'txt';
  }

  return null;
}

/** The recognised format of a file's bytes, or null when it is not one we accept. */
export function detectDocumentFormat(buffer: Buffer, fileName: string): DocumentFormat | null {
  if (buffer.length === 0) return null;
  const key = detectKey(buffer, fileName);
  return key ? { ...FORMATS[key] } : null;
}

const EXTENSION_TO_KEY: Record<string, FormatKey> = {
  '.pdf': 'pdf', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.gif': 'gif', '.webp': 'webp',
  '.heic': 'heic', '.heif': 'heic', '.tif': 'tiff', '.tiff': 'tiff', '.dcm': 'dicom',
  '.docx': 'docx', '.doc': 'doc', '.xlsx': 'xlsx', '.xls': 'xls', '.pptx': 'pptx', '.ppt': 'ppt',
  '.csv': 'csv', '.txt': 'txt',
};

const MIME_TO_KEY: Record<string, FormatKey> = Object.fromEntries(
  (Object.keys(FORMATS) as FormatKey[]).map((key) => [FORMATS[key].mimeType, key])
);

/**
 * Describes a document that is already stored. Older rows were saved with the
 * browser-declared type, so this falls back from the stored MIME type to the
 * file extension rather than assuming the stored value is trustworthy.
 */
export function describeStoredDocument(doc: { mimeType: string; fileName: string }): Pick<DocumentFormat, 'label' | 'kind' | 'previewable'> {
  const key = MIME_TO_KEY[doc.mimeType.toLowerCase()] ?? EXTENSION_TO_KEY[path.extname(doc.fileName).toLowerCase()];
  if (key) {
    const { label, kind, previewable } = FORMATS[key];
    return { label, kind, previewable };
  }
  const ext = path.extname(doc.fileName).replace('.', '').toUpperCase();
  return { label: ext ? `${ext} file` : 'File', kind: 'other', previewable: false };
}

/** Adds the readable `format` block the screens display to a document row. */
export function withFormat<T extends { mimeType: string; fileName: string }>(doc: T) {
  return { ...doc, format: describeStoredDocument(doc) };
}

/**
 * A file name that is safe to store and to put in a header: no directories,
 * no control characters, bounded length, and an extension that matches what
 * the file really is (a PNG uploaded as "scan.jpg" is saved as "scan.png").
 */
export function normalizeFileName(rawName: string, format: DocumentFormat): string {
  const base = path.basename((rawName || '').replace(/\\/g, '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim();
  const currentExt = path.extname(base).toLowerCase();
  const stem = (currentExt ? base.slice(0, -currentExt.length) : base).slice(0, 120).trim() || 'document';
  const sameFamily = EXTENSION_TO_KEY[currentExt] !== undefined && FORMATS[EXTENSION_TO_KEY[currentExt]].mimeType === format.mimeType;
  return `${stem}${sameFamily ? currentExt : format.extension}`;
}

/** Headers for serving a stored file: right type, always a download, never sniffed. */
export function setDownloadHeaders(reply: { header(name: string, value: string): unknown }, doc: { mimeType: string; fileName: string }) {
  reply.header('Content-Type', doc.mimeType);
  reply.header('Content-Disposition', attachmentDisposition(doc.fileName));
  reply.header('X-Content-Type-Options', 'nosniff');
}

/** Content-Disposition value that survives quotes, commas and non-ASCII names. */
export function attachmentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
