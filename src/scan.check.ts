// Runnable self-check for scan.ts. No test framework, no node imports —
// run directly with `node src/scan.check.ts` (Node 24 strips TS natively).
import { classify, isValidWeaponFormat, type Scan } from './scan.ts';
import { findUserBySsn, findWeaponByCandidates, ssnDigits } from './scanMatch.ts';

let count = 0;

function assert(cond: boolean, label: string): void {
  count++;
  if (!cond) {
    throw new Error(`FAIL: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

// Builds a 10-digit personnummer body (yymmddnnnn) whose check digit
// satisfies the same Luhn rule scan.ts implements, so tests don't depend on
// a hand-picked real number.
function buildValidTen(yy: string, mm: string, dd: string, serial3: string): string {
  const nine = yy + mm + dd + serial3;
  const weights = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let p = Number(nine[i]) * weights[i];
    if (p > 9) p -= 9;
    sum += p;
  }
  const check = (10 - (sum % 10)) % 10;
  return nine + String(check);
}

// --- isValidWeaponFormat ---
assert(isValidWeaponFormat('####') === false, 'empty prefix rejected');
assert(isValidWeaponFormat('v####') === true, 'v#### accepted');
assert(isValidWeaponFormat('v#') === true, 'v# accepted');
assert(isValidWeaponFormat('v') === false, 'no # run rejected');

// --- weapon classification ---
assertEqual<Scan>(classify('v0001', 'v####'), { kind: 'weapon', candidates: ['0001', '1'] }, 'v0001 padded+stripped');
assertEqual<Scan>(classify('v1', 'v#'), { kind: 'weapon', candidates: ['1'] }, 'v1 no padding, single candidate');
assertEqual<Scan>(classify('V0021', 'v####'), { kind: 'weapon', candidates: ['0021', '21'] }, 'weapon match is case-insensitive');

// --- SSN classification ---
assertEqual<Scan>(classify('8001011231', 'v####'), { kind: 'ssn', ssn: '19800101-1231' }, '10-digit ssn, century inferred 19xx');
assertEqual<Scan>(classify('800101-1231', 'v####'), { kind: 'ssn', ssn: '19800101-1231' }, 'hyphenated 10-digit ssn same result');

const tenFuture = buildValidTen('05', '06', '15', '000'); // yy=05 -> 2005, not future
assertEqual<Scan>(classify(tenFuture, 'v####'), { kind: 'ssn', ssn: `2005${tenFuture.slice(2, 6)}-${tenFuture.slice(6)}` }, '10-digit ssn, century inferred 20xx');

const twelve = '19' + buildValidTen('89', '03', '30', '401');
assertEqual<Scan>(classify(twelve, 'v####'), { kind: 'ssn', ssn: `${twelve.slice(0, 8)}-${twelve.slice(8)}` }, '12-digit ssn');

// Real parcel-label scan: 12 digits, fails Luhn — must not be treated as ssn.
assertEqual<Scan>(classify('202602032263', 'v####'), { kind: 'unknown', raw: '202602032263' }, 'non-ssn 12-digit parcel label is unknown');

// Samordningsnummer: day 61-91, passing Luhn.
const samordning = buildValidTen('90', '05', '61', '000');
assertEqual<Scan>(
  classify(samordning, 'v####'),
  { kind: 'ssn', ssn: `1990${samordning.slice(2, 6)}-${samordning.slice(6)}` },
  'samordningsnummer (day 61-91) accepted',
);

// --- unknown ---
assertEqual<Scan>(
  classify('OS5319+1*normal*PFB14680645*8*MSH01018*20260208101256*938474284*A0031303', 'v####'),
  { kind: 'unknown', raw: 'OS5319+1*normal*PFB14680645*8*MSH01018*20260208101256*938474284*A0031303' },
  'freight-label scan is unknown',
);
assertEqual<Scan>(classify('vXYZ', 'v####'), { kind: 'unknown', raw: 'vXYZ' }, 'letters where digits expected is unknown');
assertEqual<Scan>(classify('12345', 'v####'), { kind: 'unknown', raw: '12345' }, 'wrong digit length is unknown');

// --- a Luhn-valid digit run inside a code carrying letters is NOT a person ---
// '8001011231' on its own is a real personnummer; prefixed by anything
// non-numeric it must not be mistaken for one, or a mis-scan creates a junk
// guest record.
assertEqual<Scan>(
  classify('v8001011231', 'v####'),
  { kind: 'unknown', raw: 'v8001011231' },
  'weapon prefix + valid ssn digits is unknown, not ssn',
);
assertEqual<Scan>(
  classify('x8001011231', 'v####'),
  { kind: 'unknown', raw: 'x8001011231' },
  'stray letter + valid ssn digits is unknown, not ssn',
);
assertEqual<Scan>(
  classify('A0031303938474284', 'v####'),
  { kind: 'unknown', raw: 'A0031303938474284' },
  'parcel-label fragment is unknown',
);
// Hyphen and surrounding whitespace stay acceptable — that is how a licence
// barcode and a hand-typed personnummer actually look.
assertEqual<Scan>(
  classify(' 800101-1231 ', 'v####'),
  { kind: 'ssn', ssn: '19800101-1231' },
  'hyphen and padding whitespace still accepted',
);

// --- scanMatch: resolving a scan against loaded rows ---
// Member SSNs are stored in whatever shape they were entered, so matching is
// on the last 10 digits, never on the string.
assert(ssnDigits('19800101-1231') === '8001011231', '12-digit ssn reduces to 10');
assert(ssnDigits('800101-1231') === '8001011231', '10-digit hyphenated ssn reduces to 10');
assert(ssnDigits(null) === '', 'null ssn is empty');

const users = [
  { name: 'retired', ssn: '800101-1231', active: false },
  { name: 'guest', ssn: '19800101-1231', active: true },
  { name: 'other', ssn: '19701111-1111', active: true },
];
assertEqual(
  findUserBySsn(users, '19800101-1231')?.name,
  'guest',
  'active row wins over a retired row holding the same ssn',
);
assertEqual(
  findUserBySsn([users[0]], '800101-1231')?.name,
  'retired',
  'a retired member is still found when no active row shares the ssn',
);
assertEqual(findUserBySsn(users, '19990101-0000')?.name, undefined, 'unknown ssn matches nothing');

const weapons = [
  { displayId: '1', active: true },
  { displayId: '0001', active: false },
  { displayId: null, active: true },
];
assertEqual(
  findWeaponByCandidates(weapons, ['0001', '1'])?.displayId,
  '1',
  'active weapon wins over a retired weapon holding a padded form of the tag',
);
assertEqual(findWeaponByCandidates(weapons, ['99'])?.displayId, undefined, 'unknown tag matches nothing');
assertEqual(
  findWeaponByCandidates(weapons, [])?.displayId,
  undefined,
  'a null display_id never matches an empty candidate list',
);

console.log(`scan.check.ts: ${count} assertions passed`);
