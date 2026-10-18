import { describe, expect, it } from 'vitest';
import { internationalPhone, kampalaToday, methodLabel, parseShillings, receiptMessage, smsLink, ugx, whatsappLink } from './finance';

describe('money on the bills and finances pages', () => {
  it('writes and reads shillings the way people type them', () => {
    expect(ugx(25000)).toBe('UGX 25,000');
    expect(parseShillings('25,000')).toBe(25000);
    expect(parseShillings(' 25 000 ')).toBe(25000);
    expect(parseShillings('0')).toBeNull();
    expect(parseShillings('12.5')).toBeNull();
    expect(parseShillings('')).toBeNull();
  });

  it("starts the date pickers on Kampala's today, not the server's or UTC's", () => {
    // 22:30 UTC on the 17th is already 01:30 on the 18th in Kampala.
    expect(kampalaToday(new Date('2026-10-17T22:30:00Z'))).toBe('2026-10-18');
  });

  it('names payment methods, including payments from before methods were kept', () => {
    expect(methodLabel('MOBILE_MONEY')).toBe('Mobile money');
    expect(methodLabel(null)).toBe('Not recorded');
  });

  it('writes a receipt as one short message, with the balance or "paid in full"', () => {
    const base = { clinicName: 'Mbarara Family Clinic', patientName: 'Achieng Mary', receiptNumber: '000042', amount: 10000, method: 'MOBILE_MONEY', receivedAt: '2026-10-18T07:05:00Z' };
    expect(receiptMessage({ ...base, balance: 16000 })).toBe(
      'Mbarara Family Clinic: receipt 000042 for Achieng Mary. UGX 10,000 received by mobile money on 18 Oct 2026 10:05. Balance UGX 16,000. Thank you.',
    );
    expect(receiptMessage({ ...base, balance: 0 })).toContain('Paid in full.');
  });

  it('sends receipts to Ugandan numbers however they were written', () => {
    expect(internationalPhone('0772 123 456')).toBe('256772123456');
    expect(internationalPhone('+256 772 123456')).toBe('256772123456');
    expect(internationalPhone('772123456')).toBe('256772123456');
    expect(internationalPhone('12')).toBeNull();
    expect(smsLink('0772 123 456', 'Hi & bye')).toBe('sms:+256772123456?body=Hi%20%26%20bye');
    expect(whatsappLink(null, 'Hi')).toBe('https://wa.me/?text=Hi');
  });
});
