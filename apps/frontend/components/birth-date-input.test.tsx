import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BirthDateInput, birthDatePayload, emptyBirthDate, type BirthDateValue } from './birth-date-input';

afterEach(cleanup);

let latest: BirthDateValue = emptyBirthDate();
function Harness() {
  const [value, setValue] = useState<BirthDateValue>(emptyBirthDate);
  latest = value;
  return <BirthDateInput id="dob" value={value} onChange={setValue} />;
}

describe('date of birth or age', () => {
  it('takes a date of birth, or an age when the patient does not know it, marked as estimated', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1990-03-09' } });
    expect(birthDatePayload(latest)).toEqual({ dateOfBirth: '1990-03-09', dateOfBirthEstimated: false });

    fireEvent.click(screen.getByRole('radio', { name: 'Age (date not known)' }));
    fireEvent.change(screen.getByLabelText('Age'), { target: { value: '34' } });
    expect(screen.getByText(/Recorded as 34 years \(estimated\)/)).toBeTruthy();
    const saved = birthDatePayload(latest);
    expect(saved.dateOfBirthEstimated).toBe(true);
    expect(new Date().getFullYear() - Number(saved.dateOfBirth.slice(0, 4))).toBe(34);

    fireEvent.change(screen.getByLabelText('Age in'), { target: { value: 'months' } });
    fireEvent.change(screen.getByLabelText('Age'), { target: { value: '50' } });
    expect(screen.getByRole('alert').textContent).toMatch(/up to 36/);
    expect(birthDatePayload(latest)).toEqual({ dateOfBirth: '', dateOfBirthEstimated: false });
  });
});
