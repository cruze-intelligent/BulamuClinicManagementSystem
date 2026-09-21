import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildTestApp, seedClinic, seedUser, loginAs, authHeader } from './helpers';
import { resetDb } from './db';
import {
  attachmentDisposition,
  describeStoredDocument,
  detectDocumentFormat,
  normalizeFileName,
} from '../src/lib/document-format';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 1)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const DICOM = Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.alloc(16)]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml word/document.xml')]);
const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('[Content_Types].xml xl/workbook.xml')]);
const PLAIN_ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('payload.bin')]);

describe('document format recognition', () => {
  it('recognises formats from the file bytes, whatever the name says', () => {
    expect(detectDocumentFormat(PDF, 'anything')?.label).toBe('PDF document');
    expect(detectDocumentFormat(PNG, 'scan.jpg')?.mimeType).toBe('image/png');
    expect(detectDocumentFormat(JPEG, 'scan.png')?.mimeType).toBe('image/jpeg');
    expect(detectDocumentFormat(DICOM, 'ct.dcm')?.label).toBe('DICOM imaging study');
    expect(detectDocumentFormat(DOCX, 'letter.docx')?.label).toBe('Word document');
    expect(detectDocumentFormat(XLSX, 'labs.xlsx')?.label).toBe('Excel spreadsheet');
  });

  it('accepts plain text and CSV only when named as such', () => {
    expect(detectDocumentFormat(Buffer.from('blood pressure 120/80'), 'note.txt')?.kind).toBe('text');
    expect(detectDocumentFormat(Buffer.from('a,b\n1,2'), 'results.csv')?.mimeType).toBe('text/csv');
    expect(detectDocumentFormat(Buffer.from('blood pressure 120/80'), 'note.exe')).toBeNull();
  });

  it('refuses executables, markup, archives and empty files', () => {
    expect(detectDocumentFormat(EXE, 'setup.exe')).toBeNull();
    expect(detectDocumentFormat(EXE, 'setup.pdf')).toBeNull();
    expect(detectDocumentFormat(HTML, 'page.txt')).toBeNull();
    expect(detectDocumentFormat(HTML, 'page.html')).toBeNull();
    expect(detectDocumentFormat(PLAIN_ZIP, 'bundle.zip')).toBeNull();
    expect(detectDocumentFormat(Buffer.alloc(0), 'empty.pdf')).toBeNull();
  });

  it('corrects the extension to match what the file really is, and cleans the name', () => {
    const png = detectDocumentFormat(PNG, 'scan.jpg')!;
    expect(normalizeFileName('scan.jpg', png)).toBe('scan.png');
    expect(normalizeFileName('scan', png)).toBe('scan.png');
    expect(normalizeFileName('..\\..\\etc\\report.PDF', detectDocumentFormat(PDF, 'x')!)).toBe('report.pdf');
    expect(normalizeFileName('photo.jpeg', detectDocumentFormat(JPEG, 'x')!)).toBe('photo.jpeg');
    expect(normalizeFileName('bad"name\r\n.pdf', detectDocumentFormat(PDF, 'x')!)).toBe('badname.pdf');
  });

  it('describes older rows that were stored with a browser-declared type', () => {
    expect(describeStoredDocument({ mimeType: 'application/octet-stream', fileName: 'result.pdf' }).label).toBe('PDF document');
    expect(describeStoredDocument({ mimeType: 'image/png', fileName: 'x' }).previewable).toBe(true);
    expect(describeStoredDocument({ mimeType: 'application/octet-stream', fileName: 'x.abc' }).label).toBe('ABC file');
    expect(describeStoredDocument({ mimeType: 'application/octet-stream', fileName: 'x' }).kind).toBe('other');
  });

  it('keeps quotes and non-ASCII names safe in the download header', () => {
    const header = attachmentDisposition('Résumé "final".pdf');
    expect(header).toContain('attachment; filename="R_sum_ _final_.pdf"');
    expect(header).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf");
  });
});

function buildMultipart(fields: Record<string, string>, file: { filename: string; content: Buffer; contentType: string }) {
  const boundary = '----docboundary123456';
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
  parts.push(file.content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('document upload routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await resetDb();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function setup() {
    const clinic = await seedClinic();
    const { user, password } = await seedUser({ clinicId: clinic.id, role: 'NURSE' });
    const { token } = await loginAs(app, user.email, password);
    const created = await app.inject({
      method: 'POST', url: '/patients', headers: authHeader(token),
      payload: { name: 'Jane Mukasa', phone: '0756111222', sex: 'FEMALE' },
    });
    return { token, patientId: created.json().patient.id as string };
  }

  const upload = (token: string, patientId: string, file: { filename: string; content: Buffer; contentType: string }) => {
    const { payload, headers } = buildMultipart({ category: 'LAB_RESULT' }, file);
    return app.inject({ method: 'POST', url: `/patients/${patientId}/documents`, headers: { ...authHeader(token), ...headers }, payload });
  };

  it('stores the recognised type, not the declared one, and reports a readable format', async () => {
    const { token, patientId } = await setup();

    const response = await upload(token, patientId, { filename: 'chest-xray.jpg', content: PNG, contentType: 'application/octet-stream' });
    expect(response.statusCode).toBe(200);
    const { document } = response.json();
    expect(document.mimeType).toBe('image/png');
    expect(document.fileName).toBe('chest-xray.png');
    expect(document.format).toEqual({ label: 'PNG image', kind: 'image', previewable: true });

    const list = await app.inject({ method: 'GET', url: `/patients/${patientId}/documents`, headers: authHeader(token) });
    expect(list.json().documents[0].format.label).toBe('PNG image');

    const download = await app.inject({ method: 'GET', url: `/documents/${document.id}/download`, headers: authHeader(token) });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(String(download.headers['content-disposition'])).toContain('chest-xray.png');
  });

  it('refuses a file that is not a recognised document, even if it claims to be a PDF', async () => {
    const { token, patientId } = await setup();

    const response = await upload(token, patientId, { filename: 'invoice.pdf', content: EXE, contentType: 'application/pdf' });
    expect(response.statusCode).toBe(415);
    expect(response.json().error).toMatch(/not supported/i);

    const list = await app.inject({ method: 'GET', url: `/patients/${patientId}/documents`, headers: authHeader(token) });
    expect(list.json().documents).toHaveLength(0);
  });
});
