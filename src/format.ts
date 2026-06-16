// Dates are stored UTC (RFC3339); display in Swedish format (e.g. 2026-06-16 14:30),
// regardless of OS locale.
const LOCALE = 'sv-SE';

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALE);
