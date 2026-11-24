/**
 * Opens a document Bulamu printed (a medical form, results, a discharge
 * summary...) for reading and printing. Documents are fetched with the
 * person's token - they are never public links - so a tab is opened inside the
 * click (where browsers allow it), and the document shown in it once fetched.
 *
 * The tab holds its own copy of the document for as long as it is open. It used
 * to show a copy borrowed from the page that opened it, which was let go after a
 * minute: the document stayed on screen, but printing or saving it afterwards
 * found it gone ("the discharge form won't print"). The tab is named after the
 * document, and has Print and Download buttons; Download saves it under its
 * own name ("Discharge summary - Ogwal Francis - 2026-11-23.pdf").
 */

const VIEWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp))/i;

/** The file name the server gave a document (Content-Disposition), if any. */
export function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // Fall through to the plain name.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition) ?? /filename=([^;]+)/i.exec(disposition);
  return plain ? plain[1].trim() : null;
}

/** What the tab is titled: the file name without its extension. */
export const titleFrom = (fileName: string) => fileName.replace(/\.[a-z0-9]{2,5}$/i, '');

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || fallback);
}

/** Saves a file under its name, from a copy kept for a minute (an app window can otherwise cancel it). */
function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page the tab shows: the document's name, Print and Download, and the document beneath. */
function showInTab(tab: Window, blob: Blob, fileName: string, isPdf: boolean) {
  const title = titleFrom(fileName);
  const doc = tab.document;
  doc.open();
  doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #e2e8f0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #0f766e; color: #fff; }
  header h1 { flex: 1; min-width: 0; margin: 0; font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header button, header a { font: inherit; font-size: 14px; font-weight: 600; color: #0f766e; background: #fff; border: 0; border-radius: 6px; padding: 6px 14px; cursor: pointer; text-decoration: none; }
  main { position: absolute; inset: 46px 0 0 0; display: flex; justify-content: center; overflow: auto; }
  iframe { width: 100%; height: 100%; border: 0; background: #fff; }
  img { max-width: 100%; margin: 16px auto; box-shadow: 0 1px 6px rgba(0,0,0,.2); background: #fff; }
</style></head><body><header><h1></h1><button type="button" id="print">Print</button><a id="download">Download</a></header><main></main></body></html>`);
  doc.close();
  // A copy of the document that belongs to this tab: it lasts as long as the tab is open.
  const own = new (tab as unknown as typeof globalThis).Blob([blob], { type: blob.type });
  const url = (tab as unknown as typeof globalThis).URL.createObjectURL(own);
  doc.querySelector('h1')!.textContent = title;
  const download = doc.getElementById('download') as HTMLAnchorElement;
  download.href = url;
  download.download = fileName;
  const main = doc.querySelector('main')!;
  if (isPdf) {
    const frame = doc.createElement('iframe');
    frame.title = title;
    frame.src = url;
    main.appendChild(frame);
    doc.getElementById('print')!.addEventListener('click', () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        tab.print();
      }
    });
  } else {
    const img = doc.createElement('img');
    img.alt = title;
    img.src = url;
    main.appendChild(img);
    doc.getElementById('print')!.addEventListener('click', () => tab.print());
  }
}

/**
 * Opens a document for reading and printing. `fallbackName` names it if the
 * server gave no name. A document no browser tab can show (a Word file), or a
 * PDF on a phone that cannot show PDFs, is saved under its name instead.
 */
export async function openDocument(url: string, token: string | null, fallbackName = 'document.pdf') {
  const tab = window.open('', '_blank');
  try {
    if (tab) {
      tab.document.title = 'Opening the document...';
      tab.document.body.style.cssText = 'font-family: system-ui, sans-serif; padding: 24px; color: #334155';
      tab.document.body.textContent = 'Opening the document...';
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw await failure(res, 'The document could not be opened. Please try again.');
    const blob = await res.blob();
    const fileName = fileNameFrom(res.headers.get('Content-Disposition')) ?? fallbackName;
    const isPdf = /pdf/i.test(blob.type) || /\.pdf$/i.test(fileName);
    const pdfShown = typeof navigator === 'undefined' || (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false;
    if (!tab || !VIEWABLE.test(blob.type || (isPdf ? 'application/pdf' : '')) || (isPdf && !pdfShown)) {
      tab?.close();
      saveFile(blob, fileName);
      return;
    }
    showInTab(tab, blob, fileName, isPdf);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
