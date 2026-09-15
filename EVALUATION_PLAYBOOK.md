# Bulamu Two-Week Evaluation Playbook

Bulamu is a product of Cruze Intelligent Systems (U) Ltd.

## 1. Evaluation Objective

Show Bulamu as a production-grade medical facility operating system for clinics, health centres, hospitals, laboratories, pharmacies, mobile units, and community outreach teams.

The evaluation should prove four things:

- Super admins can authorize and govern facilities from God Mode.
- Facility teams can run daily patient workflows.
- The PWA keeps working during poor connectivity.
- Reports align with Uganda health-system needs and interoperability direction.

## 2. Seeded Access Credentials

Seed account:

| Role | Email | Password | Notes |
| --- | --- | --- | --- |
| Super Admin | `superadmin@bulamu.ug` | `BulamuSuperAdmin2025!` | Creates and authorizes facilities |
| Facility Admin | `admin@kawempe.bulamu.ug` | `BulamuAccess2026!` | Runs facility dashboard, staff, reports, invoices |
| Doctor | `doctor@kawempe.bulamu.ug` | `BulamuAccess2026!` | Records consultations |
| Nurse | `nurse@kawempe.bulamu.ug` | `BulamuAccess2026!` | Supports patients, appointments, and lab flow |
| Pharmacist | `pharmacist@kawempe.bulamu.ug` | `BulamuAccess2026!` | Manages inventory and medicines |
| Front Desk Staff | `staff@kawempe.bulamu.ug` | `BulamuAccess2026!` | Registers patients and appointments |

Facility admin credentials are generated during God Mode authorization. Document each evaluation facility here:

| Facility | Type | Admin Email | Temporary Password | Start | End |
| --- | --- | --- | --- | --- | --- |
| Example Medical Facility | Health Centre III | `admin@example.ug` | `ChangeMe123!` | Day 1 | Day 14 |

## 3. Walkthrough Script

1. Open `http://localhost:3000`.
2. Show the public page and request evaluation access with a selected facility type.
3. Sign in as Super Admin.
4. Open God Mode and authorize a facility.
5. Sign in as the created facility admin.
6. Complete the first-run walkthrough.
7. Register a patient (include sex, date of birth, geography, and consent).
8. Book an appointment.
9. Record a consultation and prescription.
10. Add a lab test and inventory item.
11. For a female patient, record a reproductive-health observation and confirm it appears in the patient's timeline.
12. Create a referral to another facility, then sign in as that facility's admin/doctor to accept it.
13. Sign in as Nurse/Front Desk Staff at a Community Outreach or Mobile Unit facility and log a household visit via "Household Visit" - check a danger sign and confirm the referral prompt appears.
14. Generate facility reports (Overview and HMIS 105 - confirm all 7 sections render, including the new family planning, maternal health, services, and referral sections).
15. As Admin, open Reports and use "Push to DHIS2" (requires DHIS2 integration configured first, or confirm it correctly reports "not configured yet").
16. Export FHIR patients and confirm the bundle includes Encounter and Observation resources, not just Patient.
17. Open "Sync Activity" as Admin and confirm the audit log shows the patient registration and reproductive-health entries.
18. Switch the browser offline and show local-first behavior (register a patient, log a household visit).
19. Return online and trigger manual sync.
20. As a Front Desk Staff account, use "Forgot your password?" from the login page and confirm the reset flow completes.

Before step 3, verify that PostgreSQL is reachable, migrations have been applied, and seeded access accounts exist.

## 4. Two-Week Evaluation Stages

| Stage | Days | Owner | Expected evidence |
| --- | --- | --- | --- |
| Authorization | 1 | Super Admin | Facility type selected, admin created, access confirmed |
| Training | 1-2 | Facility Admin | First-run walkthrough completed by each evaluation role |
| Daily operations | 3-7 | Facility Team | Patients, appointments, consultations, labs, inventory, and invoices captured |
| Offline resilience | 8-10 | Facility Team | Offline registration and queued sync verified |
| Reporting | 11-12 | Admin and Super Admin | HMIS 105 summary and FHIR export generated |
| Review | 13-14 | Stakeholders | Feedback, go-live risks, and production hardening list agreed |

## 5. PWA Checklist

- Manifest served at `/manifest.webmanifest`
- Service worker registered from `/sw.js`
- Install prompt visible in supported browsers
- Offline fallback page available at `/offline`
- Core routes cached after first visit
- IndexedDB stores local patient, appointment, consultation, lab, inventory, and reproductive-health data
- Sync badge shows offline, pending, syncing, and synced states
- Household visits recorded offline at `/chw-visit` sync through the same mutation queue

## 6. Research Alignment Checklist

- DHIS2-facing national aggregation: HMIS 105 reporting plus a configurable `dataValueSets` push (Reports → Push to DHIS2)
- UgandaEMR/OpenMRS interoperability: FHIR R4 export with Patient, Encounter, and Observation resources
- HMIS reporting burden: HMIS 105 monthly outpatient report across 7 sections (attendance by age/gender cohort, epidemic surveillance, essential medicines, family planning, maternal health, other tracked services, referrals out)
- Rural facility hierarchy: facility type selection, God Mode authorization, district/sub-county/parish fields, and inter-facility referrals
- Community health worker mobile capture: `/chw-visit` simplified offline triage form for Community Outreach / Mobile Unit facilities
- Offline-first architecture: PWA cache, IndexedDB, mutation queue, timestamp-based last-write-wins with logged conflicts, tombstone deletes
- Edge deployment: documented in `DEPLOYMENT.md` for micro-server scenarios
- Governance: super-admin authorization, suspension controls, and an audit log for patient/reproductive-health/user/invoice writes
- Capacity building: first-run walkthrough, Help & FAQ, and the role-specific training tracks below

## 7. Role-Specific Training Tracks

Per the research document's structured competency guidance, training is organized into three tracks:

- **Basic** (Front Desk Staff, Nurse): patient registration and consent, appointment booking, offline usage and the sync badge, household visits (Community Outreach/Mobile Unit staff).
- **Intermediate** (Doctor, Pharmacist, facility Admin): consultations and prescriptions, reproductive-health tracking, lab and inventory workflows, referrals, HMIS 105 reporting, staff management, Sync Activity review.
- **Advanced** (facility Admin, Super Admin): DHIS2 integration configuration, God Mode facility authorization, audit log review, and production go-live checklist ownership.

## 8. FAQs

**Is Bulamu only for clinics?**  
No. It supports multiple medical facility types, including health centres, hospitals, labs, pharmacies, mobile units, and outreach teams.

**Can staff use it without internet?**  
Yes. Core workflows are local-first and queued for sync.

**Who creates facility accounts?**  
The Super Admin creates and authorizes facility accounts from God Mode.

**What should evaluators test first?**  
Facility authorization, patient registration and consent, appointment booking, consultation recording, reproductive-health tracking, referrals between facilities, household visits, HMIS 105 reporting, FHIR export, DHIS2 push configuration, the Sync Activity panel, password reset, and offline sync.

**What must be completed before handling live patient data?**  
Password reset and audit logging are now implemented. Still required before go-live: real deployment secrets (rotate all seeded passwords and `JWT_SECRET`), MFA, moving the session token from `localStorage` to an httpOnly cookie, formal data-protection review, and physical/device-level security for any edge micro-server deployment.
