/**
 * Thin client for Pesapal's v3 API, used to bill clinics their monthly
 * subscription fee after the 2-week free trial. Same shape as
 * dhis2.service.ts (plain functions, injectable fetch) so it's testable
 * without a real network call or a mocking library.
 */

export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export function getPesapalBaseUrl(env: string = process.env.PESAPAL_ENV || 'sandbox'): string {
  return env === 'live' ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';
}

export async function getAccessToken(
  credentials: { consumerKey: string; consumerSecret: string },
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  baseUrl: string = getPesapalBaseUrl()
): Promise<{ success: boolean; token?: string; error?: any }> {
  const response = await fetchImpl(`${baseUrl}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: credentials.consumerKey, consumer_secret: credentials.consumerSecret }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.token) {
    return { success: false, error: body };
  }
  return { success: true, token: body.token };
}

export async function registerIpnUrl(
  token: string,
  ipnUrl: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  baseUrl: string = getPesapalBaseUrl()
): Promise<{ success: boolean; ipnId?: string; error?: any }> {
  const response = await fetchImpl(`${baseUrl}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: ipnUrl, ipn_notification_type: 'GET' }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ipn_id) {
    return { success: false, error: body };
  }
  return { success: true, ipnId: body.ipn_id };
}

export type PesapalOrderRequest = {
  id: string; // merchant reference, must be unique per order
  amount: number;
  currency: string;
  description: string;
  callbackUrl: string;
  notificationId: string; // the registered ipn_id
  billing: { emailAddress: string; phoneNumber?: string; firstName: string; lastName: string };
};

export async function submitOrderRequest(
  token: string,
  order: PesapalOrderRequest,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  baseUrl: string = getPesapalBaseUrl()
): Promise<{ success: boolean; orderTrackingId?: string; redirectUrl?: string; error?: any }> {
  const response = await fetchImpl(`${baseUrl}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      id: order.id,
      currency: order.currency,
      amount: order.amount,
      description: order.description,
      callback_url: order.callbackUrl,
      notification_id: order.notificationId,
      billing_address: {
        email_address: order.billing.emailAddress,
        phone_number: order.billing.phoneNumber || '',
        first_name: order.billing.firstName,
        last_name: order.billing.lastName,
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.order_tracking_id) {
    return { success: false, error: body };
  }
  return { success: true, orderTrackingId: body.order_tracking_id, redirectUrl: body.redirect_url };
}

export type PesapalTransactionStatus = {
  statusCode: number; // 0 = invalid/pending, 1 = completed, 2 = failed, 3 = reversed
  paymentStatusDescription: string;
  merchantReference: string;
  amount: number;
  currency: string;
};

export async function getTransactionStatus(
  token: string,
  orderTrackingId: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  baseUrl: string = getPesapalBaseUrl()
): Promise<{ success: boolean; status?: PesapalTransactionStatus; error?: any }> {
  const response = await fetchImpl(`${baseUrl}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { success: false, error: body };
  }
  return {
    success: true,
    status: {
      statusCode: body.status_code,
      paymentStatusDescription: body.payment_status_description,
      merchantReference: body.merchant_reference,
      amount: body.amount,
      currency: body.currency,
    },
  };
}

export const PESAPAL_STATUS_COMPLETED = 1;
