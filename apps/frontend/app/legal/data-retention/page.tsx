import { LegalLayout } from '@/components/legal-layout';

export const metadata = { title: 'Data Retention and Deletion Policy | Bulamu' };

const SCHEDULE: Array<{ category: string; includes: string; kept: string; after: string }> = [
  {
    category: 'Clinical records',
    includes: 'Patient details, appointments, consultations, prescriptions, lab tests, reproductive health records, referrals and invoices entered by a facility.',
    kept: 'While the facility account is active, and afterwards for 5 years from the last entry on the record.*',
    after: 'Permanently erased.',
  },
  {
    category: 'Documents',
    includes: 'Files attached to a patient record, uploaded by facility staff or by the patient.',
    kept: 'With the clinical record. A document that is deleted by the person who uploaded it, or by a facility administrator, is removed immediately and permanently.',
    after: 'Permanently erased with the record.',
  },
  {
    category: 'Facility and staff account details',
    includes: 'Facility profile, and staff names, email addresses and roles.',
    kept: 'While the facility account is active. Staff sign-in is disabled immediately when an account is deactivated or a facility is deleted. After a facility is deleted, these details are kept, restricted, for the same period as the facility’s clinical records.',
    after: 'Permanently erased.',
  },
  {
    category: 'Subscription, payment and receipt records',
    includes: 'Subscription status, payment references, and receipts (including the free-trial receipt). Card and mobile money details are held by our payment processor, not by Bulamu.',
    kept: '7 years from the date of the record.*',
    after: 'Permanently erased.',
  },
  {
    category: 'Patient Portal account',
    includes: 'Email address, phone number, Patient ID, password (stored only in scrambled form) and notification preferences.',
    kept: 'Until the patient closes the account.',
    after: 'Erased immediately on closure. See section 4.4.',
  },
  {
    category: 'Notifications',
    includes: 'The in-app notifications shown to staff and patients.',
    kept: '90 days.',
    after: 'Permanently erased.',
  },
  {
    category: 'Sign-in and verification links and codes',
    includes: 'Password set-up and reset links, and one-time verification codes.',
    kept: 'Only until they expire: 10 minutes for a verification code, 1 hour for a password reset link, and 72 hours for a Patient Portal invitation link.',
    after: 'Expired items are removed.',
  },
  {
    category: 'Staff activity and sign-in records',
    includes: 'Which days a staff member used Bulamu, when they were last seen, and whether each sign-in succeeded, failed or was blocked. Used for platform usage statistics. It never records what was viewed or changed, and never includes patient details.',
    kept: '13 months.',
    after: 'Permanently erased.',
  },
  {
    category: 'Audit trail',
    includes: 'A record of who created, changed or deleted sensitive records, and when. It identifies records by reference rather than repeating their contents.',
    kept: '7 years.*',
    after: 'Permanently erased.',
  },
  {
    category: 'Backups',
    includes: 'Copies of the database taken by our hosting provider for disaster recovery.',
    kept: 'For a limited rolling period set by the provider.',
    after: 'Information erased from our live systems disappears from backups as they expire.',
  },
];

export default function DataRetentionPage() {
  return (
    <LegalLayout title="Data Retention and Deletion Policy" effectiveDate="21 September 2026">
      <p>
        This policy explains how long Bulamu Medical Facility OS (&quot;Bulamu&quot;) keeps information, and exactly
        what happens to it when a record, a staff account, a Patient Portal account or a whole facility is deleted or
        closed. It forms part of, and should be read with, our{' '}
        <a href="/legal/privacy" className="text-emerald-700 hover:underline">Privacy Policy</a>. It applies to Cruze
        Intelligent Systems (U) Ltd (&quot;Cruze&quot;, &quot;we&quot;), to the medical facilities that use Bulamu, and
        to patients who use the Patient Portal.
      </p>

      <h2>1. Who decides what happens to data</h2>
      <ul>
        <li>
          <strong>Clinical records</strong> belong to the treating facility, which is the data controller. Cruze is the
          data processor and keeps and erases those records only as this policy and the facility&apos;s instructions
          require.
        </li>
        <li>
          <strong>Patient Portal accounts</strong> are opened for a patient by the facility that registers them, and
          the patient may close the account at any time.
        </li>
        <li>
          <strong>Facility account, billing and security records</strong> are held by Cruze for running the Service,
          meeting financial record-keeping duties and protecting patients and facilities.
        </li>
      </ul>

      <h2>2. Retention schedule</h2>
      <div className="not-prose overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-slate-900">
            <tr>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">What it includes</th>
              <th className="px-4 py-3 font-semibold">How long we keep it</th>
              <th className="px-4 py-3 font-semibold">At the end</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 align-top">
            {SCHEDULE.map((row) => (
              <tr key={row.category}>
                <td className="px-4 py-3 font-medium text-slate-900">{row.category}</td>
                <td className="px-4 py-3">{row.includes}</td>
                <td className="px-4 py-3">{row.kept}</td>
                <td className="px-4 py-3">{row.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        * Where Ugandan law, or the facility&apos;s regulator, requires a longer period, the longer period applies.
      </p>

      <h2>3. Why records are not erased at once</h2>
      <p>
        A medical record is only useful, and only trustworthy, if it is complete. Clinicians rely on a patient&apos;s
        history for their safety, facilities have professional and legal duties to keep health records, and an audit
        trail must stay accurate to protect both patients and staff. For that reason, deleting something in Bulamu
        removes it from view straight away but does not erase it from our systems until the retention period in
        section 2 has ended. During that time it is restricted: it is not shown on any screen, cannot be opened by
        facility staff, and is accessible only to authorised Bulamu personnel for a lawful, documented purpose such as a
        legal request or a security investigation.
      </p>

      <h2>4. What happens when something is deleted or closed</h2>

      <h3 className="text-base font-semibold text-slate-950">4.1 A patient record is deleted at a facility</h3>
      <p>
        Only a facility administrator can delete a patient record. It disappears from every list, search and report
        immediately. It is then retained, restricted, for the clinical retention period and permanently erased at the
        end of it, or earlier where the law requires and permits. The deletion is recorded in the audit trail.
      </p>

      <h3 className="text-base font-semibold text-slate-950">4.2 A staff account is deactivated</h3>
      <p>
        The person can no longer sign in, and any session that is already open stops working on its next request. The
        records they created remain in place and stay attributed to them, so that clinical history and the audit trail
        stay accurate. Their name and email address remain on the facility&apos;s staff list, marked as deactivated,
        for as long as the facility account is active.
      </p>

      <h3 className="text-base font-semibold text-slate-950">4.3 A facility is deleted</h3>
      <p>
        Deleting a facility is carried out only by Cruze and requires the facility&apos;s exact name to be confirmed.
        From that moment all of the facility&apos;s staff lose access, and the facility is removed from every directory
        and listing. Its clinical records are not erased on that day: they are retained, restricted, for the clinical
        retention period and then permanently erased. A facility that wishes to keep a copy of its data should ask us
        for an export before deletion (see section 6). Patients who hold Patient Portal accounts can still see their
        own records in the portal.
      </p>

      <h3 className="text-base font-semibold text-slate-950">4.4 A patient closes their Patient Portal account</h3>
      <p>
        A patient can close their account at any time from the Access page of the Patient Portal, by confirming their
        password. On closure:
      </p>
      <ul>
        <li>
          <strong>Erased immediately:</strong> the email address and phone number held on the account, the password,
          notification preferences, notifications, and any outstanding sign-in links or verification codes. The
          email address the facility recorded for portal purposes is also removed from the patient&apos;s facility
          records.
        </li>
        <li>
          <strong>Deleted immediately:</strong> every document the patient uploaded themselves.
        </li>
        <li>
          <strong>Access ended:</strong> every facility&apos;s access through the account is revoked, and the account
          can no longer be used to sign in. The patient receives a confirmation email at their previous address.
        </li>
        <li>
          <strong>Kept:</strong> the clinical records held by each facility, which remain with that facility under
          section 2 because the facility has a legal duty to keep them. They are no longer linked to a portal account.
          Appointment requests the patient sent to a facility, and the audit trail entry recording the closure, are
          also kept.
        </li>
      </ul>
      <p>
        Closing the account does not, by itself, remove information from a facility&apos;s clinical records. A patient
        who wants their facility to correct or erase clinical information should ask the facility, which decides
        whether the law allows it.
      </p>

      <h3 className="text-base font-semibold text-slate-950">4.5 A document is deleted</h3>
      <p>
        The file and its record are removed permanently and immediately. Only the person who uploaded a document or a
        facility administrator can delete it, and patients can delete only what they uploaded themselves. Documents
        that staff attached to a clinical record are managed by the facility.
      </p>

      <h3 className="text-base font-semibold text-slate-950">4.6 A registration is not approved, or a subscription lapses</h3>
      <p>
        Details from a facility registration that is not approved are kept only for as long as needed to answer
        enquiries and to prevent repeat trial registrations, and are erased on request. If a subscription lapses, no
        data is deleted: existing records remain viewable and only the saving of new records is paused until payment is
        made.
      </p>

      <h2>5. Permanent erasure</h2>
      <p>
        When a retention period ends, the information is permanently erased from our live systems. Copies held in
        backups are removed as those backups expire under our hosting provider&apos;s rolling schedule. We keep a
        minimal record that an erasure took place, without keeping the erased content.
      </p>

      <h2>6. Requests to export or erase information</h2>
      <ul>
        <li>
          <strong>Patients</strong> can close their Patient Portal account themselves. To access, correct or object to
          the use of clinical information, patients should contact their treating facility, which controls the record.
        </li>
        <li>
          <strong>Facility administrators</strong> can ask us to export their facility&apos;s data before closing an
          account, or to erase information that has passed its retention period.
        </li>
        <li>
          To make a request, use the WhatsApp or email icons in the footer of this page. We will verify who is asking
          before acting, aim to respond within 30 days, and explain clearly if we cannot comply in full and why.
        </li>
      </ul>

      <h2>7. When we may keep information longer</h2>
      <p>
        We may keep information beyond the periods above, only for as long as necessary, where we are required to by
        law or by a regulator, where it is needed to establish, exercise or defend a legal claim, or where it is needed
        to investigate a security incident or protect someone&apos;s safety.
      </p>

      <h2>8. Protection while information is retained</h2>
      <p>
        Retained information stays protected. It is held on encrypted connections and access-controlled systems, it is
        kept apart from the live facility view, and any access by Cruze personnel is limited to those who need it for
        a documented purpose and is recorded in the audit trail.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Material changes will be communicated to facility administrators,
        and the effective date above will be updated.
      </p>

      <h2>10. Contact</h2>
      <p>Use the WhatsApp or email icons in the footer of this page to reach us about data retention and deletion.</p>
    </LegalLayout>
  );
}
