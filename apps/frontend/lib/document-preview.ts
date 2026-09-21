// File types the server recognises for uploaded documents. Kept in step with
// apps/backend/src/lib/document-format.ts; the server is the authority and
// re-checks every file by its content, this only helps people pick a valid one.
export const DOCUMENT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.dcm';

export const DOCUMENT_TYPES_HELP = 'PDF, images, Word, Excel, PowerPoint, text/CSV or DICOM - 10 MB max';

/**
 * Opens a document in a new tab. Files are fetched with the caller's token
 * (they are never public links), so the tab is opened first - inside the click,
 * where browsers allow it - and pointed at the downloaded copy afterwards.
 */
export async function openDocumentPreview(downloadUrl: string, token: string | null) {
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('Your browser blocked the new tab. Allow pop-ups for this site, or use Download.');
  try {
    const res = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Unable to open this document.');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    tab.location.href = objectUrl;
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);
  } catch (error) {
    tab.close();
    throw error;
  }
}
