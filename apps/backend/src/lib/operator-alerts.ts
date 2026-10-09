import { ADMIN_NOTIFY_EMAIL, MailResult, operatorAlertEmail, sendMail } from './mailer';

/**
 * Emails the platform operator (SUPER_ADMIN_NOTIFY_EMAIL, by default
 * starplay.stargames@gmail.com) about a major platform event: a new facility
 * registration, an approval or rejection, a suspension, a deletion, a payment,
 * new feedback.
 *
 * Fire-and-forget: the action that triggered it has already happened, so this
 * never delays or fails it. Facility and account details only - never patient
 * or clinical information.
 */
export type OperatorEvent = {
  subject: string;
  heading: string;
  intro?: string;
  facts: Array<[string, string | number | null | undefined]>;
  /** A console path such as '/super-admin'; the link is built from FRONTEND_URL. */
  ctaPath?: string;
  ctaLabel?: string;
};

export function frontendUrl(path: string): string {
  return `${process.env.FRONTEND_URL || 'http://localhost:3000'}${path}`;
}

export function alertOperator(event: OperatorEvent): Promise<MailResult> {
  return sendMail({
    to: ADMIN_NOTIFY_EMAIL,
    subject: `[Bulamu] ${event.subject}`,
    html: operatorAlertEmail({
      heading: event.heading,
      intro: event.intro,
      facts: event.facts,
      ctaUrl: event.ctaPath ? frontendUrl(event.ctaPath) : undefined,
      ctaLabel: event.ctaLabel,
    }),
  }).catch((error) => ({ sent: false, reason: error?.message }));
}

/** "Delivered" / "NOT delivered - reason", for telling the operator how a facility email went. */
export function deliveryNote(result: MailResult | null): string {
  if (!result) return 'No admin account found - nothing sent';
  return result.sent ? 'Delivered to the mail server' : `NOT delivered - ${result.reason}`;
}
