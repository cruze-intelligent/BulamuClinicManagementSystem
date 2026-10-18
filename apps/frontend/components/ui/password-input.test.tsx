import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PasswordInput } from './password-input';

afterEach(() => cleanup());

describe('PasswordInput', () => {
  it('hides what is typed until the eye is pressed, and hides it again', () => {
    render(<><label htmlFor="pw">Password</label><PasswordInput id="pw" defaultValue="Mango-River-4821" /></>);
    const field = screen.getByLabelText('Password') as HTMLInputElement;
    expect(field.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field.type).toBe('text');
    expect(field.value).toBe('Mango-River-4821');

    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(hide);
    expect(field.type).toBe('password');
  });

  it("tells phone keyboards not to capitalise or correct it, even while it is shown", () => {
    render(<PasswordInput aria-label="Password" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    const field = screen.getByLabelText('Password');
    expect(field.getAttribute('autocapitalize')).toBe('none');
    expect(field.getAttribute('autocorrect')).toBe('off');
    expect(field.getAttribute('spellcheck')).toBe('false');
  });

  it('never submits the form it sits in', () => {
    let submitted = false;
    render(<form onSubmit={(e) => { e.preventDefault(); submitted = true; }}><PasswordInput aria-label="Password" /></form>);
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(submitted).toBe(false);
  });
});
