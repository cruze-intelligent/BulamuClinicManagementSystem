// Time, the same on every device. Two things can make a time wrong:
//
// - Showing it in the device's own time zone. Every time is shown in Kampala
//   time (EAT), as the printed documents are, whatever the device is set to.
// - Stamping it with the device's own clock. A phone or computer that is
//   minutes or hours off would record arrivals, visits and results at the wrong
//   time. Each sync tells the device the server's time; the difference is kept
//   and every time this device stamps is corrected by it (serverNow). The server
//   also refuses a time from the future (apps/backend/src/routes/sync.routes.ts).

export const KAMPALA = 'Africa/Kampala';
const OFFSET_KEY = 'clockOffsetMs';

/** How far this device's clock is behind the server's, in ms (negative when ahead). */
export function clockOffset(): number {
  try {
    const value = Number(typeof localStorage === 'undefined' ? 0 : localStorage.getItem(OFFSET_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Keeps the difference between this device's clock and the server's, from a
 * server time received in a reply. The request's round trip is split in two,
 * so a slow connection does not count as clock error.
 */
export function rememberServerTime(serverTime: string | undefined | null, sentAt: number, receivedAt: number = Date.now()) {
  const server = serverTime ? new Date(serverTime).getTime() : NaN;
  if (!Number.isFinite(server) || receivedAt < sentAt) return;
  // A reply that took over a minute says too little about the clock to use.
  if (receivedAt - sentAt > 60_000) return;
  const offset = Math.round(server - (sentAt + receivedAt) / 2);
  try {
    localStorage.setItem(OFFSET_KEY, String(offset));
  } catch {
    // Storage blocked: times stay on the device clock, and the server still checks them.
  }
}

/** Now, by the server's clock. */
export const serverNow = (): Date => new Date(Date.now() + clockOffset());
export const serverNowIso = (): string => serverNow().toISOString();

const parts = (value: string | Date | number, options: Intl.DateTimeFormatOptions) =>
  new Date(value).toLocaleString('en-GB', { timeZone: KAMPALA, ...options });

/** "17 Nov 2026" in Kampala. */
export const formatDate = (value: string | Date | number) => parts(value, { day: 'numeric', month: 'short', year: 'numeric' });
/** "09:35" in Kampala. */
export const formatTime = (value: string | Date | number) => parts(value, { hour: '2-digit', minute: '2-digit' });
/** "17 Nov 2026, 09:35" in Kampala. */
export const formatDateTime = (value: string | Date | number) => `${formatDate(value)}, ${formatTime(value)}`;
/** "17 Nov, 09:35" in Kampala - for lists within the year. */
export const formatDayTime = (value: string | Date | number) => `${parts(value, { day: 'numeric', month: 'short' })}, ${formatTime(value)}`;

/** The Kampala calendar day, "2026-11-17", of a moment - for "today" wherever the device is. */
export const kampalaDay = (value: string | Date | number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: KAMPALA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
