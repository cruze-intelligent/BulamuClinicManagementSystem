import { FastifyReply } from 'fastify';

/** Escapes one CSV field per RFC 4180: quote it whenever it holds the
 * delimiter, a quote, or a line break, doubling any quotes inside it. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Builds a CSV document (header row + one row per record) from a column list
 * of [header, accessor] pairs, so callers describe *what* to export once and
 * this handles quoting/line endings consistently everywhere it's used. */
export function buildCsv<T>(columns: Array<[header: string, accessor: (row: T) => unknown]>, rows: T[]): string {
  const lines = [columns.map(([header]) => csvCell(header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map(([, accessor]) => csvCell(accessor(row))).join(','));
  }
  // A leading BOM so Excel (still the most common opener) detects UTF-8
  // instead of guessing a local codepage and mangling non-ASCII names.
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Sends a CSV document as a downloadable file attachment. */
export function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  reply.header('X-Content-Type-Options', 'nosniff');
  return reply.send(csv);
}
