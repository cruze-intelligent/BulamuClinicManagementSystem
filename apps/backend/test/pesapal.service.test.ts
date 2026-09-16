import { describe, expect, it, vi } from 'vitest';
import {
  getAccessToken, registerIpnUrl, submitOrderRequest, getTransactionStatus, getPesapalBaseUrl,
} from '../src/services/pesapal.service';

describe('getPesapalBaseUrl', () => {
  it('uses the sandbox host by default', () => {
    expect(getPesapalBaseUrl('sandbox')).toBe('https://cybqa.pesapal.com/pesapalv3');
  });

  it('uses the live host when explicitly set to live', () => {
    expect(getPesapalBaseUrl('live')).toBe('https://pay.pesapal.com/v3');
  });
});

describe('getAccessToken', () => {
  it('requests a token and returns it on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ token: 'abc123' }) });

    const result = await getAccessToken({ consumerKey: 'key', consumerSecret: 'secret' }, fetchMock, 'https://sandbox.example');

    expect(result.success).toBe(true);
    expect(result.token).toBe('abc123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.example/api/Auth/RequestToken',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('surfaces a failure without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'invalid_client' }) });
    const result = await getAccessToken({ consumerKey: 'bad', consumerSecret: 'bad' }, fetchMock, 'https://sandbox.example');
    expect(result.success).toBe(false);
  });
});

describe('registerIpnUrl', () => {
  it('registers the IPN url and returns its id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ipn_id: 'ipn-1' }) });
    const result = await registerIpnUrl('token', 'https://api.bulamu.site/billing/pesapal/ipn', fetchMock, 'https://sandbox.example');
    expect(result.success).toBe(true);
    expect(result.ipnId).toBe('ipn-1');
  });
});

describe('submitOrderRequest', () => {
  it('submits an order and returns the tracking id and redirect url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ order_tracking_id: 'track-1', redirect_url: 'https://pay.pesapal.com/checkout/track-1' }),
    });

    const result = await submitOrderRequest(
      'token',
      {
        id: 'merchant-ref-1', amount: 100000, currency: 'UGX', description: 'Bulamu subscription',
        callbackUrl: 'https://app.bulamu.site/billing/callback', notificationId: 'ipn-1',
        billing: { emailAddress: 'admin@clinic.ug', firstName: 'Jane', lastName: 'Doe' },
      },
      fetchMock,
      'https://sandbox.example'
    );

    expect(result.success).toBe(true);
    expect(result.orderTrackingId).toBe('track-1');
    expect(result.redirectUrl).toBe('https://pay.pesapal.com/checkout/track-1');
  });
});

describe('getTransactionStatus', () => {
  it('parses a completed transaction status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({
        status_code: 1, payment_status_description: 'Completed',
        merchant_reference: 'merchant-ref-1', amount: 100000, currency: 'UGX',
      }),
    });

    const result = await getTransactionStatus('token', 'track-1', fetchMock, 'https://sandbox.example');
    expect(result.success).toBe(true);
    expect(result.status?.statusCode).toBe(1);
    expect(result.status?.paymentStatusDescription).toBe('Completed');
  });
});
