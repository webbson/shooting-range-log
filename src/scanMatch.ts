// Resolving a scan against loaded rows. Structurally typed and import-free so
// it stays runnable under plain node for scan.check.ts.
// See docs/superpowers/specs/2026-09-02-scanner-support-design.md section 4.

/** Last 10 digits of a personnummer, ignoring format. Member SSNs are NOT
 *  stored canonically — create_user only trims, upsert_guest canonicalises and
 *  the Excel import uses a third normalizer — so comparing strings would miss
 *  real members. The last 10 digits are the same in every format, and the
 *  century a 10-digit form omits is not worth distinguishing at a rifle range. */
export function ssnDigits(ssn: string | null | undefined): string {
  return (ssn ?? '').replace(/\D/g, '').slice(-10);
}

/** Active rows win: an SSN can appear on both a retired member and a later
 *  guest, and the live one is the one the operator means. */
export function findUserBySsn<T extends { ssn: string | null; active: boolean }>(
  users: T[],
  ssn: string,
): T | undefined {
  const key = ssnDigits(ssn);
  if (key.length !== 10) return undefined;
  const hits = users.filter((u) => ssnDigits(u.ssn) === key);
  return hits.find((u) => u.active) ?? hits[0];
}

/** Candidates come from the classifier padded-first (['0001','1']); display_id
 *  is stored unpadded today, but a club that pads its tags must still resolve.
 *  Active rows win so a retired weapon's freed tag cannot shadow its new holder. */
export function findWeaponByCandidates<T extends { displayId: string | null; active: boolean }>(
  weapons: T[],
  candidates: string[],
): T | undefined {
  const hits = weapons.filter((w) => w.displayId != null && candidates.includes(w.displayId));
  return hits.find((w) => w.active) ?? hits[0];
}
