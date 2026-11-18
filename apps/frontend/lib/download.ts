// Downloads use fetch + a Bearer header rather than a plain <a href> because
// every export route is authenticated - a bare link can't carry the token, so
// each caller borrowed this dance already (patients/view, billing). This is
// that pattern in one place so new export buttons don't repeat it.
/**
 * Opens an authenticated PDF (referral letter, discharge summary...) in a new
 * tab for printing. The tab is opened straight away, inside the click, so the
 * browser doesn't block it as a pop-up; the document is loaded into it once
 * fetched. If tabs are blocked anyway, the file is downloaded instead.
 */
export async function openPdfWithAuth(url: string, token: string | null, filename: string) {
  const tab = window.open('', '_blank');
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || 'Could not open the document');
    }
    const objectUrl = URL.createObjectURL(await res.blob());
    if (tab) {
      tab.location.href = objectUrl;
    } else {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}

/**
 * Downloads an authenticated file. Reports are also emailed by the server to
 * whoever generated them: the address comes back, so the page can say so.
 * The file is released only after a minute - an installed app window can
 * otherwise cancel the download before it starts.
 */
export async function downloadWithAuth(url: string, token: string | null, filename: string): Promise<{ emailedTo: string | null }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || 'Download failed');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return { emailedTo: res.headers.get('X-Report-Emailed-To') };
}

/** What to tell someone once a report is ready. */
export const reportReadyMessage = (what: string, emailedTo: string | null) =>
  emailedTo ? `${what} downloaded - a copy has also been emailed to ${emailedTo}.` : `${what} downloaded.`;
