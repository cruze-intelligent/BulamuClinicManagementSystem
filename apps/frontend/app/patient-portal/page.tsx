'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// bulamu.site/patient-portal is the address people remember. The portal's
// layout already sends anyone not signed in to the sign-in page; a signed-in
// patient goes straight to their records.
export default function PatientPortalHome() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/patient-portal/dashboard');
  }, [router]);
  return null;
}
