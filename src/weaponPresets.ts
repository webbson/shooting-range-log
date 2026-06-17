// Suggestion presets for the weapon editor's brand / model / caliber fields.
// These are convenience hints only — the inputs stay free-text (Autocomplete), so
// any value can still be typed. Suggestions = this curated list merged with the
// distinct values already present in the weapon database, so they self-enrich.

export const CURATED_BRANDS = [
  'Glock',
  'Sig Sauer',
  'CZ',
  'Beretta',
  'Walther',
  'Heckler & Koch',
  'Smith & Wesson',
  'Ruger',
  'Tikka',
  'Sako',
  'Anschütz',
  'Steyr',
  'FN',
  'Browning',
  'Colt',
  'Hämmerli',
];

export const CURATED_CALIBERS = [
  '9mm',
  '.22 LR',
  '.45 ACP',
  '.357 Magnum',
  '.38 Special',
  '.40 S&W',
  '.223 Rem',
  '.308 Win',
  '6.5x55',
  '.30-06',
];

// Case-insensitive union of curated values + values seen in the DB. Curated spelling
// wins on collision; empty/whitespace values are dropped; result sorted (sv locale).
export function mergeSuggestions(curated: string[], fromDb: (string | null)[]): string[] {
  const seen = new Map<string, string>();
  for (const v of curated) seen.set(v.toLowerCase(), v);
  for (const v of fromDb) {
    const s = v?.trim();
    if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'sv'));
}
