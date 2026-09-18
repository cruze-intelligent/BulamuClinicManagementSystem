import { LegalLayout } from '@/components/legal-layout';

export const metadata = { title: 'Terms of Service | Bulamu' };

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service" effectiveDate="17 September 2026">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern access to and use of Bulamu Medical Facility OS
        (&quot;Bulamu&quot;, &quot;the Service&quot;), a product of Cruze Intelligent Systems (U) Ltd
        (&quot;Cruze&quot;, &quot;we&quot;, &quot;us&quot;) by medical facilities and their staff (&quot;you&quot;, &quot;your
        facility&quot;) in Uganda. By registering a facility or signing in to Bulamu, you agree to these Terms.
      </p>

      <h2>1. Who may use Bulamu</h2>
      <p>
        Bulamu is intended for licensed and legitimate medical facilities - clinics, health centres, hospitals,
        laboratories, pharmacies, and community/mobile health teams - and their authorized staff. Every facility
        account is reviewed and approved by a Bulamu administrator before it becomes active.
      </p>

      <h2>2. Facility ID and one trial per facility</h2>
      <p>
        Every approved facility is issued a unique Facility ID (format <code>BLM-XXXXXX</code>), shown in your
        Facility Management or Billing page and printed on invoices and subscription receipts. Registration is keyed
        to your facility&apos;s phone number: a facility that already has a pending or approved registration cannot
        register a second time under a different account. Each real-world facility is entitled to one 2-week free
        trial; attempting to obtain additional trials through duplicate registrations is a breach of these Terms and
        may result in the duplicate account being rejected or suspended.
      </p>

      <h2>3. Accounts and roles</h2>
      <p>
        When you register, the person completing registration becomes the facility&apos;s Administrator account and
        is responsible for the facility&apos;s use of the Service, including creating and managing accounts for
        doctors, nurses, pharmacists, and other staff within that facility. You are responsible for keeping login
        credentials confidential and for all activity under your facility&apos;s accounts.
      </p>

      <h2>4. Free trial and subscription</h2>
      <p>
        New facilities receive a 2-week free trial from the date of approval. After the trial ends, continued access
        to create or edit records requires an active paid monthly subscription, billed and processed through
        Pesapal. Pricing, billing, and cancellation terms are set out in our{' '}
        <a href="/legal/refund-policy" className="text-emerald-700 hover:underline">Refund Policy</a>, which forms
        part of these Terms. Existing records remain viewable if a subscription lapses; new records cannot be saved
        until payment is completed.
      </p>

      <h2>5. Your data</h2>
      <p>
        Your facility retains ownership of the patient and operational records it enters into Bulamu. Cruze acts as
        a data processor on your behalf for the purpose of providing the Service, as described in our{' '}
        <a href="/legal/privacy" className="text-emerald-700 hover:underline">Privacy Policy</a>. How long records
        are kept, and what happens to them when a record, an account or a facility is deleted, is set out in our{' '}
        <a href="/legal/data-retention" className="text-emerald-700 hover:underline">Data Retention and Deletion Policy</a>.
        You are responsible for obtaining any patient consent required by law before recording their information, and
        Bulamu provides consent-tracking fields for this purpose.
      </p>

      <h2>6. Acceptable use</h2>
      <ul>
        <li>Do not use Bulamu for any facility, patient, or purpose you are not lawfully authorized to serve.</li>
        <li>Do not attempt to access another facility&apos;s data, bypass access controls, or share login credentials outside your facility.</li>
        <li>Do not upload content that is unlawful, or that infringes the rights of others.</li>
        <li>Do not attempt to disrupt, reverse-engineer, or overload the Service.</li>
      </ul>

      <h2>7. Availability and support</h2>
      <p>
        Bulamu is offered on an evolving, best-effort basis. We aim for high availability but do not guarantee
        uninterrupted access, particularly during the early testing phase of the Service. Bulamu&apos;s offline-first
        design allows continued local use of already-synced data during connectivity interruptions.
      </p>

      <h2>8. Suspension and termination</h2>
      <p>
        We may suspend or terminate a facility&apos;s access for breach of these Terms, non-payment beyond a
        reasonable grace period, fraudulent registration, or unlawful use. You may stop using the Service and cancel
        your subscription at any time as described in the Refund Policy.
      </p>

      <h2>9. Disclaimers and limitation of liability</h2>
      <p>
        Bulamu is a records and workflow management tool; it does not provide medical advice and does not replace
        the clinical judgment of qualified healthcare professionals. To the fullest extent permitted by law, Cruze
        is not liable for indirect, incidental, or consequential damages arising from use of the Service.
      </p>

      <h2>10. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be communicated to facility administrators.
        Continued use of Bulamu after changes take effect constitutes acceptance of the revised Terms.
      </p>

      <h2>11. Governing law</h2>
      <p>These Terms are governed by the laws of the Republic of Uganda, and disputes are subject to the exclusive jurisdiction of the courts of Uganda.</p>

      <h2>12. Contact</h2>
      <p>Use the WhatsApp or email icons in the footer of this page to reach us.</p>
    </LegalLayout>
  );
}
