import {
  demoFacilityEmail, facilityApprovedEmail, facilityRejectedEmail, facilityRemovedEmail, facilityStatusEmail, feedbackSubmittedEmail,
  historyShareOtpEmail, notificationEmail, operatorAlertEmail, passwordResetEmail, patientAccessOtpEmail, patientAccountClosedEmail,
  patientPasswordResetEmail, patientPortalAccountCreatedEmail, registrationReceivedEmail, subscriptionReceiptEmail, trialExtendedEmail,
} from './mailer';
import { frontendUrl } from './operator-alerts';

// One of every email Bulamu sends, filled with made-up details and with the
// subject a recipient would see, so their look and wording can be checked in a
// real inbox without touching anyone's account.
// Links point at the real site; codes, tokens and addresses are invented.

export type SampleEmail = { subject: string; html: string };

const DAY = 24 * 60 * 60 * 1000;

export function buildSampleEmails(now: Date = new Date()): SampleEmail[] {
  const login = frontendUrl('/auth/login');
  const in14 = new Date(now.getTime() + 14 * DAY);
  const letter = { adminName: 'Grace Nankya', facilityCode: 'BLM-7Q4K2D', reason: 'Subscription payment overdue' };
  return [
    {
      subject: 'Thank you for your interest in Bulamu: your demo is ready',
      html: demoFacilityEmail({
        loginUrl: login, registerUrl: frontendUrl('/auth/register'), password: 'Mango-Lantern-4821', expiresAt: in14,
        accounts: [
          { roleTitle: 'Administrator', name: 'Grace Nankya', email: 'admin.kvdbmz@demo.bulamu.site' },
          { roleTitle: 'Front Desk', name: 'Esther Atim', email: 'frontdesk.kvdbmz@demo.bulamu.site' },
          { roleTitle: 'Doctor / Clinical Officer', name: 'Dr Samuel Okello', email: 'doctor.kvdbmz@demo.bulamu.site' },
          { roleTitle: 'Laboratory Technician', name: 'Ivan Kato', email: 'labtech.kvdbmz@demo.bulamu.site' },
          { roleTitle: 'Pharmacist', name: 'Brian Mugisha', email: 'pharmacist.kvdbmz@demo.bulamu.site' },
          { roleTitle: 'Nurse / Midwife', name: 'Sr Prossy Namubiru', email: 'nurse.kvdbmz@demo.bulamu.site' },
        ],
        patient: { name: 'Achieng Mary', email: 'patient.kvdbmz@demo.bulamu.site', portalUrl: frontendUrl('/patient-portal/login') },
      }),
    },
    { subject: 'We have received your registration - Mbarara Community Clinic', html: registrationReceivedEmail('Grace Nankya', 'Mbarara Community Clinic', 'BLM-7Q4K2D') },
    {
      subject: 'Welcome to Bulamu - Mbarara Community Clinic is approved',
      html: facilityApprovedEmail('Mbarara Community Clinic', login, in14, { facilityCode: 'BLM-7Q4K2D', adminEmail: 'grace@mbararaclinic.ug' }),
    },
    { subject: 'About your registration - Mbarara Community Clinic', html: facilityRejectedEmail('Mbarara Community Clinic', 'The licence number could not be verified with the Ministry of Health register') },
    { subject: 'Your Bulamu free trial has been extended - Mbarara Community Clinic', html: trialExtendedEmail('Mbarara Community Clinic', 7, new Date(now.getTime() + 10 * DAY), login) },
    { subject: 'Payment received - Mbarara Community Clinic', html: subscriptionReceiptEmail('Mbarara Community Clinic', 100000, 'UGX', new Date(now.getTime() + 30 * DAY)) },
    { subject: "Your facility's access has been suspended - Mbarara Community Clinic", html: facilityStatusEmail('Mbarara Community Clinic', false, login, letter) },
    { subject: 'Access restored - Mbarara Community Clinic', html: facilityStatusEmail('Mbarara Community Clinic', true, login, { ...letter, reason: null }) },
    { subject: 'Your facility has been removed from Bulamu - Mbarara Community Clinic', html: facilityRemovedEmail('Mbarara Community Clinic', { ...letter, reason: 'Closed at the facility\'s request' }) },
    { subject: 'Reset your Bulamu password', html: passwordResetEmail(frontendUrl('/auth/reset-password?token=sample')) },
    {
      subject: 'New lab result to verify',
      html: notificationEmail({ heading: 'New lab result to verify', message: 'A lab result is waiting for you to verify it. Sign in to see the details.', ctaUrl: frontendUrl('/lab'), ctaLabel: 'Open Bulamu' }),
    },
    { subject: 'Your Bulamu patient account', html: patientPortalAccountCreatedEmail('Achieng Mary', 'BLM-P-4KQ7ZD', 'Mbarara Community Clinic', frontendUrl('/patient-portal/set-password?token=sample')) },
    { subject: 'Reset your Patient Portal password', html: patientPasswordResetEmail(frontendUrl('/patient-portal/set-password?token=sample')) },
    { subject: 'Mbarara Community Clinic is asking to see your health history', html: historyShareOtpEmail('Mbarara Community Clinic', '482915') },
    { subject: "Confirm it's you at Mbarara Community Clinic", html: patientAccessOtpEmail('Mbarara Community Clinic', '739204') },
    { subject: 'Your Patient Portal account is closed', html: patientAccountClosedEmail() },
    {
      subject: '[Bulamu] New facility registration - Mbarara Community Clinic',
      html: operatorAlertEmail({
        heading: 'A new facility has registered',
        intro: 'It is waiting for your review on the Facilities page.',
        facts: [['Facility', 'Mbarara Community Clinic'], ['Facility ID', 'BLM-7Q4K2D'], ['Type', 'Health centre III'], ['District', 'Mbarara'], ['Administrator', 'Grace Nankya'], ['Email', 'grace@mbararaclinic.ug']],
        ctaUrl: frontendUrl('/super-admin'), ctaLabel: 'Review it',
      }),
    },
    { subject: '[Bulamu] New feedback - Mbarara Community Clinic', html: feedbackSubmittedEmail('Dr Samuel Okello', 'DOCTOR', 'Mbarara Community Clinic', 'It would help to print the lab request form for samples we send out.\nThank you for the quick fixes last week!') },
  ];
}
