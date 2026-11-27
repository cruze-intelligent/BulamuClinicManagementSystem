'use client';

import { PersonalNotes } from '@/components/personal-notes';

export default function PatientNotesPage() {
  return <PersonalNotes basePath="/patient-portal/notes" tokenKey="patientToken" patientPortal />;
}
