// File types the server recognises for uploaded documents. Kept in step with
// apps/backend/src/lib/document-format.ts; the server is the authority and
// re-checks every file by its content, this only helps people pick a valid one.
import { openDocument } from './open-document';

export const DOCUMENT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.dcm';

export const DOCUMENT_TYPES_HELP = 'PDF, images, Word, Excel, PowerPoint, text/CSV or DICOM - 10 MB max';

/** The server's own explanation of a failed download (a lost file says so), or a plain fallback. */
export async function downloadError(res: Response): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || 'Unable to open this document.');
}

/** Opens a document (one Bulamu printed, or one uploaded) for reading and printing - see lib/open-document. */
export async function openDocumentPreview(downloadUrl: string, token: string | null) {
  return openDocument(downloadUrl, token);
}
