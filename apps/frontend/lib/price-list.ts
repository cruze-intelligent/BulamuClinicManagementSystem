'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChargeKind } from './finance';
import { LAB_TESTS_CATALOG } from './lab-tests-catalog';
import { MODALITIES } from './imaging';

/**
 * The facility's price list - what it charges for each consultation, lab test,
 * imaging examination, procedure and ward night. Its administrator sets it once
 * on the Bills page; then a charge picked from it on any bill is priced
 * automatically. Medicines are priced in stock instead. Kept on the device so
 * billing still finds prices offline.
 */
export type ServicePrice = { id: string; kind: ChargeKind; name: string; price: number };

/** The kinds of charge a price list covers, in the order the list shows them. */
export const PRICED_KINDS: Array<{ value: ChargeKind; label: string; hint: string }> = [
  { value: 'CONSULTATION', label: 'Consultations', hint: 'One per type of visit, e.g. General consultation, Dentistry consultation, Review' },
  { value: 'LAB', label: 'Lab tests', hint: 'Named as the lab writes them, so a test ordered at a visit finds its price' },
  { value: 'IMAGING', label: 'Imaging', hint: 'Ultrasound scans, X-rays and other examinations' },
  { value: 'PROCEDURE', label: 'Procedures', hint: 'Dressings, suturing, minor surgery, operations' },
  { value: 'ADMISSION', label: 'Ward stays', hint: 'Per night, named "<ward> - ward stay (per night)"' },
  { value: 'OTHER', label: 'Other charges', hint: 'Registration, medical reports, ambulance...' },
];

const COMMON_PROCEDURES = [
  'Wound dressing', 'Suturing (stitching)', 'Removal of stitches', 'Incision and drainage', 'Circumcision', 'IV cannulation', 'IV fluids administration',
  'Injection administration', 'Nebulisation', 'Urinary catheterisation', 'Nasogastric tube insertion', 'Plaster of Paris (POP) cast', 'Removal of POP cast',
  'Ear syringing', 'Foreign body removal', 'Tooth extraction', 'Dental filling', 'Scaling and polishing', 'Normal delivery', 'Caesarean section',
  'Manual vacuum aspiration (MVA)', 'IUD insertion', 'Implant insertion', 'Implant removal', 'Minor surgery', 'Major surgery', 'Blood transfusion',
  'Lumbar puncture', 'Toenail removal', 'Burns dressing', 'ECG',
];

/** Names to start from when adding to the list: the facility can always type its own. */
export function suggestedServices(kind: ChargeKind, wards: string[] = []): string[] {
  switch (kind) {
    case 'CONSULTATION':
      return ['General consultation', 'Specialist consultation', 'Review visit', 'Emergency consultation', 'Dentistry consultation', 'Eye consultation', 'Antenatal visit', 'Paediatric consultation', 'Night consultation'];
    case 'LAB':
      return LAB_TESTS_CATALOG.map((t) => t.name);
    case 'IMAGING':
      return MODALITIES.flatMap((m) => m.examples);
    case 'PROCEDURE':
      return COMMON_PROCEDURES;
    case 'ADMISSION':
      return wards.map((w) => `${w} - ward stay (per night)`);
    case 'OTHER':
      return ['Registration / card fee', 'Medical report', 'Medical form (PF3, school, employment)', 'Ambulance', 'Oxygen (per hour)', 'Mortuary (per day)'];
    default:
      return [];
  }
}

// How clinicians write some procedures for short.
const PROCEDURE_SHORTHAND: Record<string, string> = {
  'i&d': 'Incision and drainage', ngt: 'Nasogastric tube insertion', lp: 'Lumbar puncture', 'c/s': 'Caesarean section', svd: 'Normal delivery', tos: 'Removal of stitches',
};

/**
 * Procedures to offer at a visit, matching what is typed: the facility's own priced
 * procedures first (so the bill finds the price), then common ones.
 */
export function procedureChoices(prices: ServicePrice[], typed: string, limit = 8): Array<{ name: string; price: number | null }> {
  const wanted = typed.trim().toLowerCase();
  const priced = prices.filter((p) => p.kind === 'PROCEDURE').map((p) => ({ name: p.name, price: p.price as number | null }));
  const seen = new Set(priced.map((p) => p.name.toLowerCase()));
  const all = [...priced, ...COMMON_PROCEDURES.filter((n) => !seen.has(n.toLowerCase())).map((name) => ({ name, price: null }))];
  if (!wanted) return all.slice(0, limit);
  const words = wanted.split(/[^a-z0-9&]+/).filter(Boolean);
  const meant = PROCEDURE_SHORTHAND[wanted.replace(/\s+/g, '')]?.toLowerCase();
  return all.filter((p) => {
    const name = p.name.toLowerCase();
    return name === meant || name.includes(wanted) || words.every((w) => name.includes(w));
  }).slice(0, limit);
}

/** The listed price for a charge of this kind and name (any letter case), if there is one. */
export function listedPrice(prices: ServicePrice[], kind: ChargeKind, name: string): number | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  return prices.find((p) => p.kind === kind && p.name.trim().toLowerCase() === wanted)?.price ?? null;
}

const API = process.env.NEXT_PUBLIC_API_URL;
const cacheKey = (clinicId: string) => `priceList_${clinicId}`;
const EVENT = 'bulamu:price-list';

function readCache(clinicId: string): ServicePrice[] {
  try {
    const raw = localStorage.getItem(cacheKey(clinicId));
    return raw ? (JSON.parse(raw) as ServicePrice[]) : [];
  } catch {
    return [];
  }
}

export function rememberPriceList(clinicId: string, prices: ServicePrice[]) {
  try {
    localStorage.setItem(cacheKey(clinicId), JSON.stringify(prices));
  } catch {
    // Storage full or blocked: it is fetched again next time.
  }
  window.dispatchEvent(new Event(EVENT));
}

const currentClinicId = (): string | null => {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').clinicId ?? null;
  } catch {
    return null;
  }
};

/** The facility's price list (the copy on this device at once, then the server's). */
export function usePriceList(): { prices: ServicePrice[]; reload: () => Promise<void>; clinicId: string | null } {
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [prices, setPrices] = useState<ServicePrice[]>([]);

  const reload = useCallback(async () => {
    const id = currentClinicId();
    if (!id || !navigator.onLine) return;
    try {
      const res = await fetch(`${API}/clinics/${id}/price-list`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      if (res.ok && data.success) rememberPriceList(id, data.prices);
    } catch {
      // Offline or unreachable: the copy on this device is used.
    }
  }, []);

  useEffect(() => {
    const id = currentClinicId();
    setClinicId(id);
    if (!id) return;
    const show = () => setPrices(readCache(id));
    show();
    window.addEventListener(EVENT, show);
    void reload();
    return () => window.removeEventListener(EVENT, show);
  }, [reload]);

  return { prices, reload, clinicId };
}
