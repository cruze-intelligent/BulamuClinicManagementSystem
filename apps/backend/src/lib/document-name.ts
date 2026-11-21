/**
 * How a document is named: what it is, whose it is, and its date - on the PDF
 * itself (the title a browser shows on its tab, in place of a random address)
 * and on the file it saves as. "Medical form - Ogwal Francis - 21 Nov 2026".
 */

const KAMPALA = 'Africa/Kampala';

const day = (date: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: KAMPALA, day: 'numeric', month: 'short', year: 'numeric' }).format(date);
// 2026-11-21: sorts by date in a folder.
const dayKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: KAMPALA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** "Medical form - Ogwal Francis - 21 Nov 2026" (who and when only when known). */
export function documentTitle(kind: string, who?: string | null, date?: Date | null): string {
  return [kind, who ? clean(who) : '', date ? day(date) : ''].filter(Boolean).join(' - ');
}

/** "Medical form - Ogwal Francis - 2026-11-21.pdf": the same, safe as a file name on any computer. */
export function documentFileName(kind: string, who?: string | null, date?: Date | null, extension = 'pdf'): string {
  const name = [kind, who ? clean(who) : '', date ? dayKey(date) : ''].filter(Boolean).join(' - ')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').slice(0, 150).trim() || 'document';
  return `${name}.${extension}`;
}

/** Content-Disposition for a document opened in the browser, named, surviving any characters in the name. */
export function inlineDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
