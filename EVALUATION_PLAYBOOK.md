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
7. Register a patient.
8. Book an appointment.
9. Record a consultation and prescription.
10. Add a lab test and inventory item.
11. Generate facility reports.
12. Export FHIR patients.
13. Switch the browser offline and show local-first behavior.
14. Return online and trigger manual sync.

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
- IndexedDB stores local patient, appointment, consultation, lab, and inventory data
- Sync badge shows offline, pending, syncing, and synced states

## 6. Research Alignment Checklist

- DHIS2-facing national aggregation: covered through reporting direction and export readiness
- UgandaEMR/OpenMRS interoperability: covered through FHIR R4 patient bundle export
- HMIS reporting burden: covered through HMIS 105 monthly outpatient report
- Rural facility hierarchy: covered through facility type selection and God Mode authorization
- Offline-first architecture: covered through PWA cache, IndexedDB, and mutation queue
- Edge deployment: documented in `DEPLOYMENT.md` for micro-server scenarios
- Governance: covered through super-admin authorization and suspension controls
- Capacity building: covered through first-run walkthrough and Help & FAQ

## 7. FAQs

**Is Bulamu only for clinics?**  
No. It supports multiple medical facility types, including health centres, hospitals, labs, pharmacies, mobile units, and outreach teams.

**Can staff use it without internet?**  
Yes. Core workflows are local-first and queued for sync.

**Who creates facility accounts?**  
The Super Admin creates and authorizes facility accounts from God Mode.

**What should evaluators test first?**  
Facility authorization, patient registration, appointment booking, consultation recording, HMIS 105 reporting, FHIR export, and offline sync.

**What must be completed before handling live patient data?**  
Complete security hardening, audit logging, password reset, real deployment secrets, vulnerability remediation, and formal data-protection review.
