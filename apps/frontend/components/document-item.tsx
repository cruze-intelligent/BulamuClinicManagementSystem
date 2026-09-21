import type { ReactNode } from 'react';
import { Eye, File, FileDown, FileImage, FileSpreadsheet, FileText, Presentation, ScanLine, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type DocumentFormat = { label: string; kind: string; previewable: boolean };

const KIND_ICONS = {
  pdf: FileText,
  word: FileText,
  text: FileText,
  image: FileImage,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  dicom: ScanLine,
} as const;

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One uploaded document: an icon and a plain-language type ("PDF document",
 * "PNG image"), so people can tell what a file is before opening it, with a
 * View action for the types a browser can show and Download for all of them.
 */
export function DocumentItem({
  fileName, fileSize, format, detail, busy, onView, onDownload, onDelete,
}: {
  fileName: string;
  fileSize: number;
  format?: DocumentFormat;
  detail: ReactNode;
  busy?: boolean;
  onView: () => void;
  onDownload: () => void;
  onDelete?: () => void;
}) {
  const Icon = KIND_ICONS[format?.kind as keyof typeof KIND_ICONS] ?? File;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="size-5 shrink-0 text-emerald-700 dark:text-emerald-500" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800 dark:text-slate-200">{fileName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {format?.label ?? 'File'} · {formatFileSize(fileSize)} · {detail}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {format?.previewable && (
          <Button size="icon-sm" variant="ghost" disabled={busy} onClick={onView} title="View">
            <Eye className="size-4" aria-hidden="true" />
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={onDownload} title="Download">
          <FileDown className="size-4" aria-hidden="true" />
        </Button>
        {onDelete && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onDelete}
            title="Delete"
            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/50"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
