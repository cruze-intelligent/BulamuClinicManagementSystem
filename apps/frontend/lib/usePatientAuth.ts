// Deliberately separate localStorage keys from the staff session
// (token/user) so a patient session can never collide with, or be read by,
// any of the ~20 places in this app that read the staff keys directly.
const TOKEN_KEY = 'patientToken';
const ACCOUNT_KEY = 'patientAccount';

export type PatientAccount = {
  portableId: string;
  email: string;
  phone: string;
};

export function usePatientAuth() {
  if (typeof window === 'undefined') return { token: null, account: null as PatientAccount | null };

  const token = localStorage.getItem(TOKEN_KEY);
  const account = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null') as PatientAccount | null;

  return { token, account };
}

export function savePatientSession(token: string, account: PatientAccount) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export function clearPatientSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
}
