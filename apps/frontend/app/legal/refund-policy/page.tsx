import { LegalLayout } from '@/components/legal-layout';

export const metadata = { title: 'Refund Policy | Bulamu' };

export default function RefundPolicyPage() {
  return (
    <LegalLayout title="Subscription & Refund Policy" effectiveDate="17 September 2026">
      <h2>1. Free trial</h2>
      <p>
        Every newly approved facility receives a 2-week (14-day) free trial with full access to Bulamu, starting from
        the date your facility is approved by a Bulamu administrator. No payment is required or collected during the
        trial, and you may cancel at any time during the trial at no cost. Each facility is entitled to exactly one
        free trial, tracked by its unique Facility ID (see Terms of Service, section 2) and the phone number used at
        registration; a facility cannot obtain a second free trial by re-registering.
      </p>

      <h2>2. Subscription fee</h2>
      <p>
        After the trial ends, continued access requires an active monthly subscription of{' '}
        <strong>100,000 UGX (approximately $30) per facility per month</strong> under the standard plan, billed and
        processed through Pesapal. Pricing may change with notice to facility administrators; changes apply from the
        next billing cycle onward, never retroactively.
      </p>
      <p>
        Facilities with needs outside the standard plan - higher patient volume, multi-facility arrangements, custom
        integrations, or other features - may agree a custom plan directly with Bulamu. Custom plans have their own
        agreed price and scope, shown on your facility&apos;s Billing page, and are otherwise subject to this policy.
      </p>

      <h2>3. Billing cycle</h2>
      <p>
        A subscription period runs for 30 days from the date of successful payment. You can trigger payment for the
        next period at any time from your facility&apos;s Billing page.
      </p>

      <h2>4. What happens if payment lapses</h2>
      <p>
        If your trial ends or a subscription period expires without payment, your facility moves to a
        &quot;past due&quot; state: existing records remain fully viewable, but new records and edits cannot be
        saved until payment is completed. No data is deleted for non-payment.
      </p>

      <h2>5. Cancellation</h2>
      <p>
        You may stop subscribing at any time by simply not renewing - there is no lock-in contract. Your facility
        keeps read access to its existing records after cancellation. There is no automatic recurring billing;
        each payment is a deliberate action taken by your facility administrator.
      </p>

      <h2>6. Refunds</h2>
      <p>
        Because each subscription period grants a full 30 days of access immediately upon payment, payments are
        generally <strong>non-refundable</strong> once a period has started, except:
      </p>
      <ul>
        <li>Where required by Ugandan consumer protection law;</li>
        <li>Where a payment was taken in error or duplicated due to a technical fault; or</li>
        <li>Where the Service was unavailable to your facility for a prolonged period through our fault.</li>
      </ul>
      <p>To request a refund under one of these circumstances, contact us via the icons in the footer of this page with your facility name and payment reference.</p>

      <h2>7. Payment processing</h2>
      <p>
        All payments are processed by Pesapal, a licensed third-party payment service provider. Bulamu does not
        store your card or mobile money details. Any payment disputes regarding the processing of a transaction
        itself (as opposed to the subscription it paid for) may also be subject to Pesapal&apos;s own terms.
      </p>

      <h2>8. Contact</h2>
      <p>Use the WhatsApp or email icons in the footer of this page for any billing questions.</p>
    </LegalLayout>
  );
}
