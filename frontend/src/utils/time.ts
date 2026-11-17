/**
 * Time and UTC Normalization Utilities
 * Prevents local timezone offset bugs when parsing UTC ISO strings from backend.
 */

export function normalizeUtcTimestamp(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null;
  const str = String(timestamp).trim();
  if (!str) return null;

  // If the ISO timestamp string does not end with 'Z' and does not contain a timezone offset (+ or - after the T), append 'Z'
  const timePart = str.includes('T') ? str.split('T')[1] : str;
  if (!str.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(timePart)) {
    return `${str}Z`;
  }
  return str;
}

export function parseUtcMs(timestamp: string | null | undefined): number | null {
  const normalized = normalizeUtcTimestamp(timestamp);
  if (!normalized) return null;
  const ms = new Date(normalized).getTime();
  return isNaN(ms) ? null : ms;
}
