import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProcedurePicker } from './procedure-picker';

afterEach(cleanup);

describe('the procedures in a visit plan', () => {
  it('adds one typed in, with a note, and removes it', () => {
    const changed = vi.fn();
    const { rerender } = render(<ProcedurePicker value={[]} onChange={changed} prices={[]} />);
    fireEvent.change(screen.getByPlaceholderText(/Search or type: incision and drainage/), { target: { value: 'Ear syringing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(changed).toHaveBeenLastCalledWith([{ name: 'Ear syringing', notes: '' }]);

    rerender(<ProcedurePicker value={[{ name: 'Ear syringing', notes: '' }]} onChange={changed} prices={[]} />);
    fireEvent.change(screen.getByLabelText('Note on Ear syringing'), { target: { value: 'Both ears, wax cleared' } });
    expect(changed).toHaveBeenLastCalledWith([{ name: 'Ear syringing', notes: 'Both ears, wax cleared' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ear syringing' }));
    expect(changed).toHaveBeenLastCalledWith([]);
  });
});
