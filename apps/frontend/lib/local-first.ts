export type LocalPatient = {
  id: string;
  name: string;
  phone: string;
  clinicId: string;
  createdAt: string;
  updatedAt: string;
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
  patient?: { name: string; phone: string };
  doctor?: { name: string };
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced" | "failed";
};

export type LocalPrescription = {
  id?: string;
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
};

export type LocalConsultation = {
  id: string;
  appointmentId: string;
  patientId: string;
  diagnosis: string;
  symptoms: string;
  prescriptions: LocalPrescription[];
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
  patient?: { name: string; phone: string };
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
  expiryDate?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: "pending" | "synced" | "failed";
};

export type LocalMutation = {
  id: string;
  entity: "patient" | "appointment" | "consultation" | "labTest" | "inventory";
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
const DB_VERSION = 2;

const PATIENT_STORE = "patients";
const APPOINTMENT_STORE = "appointments";
const CONSULTATION_STORE = "consultations";
const LAB_STORE = "lab_tests";
const INVENTORY_STORE = "inventory";
const MUTATION_STORE = "mutations";

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
    .filter((p) => p.clinicId === clinicId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getLocalPatientById(id: string): Promise<LocalPatient | undefined> {
  return getRecord<LocalPatient>(PATIENT_STORE, id);
}

export async function cachePatients(patients: Array<Omit<LocalPatient, "syncStatus">>) {
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
  clinicId: string;
}): Promise<LocalPatient> {
  const now = new Date().toISOString();
  const patient: LocalPatient = {
    id: createId(),
    name: input.name,
    phone: input.phone,
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

/* ================= APPOINTMENTS ================= */

export async function listLocalAppointments(clinicId: string): Promise<LocalAppointment[]> {
  const appointments = await getAllRecords<LocalAppointment>(APPOINTMENT_STORE);
  return appointments
    .filter((a) => a.clinicId === clinicId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function cacheAppointments(appointments: Array<Omit<LocalAppointment, "syncStatus">>) {
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
}): Promise<LocalAppointment> {
  const now = new Date().toISOString();
  const appointment: LocalAppointment = {
    id: createId(),
    patientId: input.patientId,
    doctorId: input.doctorId,
    clinicId: input.clinicId,
    date: input.date,
    time: input.time,
    status: "SCHEDULED",
    notes: input.notes,
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
  diagnosis: string;
  symptoms: string;
  prescriptions: LocalPrescription[];
  patientName?: string;
}): Promise<LocalConsultation> {
  const now = new Date().toISOString();
  const consultation: LocalConsultation = {
    id: createId(),
    appointmentId: input.appointmentId,
    patientId: input.patientId,
    diagnosis: input.diagnosis,
    symptoms: input.symptoms,
    prescriptions: input.prescriptions,
    patient: input.patientName ? { name: input.patientName, phone: "" } : undefined,
    createdAt: now,
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
      symptoms: consultation.symptoms,
      prescriptions: consultation.prescriptions,
      createdAt: consultation.createdAt,
      updatedAt: consultation.updatedAt,
    },
    createdAt: now,
    attempts: 0,
  };

  await putRecord(CONSULTATION_STORE, consultation);
  await putRecord(MUTATION_STORE, mutation);
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
  const now = new Date().toISOString();
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

/* ================= INVENTORY / MEDICINES ================= */

export async function listLocalInventory(clinicId: string): Promise<LocalMedicine[]> {
  const items = await getAllRecords<LocalMedicine>(INVENTORY_STORE);
  return items
    .filter((item) => item.clinicId === clinicId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function cacheInventory(items: Array<Omit<LocalMedicine, "syncStatus">>) {
  await Promise.all(
    items.map((item) =>
      putRecord<LocalMedicine>(INVENTORY_STORE, {
        ...item,
        syncStatus: "synced",
      })
    )
  );
  emitLocalChange();
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
  const now = new Date().toISOString();
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

/* ================= BACKGROUND SYNC & FLUSH ================= */

export async function flushSyncQueue() {
  const apiUrl = getApiUrl();
  if (!apiUrl || typeof navigator === "undefined" || !navigator.onLine) {
    return { synced: 0 };
  }

  const operations = await getAllRecords<LocalMutation>(MUTATION_STORE);
  if (operations.length === 0) {
    return { synced: 0 };
  }

  const response = await fetch(`${apiUrl}/sync/push`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ operations }),
  });

  const data = await response.json();
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
          };
          const targetStore = storeMap[item.entity];
          if (targetStore) {
            await putRecord(targetStore, { ...item.record, syncStatus: "synced" });
          }
        }
      })
    );
  }

  emitLocalChange();
  return { synced: data.applied ? data.applied.length : 0 };
}

export async function pullSyncUpdates(clinicId: string) {
  const apiUrl = getApiUrl();
  if (!apiUrl || typeof navigator === "undefined" || !navigator.onLine) {
    return;
  }

  const lastSyncedAt = localStorage.getItem(`lastSyncedAt_${clinicId}`) || new Date(0).toISOString();

  try {
    const response = await fetch(`${apiUrl}/sync/pull?clinicId=${clinicId}&lastSyncedAt=${encodeURIComponent(lastSyncedAt)}`, {
      headers: getAuthHeaders(),
    });
    const data = await response.json();

    if (response.ok && data.success) {
      if (data.patients?.length) await cachePatients(data.patients);
      if (data.appointments?.length) await cacheAppointments(data.appointments);
      if (data.consultations?.length) await cacheConsultations(data.consultations);
      if (data.labTests?.length) await cacheLabTests(data.labTests);
      if (data.inventory?.length) await cacheInventory(data.inventory);

      localStorage.setItem(`lastSyncedAt_${clinicId}`, data.syncedAt || new Date().toISOString());
    }
  } catch (err) {
    console.error("Delta pull failed:", err);
  }
}
