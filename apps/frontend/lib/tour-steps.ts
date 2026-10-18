import {
  ArrowRightLeft, BarChart3, BedDouble, Bell, Building2, CalendarDays, ClipboardList, CreditCard, Crown, FlaskConical,
  HelpCircle, History, Home, MapPinned, Moon, Package, Pill, Receipt, ShieldCheck, Stethoscope, Users, Wallet, type LucideIcon,
} from 'lucide-react';

/**
 * The guided walkthrough, per role. Each step points at the control it is about
 * (`target` = the element's data-tour attribute; nav items are `nav-<path>`) and
 * says what this person actually does there - and what they will be notified
 * about. A step without a target is shown in the middle of the screen.
 */
export type TourStep = {
  title: string;
  body: string;
  tips?: string[];
  target?: string;
  /** A short "where" label shown with the step number, e.g. "Menu". */
  where?: string;
  icon: LucideIcon;
};

const nav = (path: string) => `nav-${path}`;

const welcome = (roleBlurb: string): TourStep => ({
  title: 'Welcome to Bulamu',
  body: `This short tour shows you where your tools are. ${roleBlurb} It takes about a minute - use Next, or press the arrow keys.`,
  icon: ShieldCheck,
});

const notifications: TourStep = {
  target: nav('/notifications'), where: 'Menu', icon: Bell,
  title: 'Notifications meant for you',
  body: 'Everything that needs your attention arrives here, and the number beside it shows what is unread. You only receive what applies to your role - and some things only to you, such as results of tests you ordered.',
  tips: ['Important ones are also emailed (never with patient details).', 'You can switch individual emails off on this page.'],
};

const activity: TourStep = {
  target: nav('/sync-activity'), where: 'Menu', icon: History,
  title: 'Your activity and offline work',
  body: 'Bulamu keeps working without internet: what you record is saved on this device and sent when the connection returns. Activity shows what you have done and whether it has synced.',
};

const theme: TourStep = {
  target: 'theme-toggle', where: 'Menu', icon: Moon,
  title: 'Light or dark',
  body: 'Switch between light and dark mode here - dark is easier on the eyes on night duty.',
};

const help: TourStep = {
  target: nav('/help'), where: 'Menu', icon: HelpCircle,
  title: 'Help is always here',
  body: 'Help & FAQ answers common questions. You can take this tour again from there at any time - it will not open by itself again.',
};

const closing = [notifications, activity, theme, help];

export const TOUR_STEPS: Record<string, TourStep[]> = {
  SUPER_ADMIN: [
    welcome('As the platform administrator you approve facilities and keep an eye on the whole platform.'),
    {
      target: nav('/super-admin'), where: 'Menu', icon: Crown,
      title: 'Facility Management',
      body: 'New facility registrations wait here for your approval. Approve or reject them, add a facility yourself, suspend or reactivate one, and open any facility to see its full sign-up details.',
      tips: ['Each decision emails the facility automatically.', 'You are emailed about every registration, approval, payment and suspension.'],
    },
    {
      target: nav('/super-admin/analytics'), where: 'Menu', icon: BarChart3,
      title: 'Platform analytics',
      body: 'How the platform is being used and how the system is running: active staff, facility engagement, sign-ins, and the System tab with email delivery and a test-email button.',
    },
    theme,
    help,
  ],
  ADMIN: [
    welcome('As the facility administrator you set up your team and run the facility.'),
    {
      target: nav('/dashboard'), where: 'Menu', icon: Home,
      title: 'Your dashboard',
      body: 'Today at a glance: patients, appointments, consultations and anything that needs attention.',
    },
    {
      target: nav('/users'), where: 'Menu', icon: ClipboardList,
      title: 'Add your staff first',
      body: 'Create an account for each person and give them the right role - Doctor/Clinical Officer, Nurse/Midwife, Pharmacist or Front Desk. Each role sees only the tools and notifications it needs. Here you also correct details, reset passwords and deactivate anyone who leaves.',
    },
    {
      target: nav('/patients'), where: 'Menu', icon: Users,
      title: 'Patients',
      body: 'Register patients and open their record: allergies, visits, lab results, documents, admissions and referrals in one place.',
    },
    {
      target: nav('/wards'), where: 'Menu', icon: BedDouble,
      title: 'Wards and beds',
      body: 'Set up your wards and the number of beds in each. Clinicians then admit patients, record observations and discharge them here.',
    },
    {
      target: nav('/referrals'), where: 'Menu', icon: ArrowRightLeft,
      title: 'Referrals',
      body: 'Patients referred to and from your facility, with the referral letter and the other facility\'s reply.',
    },
    {
      target: nav('/inventory'), where: 'Menu', icon: Package,
      title: 'Medicine stock',
      body: 'Stock levels and reorder points. You and the pharmacist are alerted when stock runs low, runs out, or is about to expire.',
    },
    {
      target: nav('/reports'), where: 'Menu', icon: BarChart3,
      title: 'Reports',
      body: 'HMIS 105 monthly reporting (with a DHIS2 push), and exports for your records.',
    },
    {
      target: nav('/invoices'), where: 'Menu', icon: Receipt,
      title: 'Bills and payments',
      body: 'Every charge for a patient - visit, lab tests, medicines, ward stay - and every payment your staff record, each with a numbered receipt. Patients pay the facility as usual; Bulamu keeps the record.',
    },
    {
      target: nav('/finances'), where: 'Menu', icon: Wallet,
      title: 'Finances',
      body: "Each day's takings by method and by member of staff, the month's money in against money out, and your expenses. Download it all as a spreadsheet for your books.",
    },
    {
      target: nav('/billing'), where: 'Menu', icon: CreditCard,
      title: 'Subscription',
      body: 'Your free trial or subscription, payment through Pesapal, and receipts. You are reminded before it ends.',
    },
    {
      target: nav('/facility'), where: 'Menu', icon: Building2,
      title: 'Your logo on documents',
      body: 'Add your facility logo here. It is printed on your invoices, prescriptions, referral letters and discharge summaries, which are also signed with the name and role of the staff member responsible.',
    },
    ...closing,
  ],
  DOCTOR: [
    welcome('As a clinician you see patients, order tests, prescribe, admit and refer.'),
    {
      target: nav('/appointments'), where: 'Menu', icon: CalendarDays,
      title: 'Your appointments',
      body: 'Your list for the day. You are notified when a colleague books a patient with you, or cancels one.',
    },
    {
      target: nav('/patients'), where: 'Menu', icon: Users,
      title: 'The patient record',
      body: 'Open a patient to see allergies first, then visits, results, admissions and referrals.',
      tips: ['If the patient has visited other Bulamu facilities, you can ask them to share that history - nothing is shown unless they approve.'],
    },
    {
      target: nav('/consultations'), where: 'Menu', icon: Stethoscope,
      title: 'Consultations',
      body: 'Record complaints, ICD-10 coded diagnoses and prescriptions. Allergy clashes are flagged as you prescribe, and the pharmacist is told what to dispense.',
    },
    {
      target: nav('/lab'), where: 'Menu', icon: FlaskConical,
      title: 'Lab tests',
      body: 'Order tests here. The lab team is notified, and you are notified the moment a result you ordered is recorded.',
    },
    {
      target: nav('/wards'), where: 'Menu', icon: BedDouble,
      title: 'Inpatients',
      body: 'Admit patients to a ward bed, write ward-round notes, review the nurses\' observations, and discharge - home, or by referral with a discharge summary.',
    },
    {
      target: nav('/referrals'), where: 'Menu', icon: ArrowRightLeft,
      title: 'Referrals',
      body: 'Refer a patient out with a letter and clinical summary, or accept referrals sent to you. You hear back when the other facility accepts, declines or completes your referral.',
    },
    ...closing,
  ],
  NURSE: [
    welcome('As a nurse or midwife you register and prepare patients, run the lab and care for inpatients.'),
    {
      target: nav('/patients'), where: 'Menu', icon: Users,
      title: 'Patients',
      body: 'Register new patients and record allergies. If a patient gives an email, they are invited to the Patient Portal to see their own records.',
    },
    {
      target: nav('/appointments'), where: 'Menu', icon: CalendarDays,
      title: 'Appointments',
      body: 'The day\'s schedule, and appointment requests patients send from the portal - you are notified of each one.',
    },
    {
      target: nav('/lab'), where: 'Menu', icon: FlaskConical,
      title: 'Lab tests',
      body: 'New lab orders arrive here and you are notified of each. Record the result and the clinician who ordered it is told straight away.',
    },
    {
      target: nav('/wards'), where: 'Menu', icon: BedDouble,
      title: 'Wards',
      body: 'Every admitted patient by ward and bed. Record observations (temperature, pulse, BP, SpO2) and nursing notes, and move patients between wards. You are notified of each admission.',
    },
    {
      target: nav('/referrals'), where: 'Menu', icon: ArrowRightLeft,
      title: 'Referrals',
      body: 'Referrals in and out of the facility. Patients referred to you can be registered here in one step.',
    },
    {
      target: nav('/chw-visit'), where: 'Menu', icon: MapPinned,
      title: 'Household visits',
      body: 'For outreach work: record household visits in the field. It works fully offline.',
    },
    ...closing,
  ],
  PHARMACIST: [
    welcome('As the pharmacist you dispense prescriptions and keep the shelves stocked.'),
    {
      target: nav('/dispensing'), where: 'Menu', icon: Pill,
      title: 'Dispensing',
      body: 'Prescriptions waiting to be dispensed, with any allergy warnings. Dispensing takes the quantity off stock. You are notified of each new prescription.',
    },
    {
      target: nav('/inventory'), where: 'Menu', icon: Package,
      title: 'Inventory',
      body: 'Stock levels, reorder points and expiry dates. You are alerted when a medicine runs low, runs out, or is within two months of expiry.',
    },
    {
      target: nav('/patients'), where: 'Menu', icon: Users,
      title: 'Patients',
      body: 'Look a patient up to check their allergies and prescriptions before you dispense.',
    },
    {
      target: nav('/invoices'), where: 'Menu', icon: Receipt,
      title: 'Medicines on the bill',
      body: "Add dispensed medicines to the patient's bill at their stock price, or open a bill for medicine sold over the counter, and record the payment with a numbered receipt.",
    },
    ...closing,
  ],
  LAB_TECH: [
    welcome('As the lab technician you receive test orders and record their results.'),
    {
      target: nav('/lab'), where: 'Menu', icon: FlaskConical,
      title: 'Lab tests',
      body: 'New orders arrive here and you are notified of each. Record the result when the test is done - the clinician who ordered it is asked to verify it, and the patient is told once they have.',
      tips: ['Choose the test from the list so it is always written the same way.', 'A verified result is locked; a clinician can amend it with a reason.'],
    },
    {
      target: nav('/patients'), where: 'Menu', icon: Users,
      title: 'Patients',
      body: 'Look a patient up to check you have the right person and sample before recording a result.',
    },
    ...closing,
  ],
  STAFF: [
    welcome('At the front desk you register patients, book appointments and welcome referred patients.'),
    {
      target: nav('/patients'), where: 'Menu', icon: Users,
      title: 'Register patients',
      body: 'Register new patients with their contact details, location and next of kin. Search first, so nobody is registered twice.',
    },
    {
      target: nav('/appointments'), where: 'Menu', icon: CalendarDays,
      title: 'Book appointments',
      body: 'Book patients with a doctor (who is notified), and handle appointment requests patients send from the portal - you are notified of each.',
    },
    {
      target: nav('/referrals'), where: 'Menu', icon: ArrowRightLeft,
      title: 'Referred patients arriving',
      body: 'When another facility refers a patient to you, you are notified. Register them here in one step from the referral.',
    },
    {
      target: nav('/chw-visit'), where: 'Menu', icon: MapPinned,
      title: 'Household visits',
      body: 'Record household visits for outreach work, even without internet.',
    },
    {
      target: nav('/invoices'), where: 'Menu', icon: Receipt,
      title: 'Bills and receipts',
      body: "Record each payment the patient makes - cash, mobile money, card or insurance, in full or in part - and give them the numbered receipt, printed or by SMS, WhatsApp or email. Your day's total is shown for handing over.",
    },
    ...closing,
  ],
};

