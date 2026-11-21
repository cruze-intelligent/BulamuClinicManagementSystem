import type { Allergy, AllergyStatus } from "./allergy";
import { assertCanSave, markSubscriptionLapsed, SubscriptionRequiredError } from "./subscription-state";
import { rememberServerTime, serverNowIso } from "./time";
import { rememberDepartments } from "./departments";

export type LocalPatient = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  sex?: "FEMALE" | "MALE" | "OTHER";
  dateOfBirth?: string;
  /** The date of birth was worked out from an age the patient gave. */
  dateOfBirthEstimated?: boolean;
  /** The facility's Patient ID, given by the server once the record reaches it. */
  patientNumber?: number | null;
  village?: string;
  parish?: string;
  subCounty?: string;
  district?: string;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  consentGivenAt?: string;
  consentGivenBy?: string;
  /** UNKNOWN until someone asks; NONE_KNOWN; or KNOWN with the list below. */
  allergyStatus?: AllergyStatus;
  allergies?: Allergy[] | null;
  allergiesUpdatedAt?: string | null;
  clinicId: string;
  createdAt: string;
  updatedAt: string;
  /** Set when an administrator deleted the patient; such patients are never listed. */
  deletedAt?: string | null;
  syncStatus: "pending" | "synced" | "failed";
};

export type LocalAppointment = {
  id: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  date: string;
  time: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  notes?: string;
  /** When the patient arrived and joined the waiting queue. */
  checkedInAt?: string | null;
  /** Stepped out of the queue for a while; they keep their place by arrival time. */
  awayAt?: string | null;
  /** The unit (department) the visit is in - its own queue. Empty: the facility works as one. */
  departmentId?: string | null;
  patient?: { name: string; phone: string };
  doctor?: { name: string };
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced" | "failed";
};

export type LocalPrescription = {
  id?: string;
  medication: string;
  strength?: string | null;
  form?: string | null;
  dosage: string;
  route?: string | null;
  frequency: string;
  duration: string;
  quantity?: number | null;
  instructions?: string | null;
  medicineId?: string | null;
  /** Prescribed despite a recorded allergy the prescriber saw and acknowledged. */
  allergyOverride?: boolean;
  dispensedAt?: string | null;
  dispensedBy?: { name: string } | null;
};

export type LocalDiagnosis = {
  id?: string;
  icd10Code?: string | null;
  description: string;
  type: "PRIMARY" | "SECONDARY";
  certainty: "CONFIRMED" | "PROVISIONAL";
  notes?: string | null;
};

export type LocalConsultation = {
  id: string;
  appointmentId: string;
  patientId: string;
  /** The primary diagnosis's name - kept for older records and simple lists. */
  diagnosis: string;
  /** Every diagnosis, primary first. Absent on records made before structured diagnoses. */
  diagnoses?: LocalDiagnosis[];
  symptoms: string;
  /** History of the presenting illness and relevant past, drug, family and social history. */
  history?: string | null;
  /** Examination findings. */
  examination?: string | null;
  /** Vital signs taken at the visit. */
  vitals?: Record<string, number> | null;
  clinicalNotes?: string | null;
  serviceTags?: string[];
  prescriptions: LocalPrescription[];
  /** Saved with tests or imaging sent; the diagnosis and prescription come when the results are in. */
  awaitingResults?: boolean;
  patient?: { name: string; phone: string };
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced" | "failed";
};

export type LocalLabTest = {
  id: string;
  patientId: string;
  consultationId?: string;
  testName: string;
  results: string;
  status: "PENDING" | "COMPLETED" | "CANCELLED";
  orderedBy: string;
  completedAt?: string;
  /** Who entered the result, and the clinician who verified it (released it to the patient). */
  resultedBy?: { name: string; role: string } | null;
  resultedAt?: string | null;
  verifiedBy?: { name: string; role: string } | null;
  verifiedAt?: string | null;
  /** A result entered value by value, with reference ranges and flags, and the lab's comment. */
  values?: import("./lab-panels").LabValue[] | null;
  comment?: string | null;
  patient?: { name: string; phone: string; sex?: string | null; dateOfBirth?: string | null };
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced" | "failed";
};

export type LocalMedicine = {
  id: string;
  clinicId: string;
  name: string;
  quantity: number;
  unit: string;
  reorderLevel: number;
  price: number;
  /** The soonest expiry among the batches on the shelf. */
  expiryDate?: string | null;
  /** How much of what is on the shelf has expired (from the server). */
  expiredQuantity?: number;
  batches?: Array<{ id: string; quantity: number; expiryDate: string | null; receivedAt: string; supplier: string | null }>;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced" | "failed";
};

export type LocalReproductiveHealthRecord = {
  id: string;
  patientId: string;
  recordedById?: string;
  lastMenstrualPeriodDate?: string;
  cycleLengthDays?: number;
  flowDurationDays?: number;
  familyPlanningMethod: "NONE" | "CONDOM" | "PILL" | "INJECTABLE" | "IMPLANT" | "IUD" | "NATURAL" | "PERMANENT" | "OTHER";
  pregnancyStatus: "UNKNOWN" | "NOT_PREGNANT" | "PREGNANT" | "POSTPARTUM";
  gravida?: number;
  para?: number;
  notes?: string;
  recordedBy?: { name: string };
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced" | "failed";
};

export type LocalMutation = {
  id: string;
  entity: "patient" | "patientAllergies" | "appointment" | "consultation" | "labTest" | "imagingRequest" | "inventory" | "reproductiveHealth";
  action: "upsert" | "delete";
  recordId: string;
  clinicId: string;
  payload: any;
  createdAt: string;
  attempts: number;
};

type StoredUser = {
  id?: string;
  clinicId?: string;
  name?: string;
};

const DB_NAME = "bulamu-local-first";
const DB_VERSION = 3;

const PATIENT_STORE = "patients";
const APPOINTMENT_STORE = "appointments";
const CONSULTATION_STORE = "consultations";
const LAB_STORE = "lab_tests";
const INVENTORY_STORE = "inventory";
const MUTATION_STORE = "mutations";
const REPRODUCTIVE_HEALTH_STORE = "reproductive_health";

const LOCAL_CHANGE_EVENT = "bulamu-local-change";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getApiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
}

function getAuthHeaders() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function getCurrentUser(): StoredUser {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem("user") || "{}");
  } catch {
    return {};
  }
}

export function getCurrentClinicId(): string | undefined {
  return getCurrentUser().clinicId;
}

function emitLocalChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
  }
}

export function subscribeToLocalChanges(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(LOCAL_CHANGE_EVENT, callback);
  return () => window.removeEventListener(LOCAL_CHANGE_EVENT, callback);
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(PATIENT_STORE)) {
        const store = db.createObjectStore(PATIENT_STORE, { keyPath: "id" });
        store.createIndex("clinicId", "clinicId");
        store.createIndex("syncStatus", "syncStatus");
      }

      if (!db.objectStoreNames.contains(APPOINTMENT_STORE)) {
        const store = db.createObjectStore(APPOINTMENT_STORE, { keyPath: "id" });
        store.createIndex("clinicId", "clinicId");
        store.createIndex("patientId", "patientId");
      }

      if (!db.objectStoreNames.contains(CONSULTATION_STORE)) {
        const store = db.createObjectStore(CONSULTATION_STORE, { keyPath: "id" });
        store.createIndex("patientId", "patientId");
      }

      if (!db.objectStoreNames.contains(LAB_STORE)) {
        const store = db.createObjectStore(LAB_STORE, { keyPath: "id" });
        store.createIndex("patientId", "patientId");
      }

      if (!db.objectStoreNames.contains(INVENTORY_STORE)) {
        const store = db.createObjectStore(INVENTORY_STORE, { keyPath: "id" });
        store.createIndex("clinicId", "clinicId");
      }

      if (!db.objectStoreNames.contains(MUTATION_STORE)) {
        const store = db.createObjectStore(MUTATION_STORE, { keyPath: "id" });
        store.createIndex("clinicId", "clinicId");
        store.createIndex("createdAt", "createdAt");
      }

      if (!db.objectStoreNames.contains(REPRODUCTIVE_HEALTH_STORE)) {
        const store = db.createObjectStore(REPRODUCTIVE_HEALTH_STORE, { keyPath: "id" });
        store.createIndex("patientId", "patientId");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRecord<T>(storeName: string, record: T) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  await requestToPromise(tx.objectStore(storeName).put(record));
  db.close();
}

async function getRecord<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  const record = await requestToPromise<T>(tx.objectStore(storeName).get(key));
  db.close();
  return record;
}

async function deleteRecord(storeName: string, key: string) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  await requestToPromise(tx.objectStore(storeName).delete(key));
  db.close();
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  const records = await requestToPromise<T[]>(tx.objectStore(storeName).getAll());
  db.close();
  return records;
}

export async function countPendingMutations(): Promise<number> {
  const mutations = await getAllRecords<LocalMutation>(MUTATION_STORE);
  return mutations.length;
}

/* ================= PATIENTS ================= */

export async function listLocalPatients(clinicId: string): Promise<LocalPatient[]> {
  const patients = await getAllRecords<LocalPatient>(PATIENT_STORE);
  return patients
    .filter((p) => p.clinicId === clinicId && !p.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getLocalAppointment(id: string): Promise<LocalAppointment | undefined> {
  return getRecord<LocalAppointment>(APPOINTMENT_STORE, id);
}

export async function getLocalPatientById(id: string): Promise<LocalPatient | undefined> {
  return getRecord<LocalPatient>(PATIENT_STORE, id);
}

/** Drops a patient an administrator deleted from this device's copy. */
export async function removeLocalPatient(id: string) {
  await deleteRecord(PATIENT_STORE, id);
  emitLocalChange();
}

/**
 * The server's copies worth keeping: not one older than this device's synced
 * copy. A list that left the server before a change made here (a price edited,
 * a result entered) arrives after it, and used to put the old values back.
 */
async function newerThanHere<T extends { id: string; updatedAt?: string | null }>(storeName: string, items: T[]): Promise<T[]> {
  if (!items.length) return items;
  return notOlderThan(items, await getAllRecords<{ id: string; updatedAt?: string | null; syncStatus?: string }>(storeName));
}

/**
 * The server copies not older than the device's synced copy of the same record.
 * A record saved here and not sent yet (or refused) is still replaced: the server's is the truth then.
 */
export function notOlderThan<T extends { id: string; updatedAt?: string | null }>(
  items: T[],
  here: Array<{ id: string; updatedAt?: string | null; syncStatus?: string }>,
): T[] {
  const mine = new Map(here.map((r) => [r.id, r]));
  return items.filter((item) => {
    const local = mine.get(item.id);
    if (!local || local.syncStatus !== "synced" || !local.updatedAt || !item.updatedAt) return true;
    return Date.parse(String(item.updatedAt)) >= Date.parse(String(local.updatedAt));
  });
}

export async function cachePatients(patients: Array<Omit<LocalPatient, "syncStatus">>) {
  patients = await newerThanHere(PATIENT_STORE, patients);
  await Promise.all(
    patients.map((patient) =>
      putRecord<LocalPatient>(PATIENT_STORE, {
        ...patient,
        syncStatus: "synced",
      })
    )
  );
  emitLocalChange();
}

export async function refreshPatientsFromServer(clinicId: string): Promise<LocalPatient[]> {
  const apiUrl = getApiUrl();
  if (!apiUrl) {
    return listLocalPatients(clinicId);
  }

  const response = await fetch(`${apiUrl}/patients/${encodeURIComponent(clinicId)}`, {
    headers: getAuthHeaders(),
  });
  const data = await response.json();

  if (!response.ok || !data.success || !Array.isArray(data.patients)) {
    throw new Error(data.error || "Unable to refresh patients");
  }

  await cachePatients(data.patients);
  return listLocalPatients(clinicId);
}

export async function createPatientOffline(input: {
  name: string;
  phone: string;
  email?: string;
  clinicId: string;
  sex?: LocalPatient["sex"];
  dateOfBirth?: string;
  dateOfBirthEstimated?: boolean;
  village?: string;
  parish?: string;
  subCounty?: string;
  district?: string;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  consentGiven?: boolean;
}): Promise<LocalPatient> {
  await assertCanSave();
  const now = serverNowIso();
  const patient: LocalPatient = {
    id: createId(),
    name: input.name,
    phone: input.phone,
    email: input.email,
    sex: input.sex,
    dateOfBirth: input.dateOfBirth,
    dateOfBirthEstimated: !!input.dateOfBirth && !!input.dateOfBirthEstimated,
    village: input.village,
    parish: input.parish,
    subCounty: input.subCounty,
    district: input.district,
    nextOfKinName: input.nextOfKinName,
    nextOfKinPhone: input.nextOfKinPhone,
    consentGivenAt: input.consentGiven ? now : undefined,
    consentGivenBy: input.consentGiven ? getCurrentUser().id : undefined,
    clinicId: input.clinicId,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };

  const mutation: LocalMutation = {
    id: createId(),
    entity: "patient",
    action: "upsert",
    recordId: patient.id,
    clinicId: patient.clinicId,
    payload: {
      id: patient.id,
      name: patient.name,
      phone: patient.phone,
      email: patient.email,
      sex: patient.sex,
      dateOfBirth: patient.dateOfBirth,
      dateOfBirthEstimated: patient.dateOfBirthEstimated,
      village: patient.village,
      parish: patient.parish,
      subCounty: patient.subCounty,
      district: patient.district,
      nextOfKinName: patient.nextOfKinName,
      nextOfKinPhone: patient.nextOfKinPhone,
      consentGiven: Boolean(input.consentGiven),
      clinicId: patient.clinicId,
      createdAt: patient.createdAt,
      updatedAt: patient.updatedAt,
    },
    createdAt: now,
    attempts: 0,
  };

  await putRecord(PATIENT_STORE, patient);
  await putRecord(MUTATION_STORE, mutation);
  emitLocalChange();

  if (typeof navigator !== "undefined" && navigator.onLine) {
    flushSyncQueue().catch(console.error);
  }

  return patient;
}

/**
 * Records a patient's allergies. Saved on the device at once and sent to the
 * server as its own change (not as part of the whole patient), so it works
 * offline and can never overwrite anything else on the patient.
 */
export async function saveAllergiesOffline(input: {
  patientId: string;
  clinicId: string;
  allergyStatus: AllergyStatus;
  allergies: Allergy[];
}): Promise<LocalPatient | undefined> {
  await assertCanSave();
  const now = serverNowIso();
  const existing = await getRecord<LocalPatient>(PATIENT_STORE, input.patientId);
  const updated: LocalPatient | undefined = existing
    ? {
        ...existing,
        allergyStatus: input.allergyStatus,
        allergies: input.allergyStatus === "KNOWN" ? input.allergies : null,
        allergiesUpdatedAt: now,
        syncStatus: "pending",
      }
    : undefined;

  const mutation: LocalMutation = {
    id: createId(),
    entity: "patientAllergies",
    action: "upsert",
    recordId: input.patientId,
    clinicId: input.clinicId,
    payload: { id: input.patientId, allergyStatus: input.allergyStatus, allergies: input.allergies, updatedAt: now },
    createdAt: now,
    attempts: 0,
  };

  if (updated) await putRecord(PATIENT_STORE, updated);
  await putRecord(MUTATION_STORE, mutation);
  emitLocalChange();

  if (typeof navigator !== "undefined" && navigator.onLine) {
    flushSyncQueue().catch(console.error);
  }

  return updated;
}

/* ================= APPOINTMENTS ================= */

export async function listLocalAppointments(clinicId: string): Promise<LocalAppointment[]> {
  const appointments = await getAllRecords<LocalAppointment>(APPOINTMENT_STORE);
  return appointments
    .filter((a) => a.clinicId === clinicId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function cacheAppointments(appointments: Array<Omit<LocalAppointment, "syncStatus">>) {
  appointments = await newerThanHere(APPOINTMENT_STORE, appointments);
  await Promise.all(
    appointments.map((appointment) =>
      putRecord<LocalAppointment>(APPOINTMENT_STORE, {
        ...appointment,
        syncStatus: "synced",
      })
    )
  );
  emitLocalChange();
}

export async function createAppointmentOffline(input: {
  patientId: string;
  doctorId: string;
  clinicId: string;
  date: string;
  time: string;
  notes?: string;
  patientName?: string;
  doctorName?: string;
  /** A walk-in joins the waiting queue at once. */
  checkedInAt?: string;
  /** The unit the patient is booked into. */
  departmentId?: string | null;
}): Promise<LocalAppointment> {
  await assertCanSave();
  const now = serverNowIso();
  const appointment: LocalAppointment = {
    id: createId(),
    patientId: input.patientId,
    doctorId: input.doctorId,
    clinicId: input.clinicId,
    date: input.date,
    time: input.time,
    status: "SCHEDULED",
    notes: input.notes,
    checkedInAt: input.checkedInAt ?? null,
    departmentId: input.departmentId || null,
    patient: input.patientName ? { name: input.patientName, phone: "" } : undefined,
    doctor: input.doctorName ? { name: input.doctorName } : undefined,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };

  const mutation: LocalMutation = {
    id: createId(),
    entity: "appointment",
    action: "upsert",
    recordId: appointment.id,
    clinicId: appointment.clinicId,
    payload: {
      id: appointment.id,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      clinicId: appointment.clinicId,
      date: appointment.date,
      time: appointment.time,
      status: appointment.status,
      notes: appointment.notes,
      checkedInAt: appointment.checkedInAt,
      departmentId: appointment.departmentId ?? null,
      createdAt: appointment.createdAt,
      updatedAt: appointment.updatedAt,
    },
    createdAt: now,
    attempts: 0,
  };

  await putRecord(APPOINTMENT_STORE, appointment);
  await putRecord(MUTATION_STORE, mutation);
  emitLocalChange();

  if (typeof navigator !== "undefined" && navigator.onLine) {
    flushSyncQueue().catch(console.error);
  }

  return appointment;
}

/**
 * Records a change to an appointment made on this device - the patient
 * arriving (checked in, joining the queue), or being seen - and sends it.
 */
export async function updateAppointmentOffline(
  appointment: LocalAppointment,
  change: Partial<Pick<LocalAppointment, "status" | "checkedInAt" | "awayAt" | "departmentId" | "date" | "time">>,
): Promise<LocalAppointment> {
  await assertCanSave();
  const now = serverNowIso();
  const updated: LocalAppointment = { ...appointment, ...change, updatedAt: now, syncStatus: "pending" };
  const mutation: LocalMutation = {
    id: createId(),
    entity: "appointment",
    action: "upsert",
    recordId: updated.id,
    clinicId: updated.clinicId,
    payload: {
      id: updated.id, patientId: updated.patientId, doctorId: updated.doctorId, clinicId: updated.clinicId,
      date: updated.date, time: updated.time, status: updated.status, notes: updated.notes,
      checkedInAt: updated.checkedInAt ?? null, awayAt: updated.awayAt ?? null, departmentId: updated.departmentId ?? null,
      createdAt: updated.createdAt, updatedAt: updated.updatedAt,
    },
    createdAt: now,
    attempts: 0,
  };
  await putRecord(APPOINTMENT_STORE, updated);
  await putRecord(MUTATION_STORE, mutation);
  emitLocalChange();
  if (typeof navigator !== "undefined" && navigator.onLine) {
    flushSyncQueue().catch(console.error);
  }
  return updated;
}

/* ================= CONSULTATIONS ================= */

export async function listLocalConsultations(): Promise<LocalConsultation[]> {
  const consultations = await getAllRecords<LocalConsultation>(CONSULTATION_STORE);
  return consultations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function cacheConsultations(consultations: Array<Omit<LocalConsultation, "syncStatus">>) {
  await Promise.all(
    consultations.map((c) =>
      putRecord<LocalConsultation>(CONSULTATION_STORE, {
        ...c,
        syncStatus: "synced",
      })
    )
  );
  emitLocalChange();
}

export async function createConsultationOffline(input: {
  appointmentId: string;
  patientId: string;
  clinicId: string;
  /** Structured diagnoses, primary first. */
  diagnoses: LocalDiagnosis[];
  symptoms: string;
  history?: string;
  examination?: string;
  vitals?: Record<string, number> | null;
  clinicalNotes?: string;
  serviceTags?: string[];
  prescriptions: LocalPrescription[];
  /** Consultation fee in UGX - becomes the facility's invoice to the patient. */
  fee?: number;
  patientName?: string;
  /** Going on with a visit saved earlier (one that waited for results): the same record, updated. */
  id?: string;
  createdAt?: string;
  /** Tests or imaging sent; the diagnosis and prescription to come when the results are in. */
  awaitingResults?: boolean;
}): Promise<LocalConsultation> {
  await assertCanSave();
  const now = serverNowIso();
  const primary = input.diagnoses.find((d) => d.type === "PRIMARY") ?? input.diagnoses[0];
  const consultation: LocalConsultation = {
    id: input.id ?? createId(),
    appointmentId: input.appointmentId,
    patientId: input.patientId,
    diagnosis: primary?.description ?? "",
    diagnoses: input.diagnoses,
    symptoms: input.symptoms,
    history: input.history || null,
    examination: input.examination || null,
    vitals: input.vitals && Object.keys(input.vitals).length ? input.vitals : null,
    clinicalNotes: input.clinicalNotes || null,
    serviceTags: input.serviceTags,
    prescriptions: input.prescriptions,
    awaitingResults: input.awaitingResults === true,
    patient: input.patientName ? { name: input.patientName, phone: "" } : undefined,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    syncStatus: "pending",
  };

  const mutation: LocalMutation = {
    id: createId(),
    entity: "consultation",
    action: "upsert",
    recordId: consultation.id,
    clinicId: input.clinicId,
    payload: {
      id: consultation.id,
      appointmentId: consultation.appointmentId,
      patientId: consultation.patientId,
      diagnosis: consultation.diagnosis,
      diagnoses: consultation.diagnoses,
      symptoms: consultation.symptoms,
      history: consultation.history,
      examination: consultation.examination,
      vitals: consultation.vitals,
      clinicalNotes: consultation.clinicalNotes,
      serviceTags: consultation.serviceTags || [],
      prescriptions: consultation.prescriptions,
      awaitingResults: consultation.awaitingResults,
      ...(input.fee ? { fee: input.fee } : {}),
      createdAt: consultation.createdAt,
      updatedAt: consultation.updatedAt,
    },
    createdAt: now,
    attempts: 0,
  };

  await putRecord(CONSULTATION_STORE, consultation);
  await putRecord(MUTATION_STORE, mutation);
  // Seen: the patient leaves the waiting queue on this device too (the server does the same).
  const seen = await getRecord<LocalAppointment>(APPOINTMENT_STORE, consultation.appointmentId).catch(() => undefined);
  if (seen && seen.status === "SCHEDULED") await putRecord(APPOINTMENT_STORE, { ...seen, status: "COMPLETED" as const });
  emitLocalChange();

  if (typeof navigator !== "undefined" && navigator.onLine) {
    flushSyncQueue().catch(console.error);
  }

  return consultation;
}

/* ================= LAB TESTS ================= */

export async function listLocalLabTests(): Promise<LocalLabTest[]> {
  const tests = await getAllRecords<LocalLabTest>(LAB_STORE);
  return tests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function cacheLabTests(tests: Array<Omit<LocalLabTest, "syncStatus">>) {
  tests = await newerThanHere(LAB_STORE, tests);
  await Promise.all(
    tests.map((t) =>
      putRecord<LocalLabTest>(LAB_STORE, {
        ...t,
        syncStatus: "synced",
      })
    )
  );
  emitLocalChange();
}

export async function createLabTestOffline(input: {
  patientId: string;
  clinicId: string;
  testName: string;
  results: string;
  orderedBy: string;
  consultationId?: string;
  patientName?: string;
}): Promise<LocalLabTest> {
  await assertCanSave();
  const now = serverNowIso();
  const labTest: LocalLabTest = {
    id: createId(),
    patientId: input.patientId,
    consultationId: input.consultationId,
    testName: input.testName,
    results: input.results,
    status: "PENDING",
    orderedBy: input.orderedBy,
    patient: input.patientName ? { name: input.patientName, phone: "" } : undefined,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };

  const mutation: LocalMutation = {
    id: createId(),
    entity: "labTest",
    action: "upsert",
    recordId: labTest.id,
    clinicId: input.clinicId,
    payload: {
      id: labTest.id,
      patientId: labTest.patientId,
      consultationId: labTest.consultationId,
      testName: labTest.testName,
      results: labTest.results,
      status: labTest.status,
      orderedBy: labTest.orderedBy,
      createdAt: labTest.createdAt,
      updatedAt: labTest.updatedAt,
    },
    createdAt: now,
    attempts: 0,
  };

  await putRecord(LAB_STORE, labTest);
  await putRecord(MUTATION_STORE, mutation);
  emitLocalChange();

  if (typeof navigator !== "undefined" && navigator.onLine) {
    flushSyncQueue().catch(console.error);
  }

  return labTest;
}

/**
 * Imaging requested at a visit (an X-ray, a scan...): sent with the visit, from
 * this device even offline. It is kept on the server only - the Imaging page and
 * the clinical summary show it once it has arrived.
 */
export async function createImagingRequestOffline(input: {
  patientId: string;
  clinicId: string;
  consultationId?: string;
  modality: string;
  examination: string;
  clinicalInfo?: string;
  urgent?: boolean;
  /** Who asked for it, when entered on someone's behalf; the person signed in otherwise. */
  requestedBy?: string;
}): Promise<void> {
  await assertCanSave();
  const now = serverNowIso();
  const id = createId();
  const mutation: LocalMutation = {
    id: createId(),
    entity: "imagingRequest",
    action: "upsert",
    recordId: id,
    clinicId: input.clinicId,
    payload: {
      id, patientId: input.patientId, consultationId: input.consultationId ?? null, modality: input.modality,
      examination: input.examination, clinicalInfo: input.clinicalInfo ?? "", urgent: !!input.urgent, requestedBy: input.requestedBy || undefined, createdAt: now, updatedAt: now,
    },
    createdAt: now,
    attempts: 0,
  };
  await putRecord(MUTATION_STORE, mutation);
  emitLocalChange();
  if (typeof navigator !== "undefined" && navigator.onLine) {
    flushSyncQueue().catch(console.error);
  }
}

/* ================= INVENTORY / MEDICINES ================= */

export async function listLocalInventory(clinicId: string): Promise<LocalMedicine[]> {
  const items = await getAllRecords<LocalMedicine>(INVENTORY_STORE);
  return items
    .filter((item) => item.clinicId === clinicId && !item.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function cacheInventory(items: Array<Omit<LocalMedicine, "syncStatus">>) {
  // A discontinued item always leaves; otherwise an older copy does not replace this device's.
  const fresh = await newerThanHere(INVENTORY_STORE, items.filter((item) => !item.deletedAt));
  items = [...items.filter((item) => item.deletedAt), ...fresh];
  await Promise.all(
    items.map((item) =>
      // A discontinued item leaves this device's copy too.
      item.deletedAt
        ? deleteRecord(INVENTORY_STORE, item.id)
        : putRecord<LocalMedicine>(INVENTORY_STORE, {
            ...item,
            syncStatus: "synced",
          })
    )
  );
  emitLocalChange();
}

/**
 * The facility's full stock list as the server has it now: replaces this
 * device's copy, keeping only items added here and not yet sent.
 */
export async function replaceInventory(clinicId: string, items: Array<Omit<LocalMedicine, "syncStatus">>) {
  const current = await getAllRecords<LocalMedicine>(INVENTORY_STORE);
  const fresh = new Set(items.map((item) => item.id));
  await Promise.all(
    current
      .filter((item) => item.clinicId === clinicId && item.syncStatus !== "pending" && !fresh.has(item.id))
      .map((item) => deleteRecord(INVENTORY_STORE, item.id))
  );
  await cacheInventory(items);
}

export async function addMedicineOffline(input: {
  clinicId: string;
  name: string;
  quantity: number;
  unit: string;
  reorderLevel: number;
  price: number;
  expiryDate?: string;
}): Promise<LocalMedicine> {
  await assertCanSave();
  const now = serverNowIso();
  const medicine: LocalMedicine = {
    id: createId(),
    clinicId: input.clinicId,
    name: input.name,
    quantity: Number(input.quantity),
    unit: input.unit,
    reorderLevel: Number(input.reorderLevel),
    price: Number(input.price),
    expiryDate: input.expiryDate,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };

  const mutation: LocalMutation = {
    id: createId(),
    entity: "inventory",
    action: "upsert",
    recordId: medicine.id,
    clinicId: medicine.clinicId,
    payload: {
      id: medicine.id,
      clinicId: medicine.clinicId,
      name: medicine.name,
      quantity: medicine.quantity,
      unit: medicine.unit,
      reorderLevel: medicine.reorderLevel,
      price: medicine.price,
      expiryDate: medicine.expiryDate,
      createdAt: medicine.createdAt,
      updatedAt: medicine.updatedAt,
    },
    createdAt: now,
    attempts: 0,
  };

  await putRecord(INVENTORY_STORE, medicine);
  await putRecord(MUTATION_STORE, mutation);
  emitLocalChange();

  if (typeof navigator !== "undefined" && navigator.onLine) {
    flushSyncQueue().catch(console.error);
  }

  return medicine;
}

/* ================= REPRODUCTIVE HEALTH ================= */

export async function listLocalReproductiveHealth(patientId: string): Promise<LocalReproductiveHealthRecord[]> {
  const records = await getAllRecords<LocalReproductiveHealthRecord>(REPRODUCTIVE_HEALTH_STORE);
  return records
    .filter((r) => r.patientId === patientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function cacheReproductiveHealth(records: Array<Omit<LocalReproductiveHealthRecord, "syncStatus">>) {
  await Promise.all(
    records.map((record) =>
      putRecord<LocalReproductiveHealthRecord>(REPRODUCTIVE_HEALTH_STORE, {
        ...record,
        syncStatus: "synced",
      })
    )
  );
  emitLocalChange();
}

export async function addReproductiveHealthRecordOffline(input: {
  patientId: string;
  clinicId: string;
  lastMenstrualPeriodDate?: string;
  cycleLengthDays?: number;
  flowDurationDays?: number;
  familyPlanningMethod: LocalReproductiveHealthRecord["familyPlanningMethod"];
  pregnancyStatus: LocalReproductiveHealthRecord["pregnancyStatus"];
  gravida?: number;
  para?: number;
  notes?: string;
}): Promise<LocalReproductiveHealthRecord> {
  await assertCanSave();
  const now = serverNowIso();
  const currentUser = getCurrentUser();
  const record: LocalReproductiveHealthRecord = {
    id: createId(),
    patientId: input.patientId,
    recordedById: currentUser.id,
    lastMenstrualPeriodDate: input.lastMenstrualPeriodDate,
    cycleLengthDays: input.cycleLengthDays,
    flowDurationDays: input.flowDurationDays,
    familyPlanningMethod: input.familyPlanningMethod,
    pregnancyStatus: input.pregnancyStatus,
    gravida: input.gravida,
    para: input.para,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  };

  const mutation: LocalMutation = {
    id: createId(),
    entity: "reproductiveHealth",
    action: "upsert",
    recordId: record.id,
    clinicId: input.clinicId,
    payload: {
      id: record.id,
      patientId: record.patientId,
      recordedById: record.recordedById,
      lastMenstrualPeriodDate: record.lastMenstrualPeriodDate,
      cycleLengthDays: record.cycleLengthDays,
      flowDurationDays: record.flowDurationDays,
      familyPlanningMethod: record.familyPlanningMethod,
      pregnancyStatus: record.pregnancyStatus,
      gravida: record.gravida,
      para: record.para,
      notes: record.notes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    createdAt: now,
    attempts: 0,
  };

  await putRecord(REPRODUCTIVE_HEALTH_STORE, record);
  await putRecord(MUTATION_STORE, mutation);
  emitLocalChange();

  if (typeof navigator !== "undefined" && navigator.onLine) {
    flushSyncQueue().catch(console.error);
  }

  return record;
}

/* ================= BACKGROUND SYNC & FLUSH ================= */

/** A change saved on this device that the server refused - shown to staff so it can be entered again. */
export type RejectedChange = { mutationId: string; entity: string; recordId: string | null; reason: string; what: string; savedAt: string | null; refusedAt: string };

const REJECTED_KEY = "bulamu:sync-rejected";
const ENTITY_WORDS: Record<string, string> = {
  patient: "Patient details", appointment: "Appointment", consultation: "Visit record", labTest: "Lab test",
  imagingRequest: "Imaging request", reproductiveHealth: "Reproductive health record", patientAllergies: "Allergies", inventory: "Stock item",
};

/** Changes the server refused, newest first. */
export function listRejectedChanges(): RejectedChange[] {
  try {
    return JSON.parse(localStorage.getItem(REJECTED_KEY) || "[]") as RejectedChange[];
  } catch {
    return [];
  }
}

export function dismissRejectedChange(mutationId: string) {
  try {
    localStorage.setItem(REJECTED_KEY, JSON.stringify(listRejectedChanges().filter((c) => c.mutationId !== mutationId)));
  } catch {
    // Storage blocked: nothing to forget.
  }
  emitLocalChange();
}

function rememberRejected(changes: RejectedChange[]) {
  if (!changes.length) return;
  try {
    const kept = listRejectedChanges().filter((c) => !changes.some((n) => n.mutationId === c.mutationId));
    localStorage.setItem(REJECTED_KEY, JSON.stringify([...changes, ...kept].slice(0, 100)));
  } catch {
    // Storage full or blocked: the server's log still has them.
  }
}

/** "Visit record - Okello Isaac": what a refused change was, in words. */
function describeChange(op: LocalMutation | undefined, entity: string): string {
  const payload = (op?.payload ?? {}) as Record<string, unknown>;
  const who = [payload.patientName, payload.name, payload.testName, payload.examination].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  return [ENTITY_WORDS[entity] ?? entity, who].filter(Boolean).join(" - ");
}

let flushRun: Promise<{ synced: number }> | null = null;
let flushAgain = false;

/**
 * Sends what was saved on this device. One push at a time: saving a visit, its
 * tests and its imaging together used to send several pushes at once, and a
 * test that reached the server before its visit was left behind. A push asked
 * for while one is running runs straight after it.
 */
export function flushSyncQueue(): Promise<{ synced: number }> {
  if (flushRun) {
    flushAgain = true;
    return flushRun;
  }
  flushRun = (async () => {
    try {
      let result: { synced: number };
      do {
        flushAgain = false;
        result = await flushOnce();
      } while (flushAgain);
      return result;
    } finally {
      flushRun = null;
    }
  })();
  return flushRun;
}

async function flushOnce() {
  const apiUrl = getApiUrl();
  if (!apiUrl || typeof navigator === "undefined" || !navigator.onLine) {
    return { synced: 0 };
  }

  // In the order they were saved (the store keeps them by random id).
  const operations = (await getAllRecords<LocalMutation>(MUTATION_STORE)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (operations.length === 0) {
    return { synced: 0 };
  }

  const pushedAt = Date.now();
  const response = await fetch(`${apiUrl}/sync/push`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ operations }),
  });

  // Saved on this device before the subscription ended (or before this device
  // knew). They stay queued and go up as soon as the facility renews.
  if (response.status === 402) {
    markSubscriptionLapsed();
    throw new SubscriptionRequiredError();
  }

  const data = await response.json();
  if (response.ok) rememberServerTime(data.serverTime, pushedAt);
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Sync failed");
  }

  if (Array.isArray(data.applied)) {
    await Promise.all(
      data.applied.map(async (item: { mutationId: string; entity: string; record: any }) => {
        await deleteRecord(MUTATION_STORE, item.mutationId);
        if (item.record) {
          const storeMap: Record<string, string> = {
            patient: PATIENT_STORE,
            appointment: APPOINTMENT_STORE,
            consultation: CONSULTATION_STORE,
            labTest: LAB_STORE,
            inventory: INVENTORY_STORE,
            reproductiveHealth: REPRODUCTIVE_HEALTH_STORE,
            patientAllergies: PATIENT_STORE,
          };
          const targetStore = storeMap[item.entity];
          if (targetStore) {
            await putRecord(targetStore, { ...item.record, syncStatus: "synced" });
          }
        }
      })
    );
  }

  // Nothing to do on the server (already deleted, or a newer version is there): done here too.
  if (Array.isArray(data.done)) {
    await Promise.all(data.done.map((mutationId: string) => deleteRecord(MUTATION_STORE, mutationId)));
  }
  // Refused: it is no longer resent (so the device stops showing it as pending
  // forever), and is listed for staff to see and enter again.
  if (Array.isArray(data.rejected) && data.rejected.length) {
    const refusedAt = new Date().toISOString();
    rememberRejected(data.rejected.map((r: { mutationId: string; entity: string; recordId: string | null; reason: string }) => {
      const op = operations.find((o) => o.id === r.mutationId);
      return { mutationId: r.mutationId, entity: r.entity, recordId: r.recordId, reason: r.reason, what: describeChange(op, r.entity), savedAt: op?.createdAt ?? null, refusedAt };
    }));
    await Promise.all(data.rejected.map((r: { mutationId: string }) => deleteRecord(MUTATION_STORE, r.mutationId)));
  }

  emitLocalChange();
  return { synced: data.applied ? data.applied.length : 0 };
}

function rememberMyDuties(me: { extraRoles?: string[]; canVerifyLab?: boolean; hiddenSections?: string[] }) {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    if (!user) return;
    const extraRoles = Array.isArray(me.extraRoles) ? me.extraRoles : [];
    const canVerifyLab = !!me.canVerifyLab;
    const hiddenSections = Array.isArray(me.hiddenSections) ? me.hiddenSections : [];
    if (JSON.stringify(user.extraRoles ?? []) === JSON.stringify(extraRoles) && !!user.canVerifyLab === canVerifyLab && JSON.stringify(user.hiddenSections ?? []) === JSON.stringify(hiddenSections)) return;
    localStorage.setItem('user', JSON.stringify({ ...user, extraRoles, canVerifyLab, hiddenSections }));
    emitLocalChange();
  } catch {
    // Storage blocked: the next sign-in carries them.
  }
}

export async function pullSyncUpdates(clinicId: string) {
  const apiUrl = getApiUrl();
  if (!apiUrl || typeof navigator === "undefined" || !navigator.onLine) {
    return;
  }

  const lastSyncedAt = localStorage.getItem(`lastSyncedAt_${clinicId}`) || new Date(0).toISOString();

  try {
    const pulledAt = Date.now();
    const response = await fetch(`${apiUrl}/sync/pull?clinicId=${clinicId}&lastSyncedAt=${encodeURIComponent(lastSyncedAt)}`, {
      headers: getAuthHeaders(),
    });
    const data = await response.json();
    // The server's time, so this device stamps records by the server's clock.
    if (response.ok) rememberServerTime(data.syncedAt, pulledAt);

    if (response.ok && data.success) {
      // The facility's units, and the ones this person works in, for booking and the queue offline.
      if (Array.isArray(data.departments)) rememberDepartments(clinicId, data.departments, data.myDepartmentIds);
      // Other roles and rights the administrator has given this person: shown at once, no new sign-in.
      if (data.me) rememberMyDuties(data.me);
      if (data.patients?.length) await cachePatients(data.patients);
      if (data.appointments?.length) await cacheAppointments(data.appointments);
      if (data.consultations?.length) await cacheConsultations(data.consultations);
      if (data.labTests?.length) await cacheLabTests(data.labTests);
      if (data.inventory?.length) await cacheInventory(data.inventory);
      if (data.reproductiveHealth?.length) await cacheReproductiveHealth(data.reproductiveHealth);

      localStorage.setItem(`lastSyncedAt_${clinicId}`, data.syncedAt || new Date().toISOString());
    }
  } catch (err) {
    console.error("Delta pull failed:", err);
  }
}
