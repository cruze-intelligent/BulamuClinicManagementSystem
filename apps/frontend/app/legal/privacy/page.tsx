import { LegalLayout } from '@/components/legal-layout';

export const metadata = { title: 'Privacy Policy | Bulamu' };

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" effectiveDate="18 September 2026">
      <p>
        This Privacy Policy explains how Cruze Intelligent Systems (U) Ltd (&quot;Cruze&quot;, &quot;we&quot;) handles
        information processed through Bulamu Medical Facility OS (&quot;Bulamu&quot;). It is written to align with
        the Uganda Data Protection and Privacy Act, 2019.
      </p>

      <h2>1. Roles: controller and processor</h2>
      <p>
        Your medical facility is the <strong>data controller</strong> for the patient and clinical information it
        enters into Bulamu - it decides what information is collected and why, and is responsible for obtaining
        patient consent as required by law. Cruze acts as a <strong>data processor</strong>, processing that
        information only to provide, maintain, and support the Service on your facility&apos;s instructions.
      </p>

      <h2>2. Information we process</h2>
      <ul>
        <li><strong>Facility and account information:</strong> facility name, type, address, phone, and administrator/staff name, email, and role.</li>
        <li><strong>Patient records entered by facility staff:</strong> demographics, consultations, prescriptions, lab results, reproductive health records, and related clinical data, only as entered by your facility&apos;s authorized users.</li>
        <li><strong>Consent records:</strong> Bulamu stores who recorded a patient&apos;s consent and when, as provided by your facility&apos;s staff.</li>
        <li><strong>Patient Portal information:</strong> for patients who have a Patient Portal account, the email address and phone number on the account, a Patient ID, a scrambled (hashed) password, notification preferences and notifications, documents the patient chooses to upload, appointment requests, and a record of which facilities the patient has allowed to access their records.</li>
        <li><strong>Billing information:</strong> subscription status and payment references. Card and mobile money details are handled directly by Pesapal, our payment processor - Bulamu does not store your payment credentials.</li>
        <li><strong>Usage and audit data:</strong> login activity and an audit trail of sensitive record changes, used for security and accountability.</li>
      </ul>

      <h2>3. How information is used</h2>
      <ul>
        <li>To provide the clinical, administrative, and reporting functions of the Service.</li>
        <li>To generate national health reporting exports (such as HMIS 105 and, where your facility configures it, DHIS2 and FHIR exports) that your facility controls and initiates.</li>
        <li>To process subscription payments via Pesapal.</li>
        <li>To send notification emails that are relevant to a person&apos;s role or account (for example a restock alert to a pharmacist, or a &quot;results are ready&quot; notice to a patient). These emails never contain patient names or clinical details, and recipients can switch them off.</li>
        <li>To maintain security, audit trails, and prevent unauthorized cross-facility access.</li>
      </ul>

      <h2>4. Security measures</h2>
      <p>
        Access is role-based and scoped to each facility - staff can only see their own facility&apos;s records, with
        oversight limited to authorized Bulamu administrators. Sensitive integration credentials are encrypted at
        rest. Changes to patient, user, and financial records are logged in an audit trail. Data is transmitted over
        encrypted connections.
      </p>

      <h2>5. Data retention</h2>
      <p>
        Clinical records are retained for as long as your facility&apos;s account remains active and as required for
        continuity of patient care and applicable Ugandan health-record retention obligations. Records are
        soft-deleted (retained with a deletion marker) rather than immediately erased, to preserve audit and clinical
        history integrity, and are permanently removed on request where legally permissible. Our{' '}
        <a href="/legal/data-retention" className="text-emerald-700 hover:underline">Data Retention and Deletion Policy</a>{' '}
        sets out how long each kind of information is kept and exactly what happens when a record, a staff account, a
        Patient Portal account or a facility is deleted or closed.
      </p>

      <h2>6. Sharing with third parties</h2>
      <p>
        We share information only as necessary to run the Service: with Pesapal for subscription payment processing,
        and with Uganda&apos;s DHIS2 national health information system only where your facility has explicitly
        configured and triggered that export. We do not sell facility or patient information.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Facility administrators may request export or correction of their facility&apos;s data, and patients may
        exercise their rights under the Data Protection and Privacy Act, 2019 (including access, correction, and
        objection) through their treating facility, which controls the underlying records. Patients with a Patient
        Portal account can view their own records, review or revoke which facilities may access them, choose which
        notification emails they receive, and close the account themselves at any time.
      </p>

      <h2>8. Local storage and offline data</h2>
      <p>
        Bulamu is offline-first: recently accessed records are cached on the device (via browser storage) so staff
        can keep working without connectivity, then sync once back online. Facilities are responsible for the
        physical security of devices used to access Bulamu.
      </p>

      <h2>9. Changes to this Policy</h2>
      <p>We may update this Privacy Policy from time to time; material changes will be communicated to facility administrators.</p>

      <h2>10. Contact</h2>
      <p>Use the WhatsApp or email icons in the footer of this page to reach us about privacy matters.</p>
    </LegalLayout>
  );
}
