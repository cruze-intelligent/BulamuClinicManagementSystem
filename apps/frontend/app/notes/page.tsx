'use client';

import { PersonalNotes } from '@/components/personal-notes';

export default function NotesPage() {
  return (
    <div className="min-h-screen bg-slate-50 p-4 dark:bg-slate-950 sm:p-8">
      <PersonalNotes />
    </div>
  );
}
