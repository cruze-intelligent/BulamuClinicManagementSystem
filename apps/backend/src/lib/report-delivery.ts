import type { FastifyReply } from 'fastify';
import { prisma } from './prisma';
import { formatEmailDateTime, reportCopyEmail, sendMail } from './mailer';

/** The response header that tells the page where the copy went. */
export const EMAILED_TO_HEADER = 'X-Report-Emailed-To';

/**
 * Every report someone generates also goes to their own inbox, with the file
 * attached - a copy they keep after the download is gone (or when the download
 * didn't visibly happen, as in an installed app window). Sent in the
 * background: the report is never held up, and a failed email never fails it.
 * Sets a header naming where the copy went; returns that address, or null.
 */
export async function emailReportCopy(
  reply: FastifyReply,
  userId: string,
  report: { title: string; filename: string; content: Buffer | string; contentType: string; facts?: Array<[string, string]> },
  log: (message: string) => void = () => {},
): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }).catch(() => null);
  const to = user?.email?.trim();
  if (!to) return null;
  const facts: Array<[string, string]> = [...(report.facts ?? []), ['Generated', formatEmailDateTime(new Date())]];
  void sendMail({
    to,
    subject: `[Bulamu] ${report.title}`,
    html: reportCopyEmail({ title: report.title, filename: report.filename, facts }),
    attachments: [{ filename: report.filename, content: Buffer.isBuffer(report.content) ? report.content : Buffer.from(report.content, 'utf8'), contentType: report.contentType }],
  })
    .then((result) => { if (!result.sent) log(`Report copy to the user was not sent: ${result.reason ?? 'unknown reason'}`); })
    .catch((error) => log(`Report copy to the user failed: ${error?.message ?? error}`));
  reply.header(EMAILED_TO_HEADER, to);
  return to;
}
