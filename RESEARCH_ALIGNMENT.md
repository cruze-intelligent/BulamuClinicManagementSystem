# Research Alignment

Source document: `Uganda Rural Health System Research.pdf`

The current implementation is aligned to the document outline extracted from the PDF metadata and references. This file should be updated whenever product scope changes.

## Extracted Research Themes

| Research theme | Current implementation | Remaining production depth |
| --- | --- | --- |
| National aggregation and surveillance: DHIS2 | HMIS 105 report endpoint, reports UI, and a configurable DHIS2 `dataValueSets` push (`PUT /clinics/:id/dhis2-integration`, `POST /reports/hmis-105/:id/push-dhis2`) - dormant until a facility supplies real org-unit credentials | Live validation against a real district DHIS2 instance; OpenHIM-mediated routing rather than a direct push |
| Facility-level EMR: OpenMRS, Bahmni, UgandaEMR | FHIR R4 export now includes `Patient`, `Encounter` (consultations), and `Observation` (LOINC-coded reproductive health) resources | Full OpenHIM interoperability-layer workflow; CIEL/ICD-10 terminology mapping on diagnoses |
| Frontline data capture | Patient registration (with demographics, geography, consent), appointments, consultations, lab, inventory, reproductive-health tracking | Community health-worker mobile mode - **implemented**: `/chw-visit` simplified triage form for `COMMUNITY_OUTREACH`/`MOBILE_UNIT` facilities, offline-first |
| Facility hierarchy and service distribution | Facility type enum, Super Admin authorization, `Clinic` district/sub-county/parish fields, `parentFacilityId` hierarchy, and a `Referral` model/routes (`/referrals`) for HC II→III→IV referral paths | Referral outcome analytics; auto-suggested referral facility by hierarchy |
| HMIS reporting burden | HMIS 105 now covers 7 sections: age/gender-cohort attendance, epidemic surveillance, essential medicines, family planning, maternal health, HIV-testing/SMC/community-visit service tags, and referrals out | Remaining HMIS 105 sub-sections (ANC visit counts, full financial summary) and HMIS 108/033b forms |
| Offline-first/local-first architecture | PWA service worker, IndexedDB stores, mutation queue, sync badge, plus a Sync Activity panel (`/sync-activity`) surfacing conflicts and an audit trail | Full CRDT/vector-clock merge (current approach: deterministic last-write-wins by timestamp, not arrival order, with conflicts logged rather than silently discarded) |
| Deterministic conflict resolution | Timestamp-based last-write-wins (an older edit arriving after a newer one is rejected and logged to `SyncConflictLog`, not silently overwritten); tombstone (`deletedAt`) soft-deletes replace hard deletes across all synced entities | CRDT/vector-clock causal ordering for true field-level concurrent merges |
| Edge computing and hardware optimization | Docker and edge micro-server deployment path (`DEPLOYMENT.md`) | Device provisioning scripts and backup automation |
| Governance and change management | God Mode authorization, suspension, role-based access, `AuditLog` for Patient/ReproductiveHealthRecord/User/Invoice writes | Approval workflows, billing state, formal compliance reports |
| Capacity building | First-run walkthrough, Help & FAQ, evaluation playbook | In-app role-specific training modules (Basic/Intermediate/Advanced tracks) |
| Security and privacy safeguards | JWT auth (12h expiry), tenant-isolated role guards, password reset flow, patient consent capture (`consentGivenAt`/`consentGivenBy`), DHIS2 credentials encrypted at rest (AES-256-GCM) | MFA; JWT moved from `localStorage` to an httpOnly cookie; device-level disk encryption (an ops/provisioning concern, not app code) |
| Closing clinician feedback loops | Dashboards, reports, sync state, searchable history, Sync Activity panel | Facility feedback metrics, survival-analysis-style at-risk patient flagging, quality-improvement dashboard |

## Test Coverage

Backend: `apps/backend/test/` - Vitest against a real, ephemeral Postgres (via `embedded-postgres`, no Docker/system install required; `npm test` from `apps/backend`). 20 test files / 83 tests covering, per route module, at minimum a success path, a cross-clinic-403 regression case, and role-gate checks; the sync engine additionally covers mutation-scope rejection, upsert-ownership bypass, timestamp-based conflict logging, and tombstone deletes.

Frontend: `apps/frontend/lib/*.test.ts` - Vitest + Testing Library for logic-bearing pure functions (age/HMIS-cohort calculation, reproductive-health form validation, CHW visit summary building). End-to-end user flows remain covered by the manual walkthrough in `EVALUATION_PLAYBOOK.md`.

CI: `.github/workflows/ci.yml` runs type-checking, the full test suites, and both production builds on every push.

## Evaluation Definition of Done

- Super Admin can sign in and view God Mode.
- Super Admin can authorize a facility and choose facility type.
- Facility admin can sign in and complete first-run walkthrough.
- Staff can register patients (with demographics and consent) and continue offline.
- Clinicians can show clinical encounter flow, including reproductive-health tracking for female patients.
- A clinician can refer a patient to another facility and the receiving facility can see and act on it.
- A community outreach worker can log a household visit offline via `/chw-visit`.
- Admin can generate HMIS 105 (7 sections) and FHIR export, and can configure/trigger a DHIS2 push.
- Admin can view the Sync Activity panel (audit log + sync conflicts).
- PWA install, offline fallback, and sync badge are visible.
- Documentation includes seeded access credentials, staged walkthrough, FAQ, Cruze ownership, and deployment notes.
