# Research Alignment

Source document: `Uganda Rural Health System Research.pdf`

The current implementation is aligned to the document outline extracted from the PDF metadata and references. This file should be updated whenever product scope changes.

## Extracted Research Themes

| Research theme | Current implementation | Remaining production depth |
| --- | --- | --- |
| National aggregation and surveillance: DHIS2 | HMIS 105 report endpoint and reports UI | Direct DHIS2 API/package mapping |
| Facility-level EMR: OpenMRS, Bahmni, UgandaEMR | FHIR R4 patient bundle export | Import/export validation and OpenHIM workflow |
| Frontline data capture | Patient registration, appointments, consultations, lab, inventory | Community health-worker mobile mode |
| Facility hierarchy and service distribution | Facility type enum and Super Admin authorization | District/regional grouping and referral paths |
| HMIS reporting burden | Monthly outpatient report and epidemic categories | Full official form coverage and submission workflow |
| Offline-first/local-first architecture | PWA service worker, IndexedDB stores, mutation queue, sync badge | Conflict UI, audit trail, and retry dashboard |
| Deterministic conflict resolution | Last-write-wins push/pull sync foundation | CRDT or field-level conflict policy |
| Edge computing and hardware optimization | Docker and edge micro-server deployment path | Device provisioning scripts and backup automation |
| Governance and change management | God Mode authorization, suspension, role-based access | Audit logs, approvals, billing state, and compliance reports |
| Capacity building | First-run walkthrough, Help & FAQ, evaluation playbook | In-app role-specific training modules |
| Security and privacy safeguards | JWT auth, role guards, local protected workflows | Password reset, MFA, encryption policy, logs, consent, retention |
| Closing clinician feedback loops | Dashboards, reports, sync state, searchable history | Facility feedback metrics and quality-improvement dashboard |

## Evaluation Definition of Done

- Super Admin can sign in and view God Mode.
- Super Admin can authorize a facility and choose facility type.
- Facility admin can sign in and complete first-run walkthrough.
- Staff can register patients and continue offline.
- Clinicians can show clinical encounter flow.
- Admin can generate HMIS 105 and FHIR export.
- PWA install, offline fallback, and sync badge are visible.
- Documentation includes seeded access credentials, staged walkthrough, FAQ, Cruze ownership, and deployment notes.
