// Pure scan classifier — no React, no I/O, no imports from other project files.
// See docs/superpowers/specs/2026-09-02-scanner-support-design.md section 2.

export type Scan =
  | { kind: 'weapon'; candidates: string[] } // e.g. ['0001', '1'] — as-scanned, then leading zeros stripped
  | { kind: 'ssn'; ssn: string } // canonical 'YYYYMMDD-XXXX'
  | { kind: 'unknown'; raw: string };

const WEAPON_FORMAT_RE = /^([^#]+)(#+)([^#]*)$/;

export function isValidWeaponFormat(template: string): boolean {
  return WEAPON_FORMAT_RE.test(template);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tryWeapon(raw: string, weaponFormat: string): Scan | null {
  const parts = WEAPON_FORMAT_RE.exec(weaponFormat);
  if (!parts) return null;
  const [, prefix, hashes, suffix] = parts;
  const n = hashes.length;
  const re = new RegExp(`^${escapeRegExp(prefix)}(\\d{${n}})${escapeRegExp(suffix)}$`, 'i');
  const m = re.exec(raw);
  if (!m) return null;
  const scanned = m[1];
  const stripped = scanned.replace(/^0+/, '') || '0';
  const candidates = scanned === stripped ? [scanned] : [scanned, stripped];
  return { kind: 'weapon', candidates };
}

// Sum-of-digits Luhn check over the 10-digit personnummer form: weights
// 2,1,2,1,2,1,2,1,2 across the first 9 digits, each product folded to a
// single digit when > 9, checked against the 10th digit. Mirrors the
// standard Swedish personnummer algorithm.
function luhnValid(tenDigits: string): boolean {
  const weights = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let p = Number(tenDigits[i]) * weights[i];
    if (p > 9) p -= 9;
    sum += p;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(tenDigits[9]);
}

function trySsn(raw: string): Scan | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 10 && digits.length !== 12) return null;

  let full: string; // 12-digit YYYYMMDDNNNN
  if (digits.length === 12) {
    full = digits;
  } else {
    const yy = Number(digits.slice(0, 2));
    const century = 2000 + yy > new Date().getFullYear() ? 1900 : 2000;
    full = String(century + yy) + digits.slice(2);
  }

  const ten = full.slice(2); // 10-digit form used for the Luhn check
  if (!luhnValid(ten)) return null;

  const month = Number(full.slice(4, 6));
  const day = Number(full.slice(6, 8));
  const validDay = (day >= 1 && day <= 31) || (day >= 61 && day <= 91);
  if (month < 1 || month > 12 || !validDay) return null;

  return { kind: 'ssn', ssn: `${full.slice(0, 8)}-${full.slice(8, 12)}` };
}

export function classify(raw: string, weaponFormat: string): Scan {
  const weapon = tryWeapon(raw, weaponFormat);
  if (weapon) return weapon;
  const ssn = trySsn(raw);
  if (ssn) return ssn;
  return { kind: 'unknown', raw };
}
