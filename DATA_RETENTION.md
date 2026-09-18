# Data retention and deletion - engineering and operations reference

The public policy is published at `/legal/data-retention` (source:
`apps/frontend/app/legal/data-retention/page.tsx`). That page is the
authority for *what we promise*. This document maps those promises to the
code, says which parts happen automatically and which are a manual procedure,
and lists the known gaps. Keep the two in step: change a period in one, change
it in the other.

> The retention periods below (10 years clinical, 7 years financial and audit)
> are proposed defaults. They must be confirmed against Ugandan health-record
> and tax record-keeping requirements by the company's legal adviser before the
> policy is relied on. Where the law requires longer, the longer period applies.

## 1. Retention schedule

| Category | Kept | At the end |
| --- | --- | --- |
| Clinical records (patients, appointments, consultations, prescriptions, lab tests, reproductive health, referrals, invoices) | While the facility is active, then 10 years from the last entry | Erase |
| Documents | With the clinical record; deleting a document erases it at once | Erase |
| Facility and staff account details | While the facility is active; after facility deletion, 10 years (same as clinical) | Erase |
| Subscription, payment and receipt records | 7 years | Erase |
| Patient Portal account | Until the patient closes it | Erased on closure |
| Notifications | 90 days | Erase |
| Sign-in / verification links and codes | Until they expire (10 min code, 1 h reset link, 72 h invitation) | Remove |
| Audit trail | 7 years | Erase |
| Backups | Hosting provider's rolling window | Expire |

## 2. What each deletion does today

| Data | Model | Mechanism | Erased when |
| --- | --- | --- | --- |
| Patient | `Patient` | Soft delete (`deletedAt`) via `DELETE /patients/:id` (ADMIN) or sync. Hidden from every list, search and report. | Manual, end of retention |
| Appointment, consultation, lab test, reproductive-health record, medicine | respective models | Soft delete (`deletedAt`) via sync | Manual, end of retention |
| Prescription, invoice, referral | `Prescription`, `Invoice`, `Referral` | No delete path; retained with the parent record | Manual, end of retention |
| Document | `Document` + file | **Hard delete** (file and row) by the uploader, a facility ADMIN, or the patient for their own uploads | Immediately |
| Staff user | `User` | Deactivate only (`isActive = false`, `PATCH /users/:id/deactivate`). Existing sessions stop on the next request. No delete route. | Manual, with the facility |
| Facility | `Clinic` | Soft delete (`deletedAt`, `deletedBy`, `isActive = false`) via `DELETE /clinics/:id` (SUPER_ADMIN, exact-name confirmation). All its users are deactivated. Records are **not** erased. | Manual, end of retention |
| Rejected registration | `Clinic` (`REJECTED`) | Row retained, users inactive | Manual, on request |
| Subscription / payment | `Subscription`, `Payment` | Retained. The free-trial receipt is a zero-amount, completed `Payment`. | Manual, 7 years |
| Patient Portal account | `PatientAccount` | `POST /patient-portal/account/close` (see section 3) | Immediately (personal data); the tombstone row stays for audit |
| Notifications | `Notification` | Removed lazily: a recipient's notifications older than 90 days are deleted whenever they open their list. Deleted on patient account closure. | Automatic |
| Set-up / reset links, verification codes | `PasswordResetToken`, `PatientPasswordResetToken`, `PatientAccessOtp` | Expire; expired and used rows are removed the next time a new one is issued for that account. Deleted on patient account closure. | Automatic |
| Audit trail | `AuditLog` | Retained; no delete path | Manual, 7 years |

## 3. Patient Portal account closure

`POST /patient-portal/account/close` with `{ password }` (the patient's own
password; rate limited). In one transaction it:

1. deletes every document the patient uploaded (files and rows);
2. unlinks every facility's `Patient` row from the account and clears the
   portal email held on it - the clinical record itself stays;
3. revokes all active access grants;
4. deletes the account's notifications, verification codes and reset tokens;
5. anonymises the account row: status `CLOSED`, email replaced by
   `closed-<id>@closed.invalid`, phone and phone key cleared, password replaced
   by a random hash, preferences cleared, `closedAt` set.

A confirmation email is sent to the previous address first, and an audit entry
is written against each affected facility. Appointment requests the patient
sent are kept (they are the facility's scheduling records). The tombstone row
is kept because audit entries, grants and appointment requests reference it.

## 4. Automatic vs manual

**Automatic today:** hard-deleting documents, 90-day notification expiry, token
and code clean-up, patient account closure, immediate loss of staff access on
deactivation or facility deletion.

**Manual today (no scheduled job):** end-of-retention erasure of clinical
records, facility data, payments and audit entries; export before facility
deletion; erasing rejected registrations; anonymising staff details after a
facility is deleted. Use the procedure below.

## 5. Manual erasure procedure (end of retention)

Erasure is irreversible. Two people approve it, and a database snapshot (for
example a Neon branch) is taken first.

1. **Select** facilities whose `deletedAt` is older than the clinical
   retention period *and* whose last clinical entry is older than it. Confirm
   there is no legal hold or open request.
2. **Export** anything the facility asked for before deletion.
3. **Delete in foreign-key-safe order**, scoping every statement to that
   facility's `clinicId` (or its patients / users): notifications for its
   users; documents (files first, then rows); prescriptions; invoices; lab
   tests; reproductive-health records; consultations; appointment requests;
   appointments; referrals (both directions); access grants and codes for the
   clinic; patients; medicines; comments; then users.
4. **Do not delete the `Clinic` row** if it created any `PatientAccount`
   (the foreign key is `RESTRICT`). Anonymise it instead (name, address, phone,
   district fields) and keep `id` and `facilityCode`.
5. **Payments and subscriptions** are erased only once they are older than
   7 years; audit entries likewise.
6. **Record the erasure**: write an `AuditLog` entry (`entity: 'Clinic'`,
   `action: 'DELETE'`, `metadata: { event: 'RETENTION_ERASURE' }`) with no
   personal content, and note the date and the two approvers.
7. **Verify** row counts for the facility are zero and that the application
   still starts and lists facilities correctly.

## 6. Known gaps

1. **Uploaded files are not durable on the current hosting.** `lib/storage.ts`
   writes to the API host's local disk. The Render deployment (free plan) sets
   no `DOCUMENT_STORAGE_DIR` and mounts no persistent disk, so files are lost
   on every restart, redeploy and idle spin-down, while the database rows
   remain (downloads then fail). Until durable storage is in place, the policy's
   promise to keep documents with the clinical record cannot be honoured for the
   files themselves. Fix: object storage (for example Cloudflare R2 or S3) behind
   the same `saveFile` / `getFileStream` / `deleteFile` contract, or a persistent
   disk on a paid plan with `DOCUMENT_STORAGE_DIR` pointing at it.
2. **No scheduled erasure job.** Section 5 is a manual procedure. Consider a
   reviewed, scheduled job once volumes justify it.
3. **Retention periods are unconfirmed** by legal counsel (see the note at the
   top).
4. **Audit metadata may hold file names** (document create/delete), which can
   contain personal information. Consider recording only ids.
5. **Facility deletion does not anonymise staff personal details.** They are
   retained until the manual procedure removes them.
6. **Staff notifications are not deleted on deactivation**, only by the 90-day
   expiry.
7. **The `Clinic` foreign key** from `PatientAccount.createdByClinicId` blocks
   deleting a facility row that created portal accounts (see section 5, step 4).
