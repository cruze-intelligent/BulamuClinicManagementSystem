import { describe, expect, it } from 'vitest';
import { fileNameFrom, titleFrom } from './open-document';

describe('naming a document opened for printing', () => {
  it("takes the server's name (any characters), and titles the tab without the extension", () => {
    const name = fileNameFrom(`inline; filename="Discharge summary - OGWAL FRANCIS O'Kello - 2026-11-23.pdf"; filename*=UTF-8''Discharge%20summary%20-%20OGWAL%20FRANCIS%20O%27Kello%20-%202026-11-23.pdf`);
    expect(name).toBe("Discharge summary - OGWAL FRANCIS O'Kello - 2026-11-23.pdf");
    expect(titleFrom(name!)).toBe("Discharge summary - OGWAL FRANCIS O'Kello - 2026-11-23");
    expect(fileNameFrom('attachment; filename="monthly-report-2026-11.pdf"')).toBe('monthly-report-2026-11.pdf');
    expect(fileNameFrom(`inline; filename="Achieng _.pdf"; filename*=UTF-8''Achieng%20%C3%89.pdf`)).toBe('Achieng É.pdf');
    expect(fileNameFrom(null)).toBeNull();
  });
});
