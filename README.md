# Bulamu Medical Facility OS

Bulamu is an offline-first management system for Ugandan medical facilities. It supports clinics, Health Centre II/III/IV facilities, hospitals, laboratories, pharmacies, mobile units, and community outreach teams.

## Seeded Access Accounts (local development only)

Seed the backend, then sign in with:

| Role | Email | Password | Landing area |
| --- | --- | --- | --- |
| Facility Admin | `admin@kawempe.bulamu.ug` | `BulamuAccess2026!` | Facility dashboard, staff, invoices, reports |
| Doctor | `doctor@kawempe.bulamu.ug` | `BulamuAccess2026!` | Consultations and appointments |
| Nurse | `nurse@kawempe.bulamu.ug` | `BulamuAccess2026!` | Patients, appointments, and lab workflow |
| Pharmacist | `pharmacist@kawempe.bulamu.ug` | `BulamuAccess2026!` | Inventory and prescriptions |
| Front Desk Staff | `staff@kawempe.bulamu.ug` | `BulamuAccess2026!` | Patient registration and appointments |

These are seeded by `npm run seed` for local/dev databases only. Production admin accounts are provisioned
separately and are not documented here. Bulamu is a product of Cruze Intelligent Systems (U) Ltd. Change seeded
passwords before any real deployment, and never reuse them in a production environment.

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
- Installable PWA with service worker, app-shell caching, IndexedDB local records, offline mutation queue, and sync status badge
- Timestamp-based deterministic sync conflict resolution with tombstone deletes and a Sync Activity panel (audit log + conflict log)
- HMIS 105 outpatient reporting across 7 sections (attendance by age/gender cohort, epidemic surveillance, essential medicines, family planning, maternal health, other services, referrals)
- FHIR R4 export (Patient, Encounter, Observation resources) and a configurable DHIS2 `dataValueSets` push for interoperability work
- Password reset flow and an audit log for patient/reproductive-health/user/invoice writes
- Self-service facility registration (`/auth/register`) with a private admin approval queue - the internal admin role is never selectable in any form and has no public entry point
- 2-week free trial per approved facility, then a monthly subscription billed through Pesapal (`/billing`); a lapsed subscription blocks new writes but never blocks reading existing records
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
