# Bulamu Medical Facility OS

Bulamu is an offline-first management system for Ugandan medical facilities. It supports clinics, Health Centre II/III/IV facilities, hospitals, laboratories, imaging centres, pharmacies, mobile units, and community outreach teams.

## Demo Accounts (local development only)

`npm run seed` creates a demo facility with one account for each role (facility admin, doctor, nurse,
pharmacist, front desk) and prints their sign-in details when it finishes. It only runs against a database on
your own machine and refuses to touch a hosted one, so demo accounts never reach the live system.

Live facilities register themselves at bulamu.site and are approved by a Bulamu administrator; production
administrator accounts are provisioned separately and are never documented here. Bulamu is a product of Cruze
Intelligent Systems (U) Ltd.

## Local Development

```bash
npm install
npm run setup:local
npm run dev
```

Services:

- Frontend PWA: `http://localhost:3000`
- Backend API: `http://localhost:4000`
- Health check: `http://localhost:4000/health`

`setup:local` requires a reachable PostgreSQL database through `DATABASE_URL`. On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`.

## Sign-In Requirements

Sign-in requires three things:

- Backend API running on `http://localhost:4000` or the URL configured in `NEXT_PUBLIC_API_URL`
- PostgreSQL available through `DATABASE_URL`
- Seeded access accounts created with `npm run setup:local`

If `/auth/login` fails, check the backend console first. Missing `DATABASE_URL`, unapplied migrations, or unseeded users will prevent authentication.

## Testing

```bash
npm test --workspace=apps/backend    # Vitest against a real, ephemeral Postgres (embedded-postgres - no Docker or system install needed)
npm test --workspace=apps/frontend   # Vitest + Testing Library for logic-bearing pure functions
```

CI (`.github/workflows/ci.yml`) runs type-checking, both test suites, and both production builds on every push.

## Core Capabilities

- Facility authorization from the admin Facility Management console
- Facility type selection during public access request and internal authorization
- Role-based access for SUPER_ADMIN, ADMIN, DOCTOR, PHARMACIST, NURSE, and STAFF (patients are records, not accounts - no patient login)
- Patient registry with demographics, geography, consent capture, appointment booking, consultations, prescriptions, lab tests, invoices, and inventory
- Reproductive-health tracking (cycle history, family planning, pregnancy status) for female patients, feeding directly into HMIS reporting
- Inter-facility referrals (`/referrals`) and a facility hierarchy (district/sub-county/parish)
- Community health worker household-visit capture (`/chw-visit`) for Community Outreach / Mobile Unit facilities, fully offline
- Installable PWA with service worker, app-shell caching (every page and its scripts, so pages never opened before still work offline), IndexedDB local records, offline mutation queue, and sync status badge; a step-by-step install guide for Android, iPhone/iPad and computers is on the Help page and public at `/install`
- Sign-in lasts a 12-hour shift, or 30 days with "Keep me signed in"; changing or resetting a password ends every session on every device, and an ended session goes straight back to sign-in (never while offline, so field work isn't interrupted)
- Timestamp-based deterministic sync conflict resolution with tombstone deletes and a Sync Activity panel (audit log + conflict log)
- HMIS 105 outpatient reporting across 7 sections (attendance by age/gender cohort, epidemic surveillance, essential medicines, family planning, maternal health, other services, referrals)
- FHIR R4 export (Patient, Encounter, Observation resources) and a configurable DHIS2 `dataValueSets` push for interoperability work
- Password reset flow and an audit log for patient/reproductive-health/user/invoice writes
- Self-service facility registration (`/auth/register`) with a private admin approval queue - the internal admin role is never selectable in any form and has no public entry point
- 2-week free trial per approved facility, then a monthly subscription billed through Pesapal (`/billing`); a lapsed subscription blocks new writes but never blocks reading existing records. Paying early adds the 30 days after what is left, admins are reminded 3 days before and on the day, the operator is emailed when a trial or paid month ends unpaid, and the app refuses new saves with a clear message (rather than queueing them on the device) until the facility renews
- Branded legal pages: [Terms of Service](/legal/terms), [Privacy Policy](/legal/privacy), [Refund Policy](/legal/refund-policy)

## Research PDF Alignment

The implementation is kept in sync with `Uganda Rural Health System Research.pdf` around these extracted anchors:

- National aggregation and surveillance: DHIS2
- Facility-level EMR interoperability: OpenMRS, Bahmni, UgandaEMR
- Frontline and community health data capture
- Facility hierarchy and service distribution
- HMIS reporting burden
- Offline-first and local-first architecture
- Deterministic conflict resolution and sync queues
- Edge facility deployment for deep-rural facilities
- Structured training, governance, security, privacy, and clinician feedback loops

## Documentation

- Two-week evaluation playbook: [EVALUATION_PLAYBOOK.md](./EVALUATION_PLAYBOOK.md)
- Research alignment: [RESEARCH_ALIGNMENT.md](./RESEARCH_ALIGNMENT.md)
- Deployment guide: [DEPLOYMENT.md](./DEPLOYMENT.md)
