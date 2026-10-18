import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SampleDocumentsCard } from './sample-documents-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const respond = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));

describe('the System tab sample documents card', () => {
  it('says which inbox gets the samples, sends them, and confirms', async () => {
    respond({ success: true, result: { sent: true }, documents: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] });
    render(<SampleDocumentsCard inbox="starplay.stargames@gmail.com" />);
    expect(screen.getByText('starplay.stargames@gmail.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Send sample documents/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('7 sample documents sent to starplay.stargames@gmail.com.'));
    expect((fetch as any).mock.calls[0][0]).toMatch(/\/super-admin\/system\/sample-documents$/);
    expect((fetch as any).mock.calls[0][1].method).toBe('POST');
  });

  it('says why when the email did not go out', async () => {
    respond({ success: true, result: { sent: false, reason: 'relay unreachable' }, documents: [] });
    render(<SampleDocumentsCard inbox="ops@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: /Send sample documents/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not sent: relay unreachable'));
  });

  it('sends one of every email too, and says how many went', async () => {
    respond({ success: true, total: 18, sent: 18 });
    render(<SampleDocumentsCard inbox="starplay.stargames@gmail.com" />);
    fireEvent.click(screen.getByRole('button', { name: /Send sample emails/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('18 sample emails sent to starplay.stargames@gmail.com, one per message.'));
    expect((fetch as any).mock.calls[0][0]).toMatch(/\/super-admin\/system\/sample-emails$/);
  });
});
