/** Dev-only Tauri IPC stand-in, so the UI can run in a plain browser
 *  (`npm run dev:mock`) for screenshots of the user guide.
 *
 *  It installs `window.__TAURI_INTERNALS__` before React mounts and answers the
 *  commands the everyday screens use from an in-memory fixture set. Mutations
 *  mutate that set, so a full checkout → check-in flow works end to end.
 *
 *  All data here is invented (this repo is public). Personnummer are
 *  Luhn-valid throwaway values, never a real person's.
 *
 *  Never imported by the real app: `main.tsx` loads it only when
 *  `import.meta.env.VITE_MOCK_IPC` is set, which only `npm run dev:mock` sets.
 */

interface MockUser {
  uid: number;
  displayId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  ssn: string | null;
  isStaff: boolean;
  active: boolean;
  notes: string | null;
  preferredWeaponUid: number | null;
  createdAt: string;
  updatedAt: string;
  isGuest: boolean;
  isAdmin: boolean;
}

interface MockWeapon {
  uid: number;
  displayId: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  caliber: string | null;
  active: boolean;
  inactiveReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  tagNeedsService: boolean;
  tagBroken: boolean;
  tagMissingParts: boolean;
  tagNeedsCleaning: boolean;
  tagComment: string | null;
}

interface MockCheckout {
  id: number;
  weaponUid: number;
  userUid: number;
  operatorOutUid: number;
  checkedOutAt: string;
  operatorInUid: number | null;
  checkedInAt: string | null;
  notes: string | null;
}

const now = () => new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

const user = (u: Partial<MockUser> & { uid: number; name: string }): MockUser => ({
  displayId: null,
  email: null,
  phone: null,
  address: null,
  ssn: null,
  isStaff: false,
  active: true,
  notes: null,
  preferredWeaponUid: null,
  createdAt: daysAgo(400),
  updatedAt: daysAgo(400),
  isGuest: false,
  isAdmin: false,
  ...u,
});

const weapon = (w: Partial<MockWeapon> & { uid: number; displayId: string }): MockWeapon => ({
  brand: null,
  model: null,
  serial: null,
  caliber: null,
  active: true,
  inactiveReason: null,
  notes: null,
  createdAt: daysAgo(400),
  updatedAt: daysAgo(400),
  tagNeedsService: false,
  tagBroken: false,
  tagMissingParts: false,
  tagNeedsCleaning: false,
  tagComment: null,
  ...w,
});

const users: MockUser[] = [
  user({ uid: 1, name: 'Karin Ek', isStaff: true, isAdmin: true, ssn: '19850615-1235', phone: '070-000 00 01', email: 'karin@example.invalid', preferredWeaponUid: 1 }),
  user({ uid: 2, name: 'Johan Berg', isStaff: true, ssn: '19771122-0678', phone: '070-000 00 02' }),
  user({ uid: 3, name: 'Anna Lind', ssn: '19920308-4513', phone: '070-000 00 03', preferredWeaponUid: 3 }),
  user({ uid: 4, name: 'Erik Sund', ssn: '19990807-3191' }),
  user({ uid: 5, name: 'Maja Holm', ssn: '20010419-5227', preferredWeaponUid: 5 }),
  user({ uid: 6, name: 'Petter Råå', ssn: '19680228-7414' }),
  user({ uid: 7, name: 'Sara Falk', isGuest: true, ssn: '19920308-4513' }),
  user({ uid: 8, name: 'Olle Vinter', active: false, notes: 'Utträdd 2025.' }),
];

const weapons: MockWeapon[] = [
  weapon({ uid: 1, displayId: '12', brand: 'Glock', model: '17', caliber: '9 mm', serial: 'GL-1001' }),
  weapon({ uid: 2, displayId: '14', brand: 'Glock', model: '19', caliber: '9 mm', serial: 'GL-1002' }),
  weapon({ uid: 3, displayId: '23', brand: 'CZ', model: 'Shadow 2', caliber: '9 mm', serial: 'CZ-2003' }),
  weapon({ uid: 4, displayId: '31', brand: 'Sig Sauer', model: 'P226', caliber: '9 mm', serial: 'SS-3004', tagNeedsCleaning: true, tagComment: 'Rengörs efter helgen.' }),
  weapon({ uid: 5, displayId: '36', brand: 'Smith & Wesson', model: 'Model 686', caliber: '.357 Magnum', serial: 'SW-3605' }),
  weapon({ uid: 6, displayId: '42', brand: 'Walther', model: 'GSP', caliber: '.22 LR', serial: 'WA-4206' }),
  weapon({ uid: 7, displayId: '47', brand: 'Pardini', model: 'SP', caliber: '.22 LR', serial: 'PA-4707', tagNeedsService: true, tagComment: 'Trycket känns långt.' }),
  weapon({ uid: 8, displayId: '55', brand: 'Beretta', model: '92FS', caliber: '9 mm', serial: 'BE-5508', active: false, inactiveReason: 'Såld' }),
];

const checkouts: MockCheckout[] = [
  { id: 1, weaponUid: 3, userUid: 3, operatorOutUid: 1, checkedOutAt: hoursAgo(2), operatorInUid: null, checkedInAt: null, notes: null },
  { id: 2, weaponUid: 6, userUid: 4, operatorOutUid: 1, checkedOutAt: hoursAgo(1), operatorInUid: null, checkedInAt: null, notes: null },
  { id: 3, weaponUid: 1, userUid: 5, operatorOutUid: 2, checkedOutAt: daysAgo(3), operatorInUid: 2, checkedInAt: daysAgo(3), notes: null },
  { id: 4, weaponUid: 5, userUid: 6, operatorOutUid: 2, checkedOutAt: daysAgo(9), operatorInUid: 1, checkedInAt: daysAgo(9), notes: null },
];

interface MockDebt {
  id: number;
  userUid: number;
  operatorUid: number;
  amountKr: number;
  reason: string | null;
  createdAt: string;
  settledAt: string | null;
  settledOperatorUid: number | null;
  checkoutId: number | null;
}

const debts: MockDebt[] = [
  { id: 1, userUid: 4, operatorUid: 1, amountKr: 120, reason: 'Ammunition', createdAt: daysAgo(4), settledAt: null, settledOperatorUid: null, checkoutId: null },
];

const service = [
  { id: 1, weaponUid: 7, operatorUid: 2, operatorName: 'Johan Berg', servicedAt: daysAgo(30), description: 'Rengöring och funktionskontroll', notes: null },
];

let nextId = 100;

const byUid = <T extends { uid: number }>(list: T[], uid: number) => list.find((x) => x.uid === uid) ?? null;
const userLabel = (u: MockUser | null) => (u ? u.name : null);

function openCheckouts() {
  return checkouts
    .filter((c) => !c.checkedInAt)
    .map((c) => {
      const u = byUid(users, c.userUid);
      const w = byUid(weapons, c.weaponUid);
      return {
        id: c.id,
        weaponUid: c.weaponUid,
        userUid: c.userUid,
        userName: userLabel(u),
        userDisplayId: u?.displayId ?? null,
        userActive: u?.active ?? false,
        weaponBrand: w?.brand ?? null,
        weaponModel: w?.model ?? null,
        weaponSerial: w?.serial ?? null,
        weaponDisplayId: w?.displayId ?? null,
        weaponCaliber: w?.caliber ?? null,
        weaponActive: w?.active ?? false,
        checkedOutAt: c.checkedOutAt,
        userIsGuest: u?.isGuest ?? false,
      };
    });
}

function evaluate(weaponUid: number | null, userUid: number | null) {
  const w = weaponUid ? byUid(weapons, weaponUid) : null;
  const u = userUid ? byUid(users, userUid) : null;
  const open = w ? checkouts.find((c) => c.weaponUid === w.uid && !c.checkedInAt) : undefined;
  const holder = open ? byUid(users, open.userUid) : null;
  const suggested = u?.preferredWeaponUid ? byUid(weapons, u.preferredWeaponUid) : null;
  const debtKr = u ? debts.filter((d) => d.userUid === u.uid && !d.settledAt).reduce((s, d) => s + d.amountKr, 0) : 0;
  const tags: string[] = [];
  if (w?.tagNeedsService) tags.push('needs_service');
  if (w?.tagBroken) tags.push('broken');
  if (w?.tagMissingParts) tags.push('missing_parts');
  if (w?.tagNeedsCleaning) tags.push('needs_cleaning');
  return {
    suggestedWeaponUid: suggested?.uid ?? null,
    suggestedWeaponBrand: suggested?.brand ?? null,
    suggestedWeaponModel: suggested?.model ?? null,
    suggestedWeaponSerial: suggested?.serial ?? null,
    suggestedWeaponDisplayId: suggested?.displayId ?? null,
    suggestedWeaponCaliber: suggested?.caliber ?? null,
    suggestedWeaponActive: suggested?.active ?? false,
    suggestedWeaponOut: suggested ? checkouts.some((c) => c.weaponUid === suggested.uid && !c.checkedInAt) : false,
    lastWeaponUid: null,
    weaponInactive: w ? !w.active : false,
    weaponInactiveReason: w?.inactiveReason ?? null,
    weaponAlreadyOut: !!open,
    openHolderName: userLabel(holder),
    openHolderDisplay: holder?.displayId ?? null,
    openHolderActive: holder?.active ?? false,
    openCheckoutId: open?.id ?? null,
    userInactive: u ? !u.active : false,
    userOutstandingDebtKr: debtKr,
    canCheckout: !!w && !!u && w.active && u.active && !open,
    weaponTags: tags,
    weaponTagComment: w?.tagComment ?? null,
  };
}

type Args = Record<string, unknown>;

const handlers: Record<string, (a: Args) => unknown> = {
  db_health: () => 'ok',
  has_admin: () => true,
  get_background: () => null,
  list_backups: () => [],
  get_settings: () => ({}),

  list_users: () => users,
  list_operators: () => users.filter((u) => u.isStaff && u.active),
  get_user: (a) => byUid(users, a.uid as number),
  create_user: (a) => {
    const input = a.input as Partial<MockUser>;
    const u = user({ ...input, uid: ++nextId, name: input.name ?? 'Ny medlem' });
    users.push(u);
    return u;
  },
  update_user: (a) => {
    const input = a.input as Partial<MockUser> & { uid: number };
    const u = byUid(users, input.uid)!;
    Object.assign(u, input, { updatedAt: now() });
    return u;
  },
  set_user_active: (a) => {
    const u = byUid(users, a.uid as number)!;
    u.active = a.active as boolean;
    return u;
  },
  set_preferred_weapon: (a) => {
    const u = byUid(users, a.userUid as number)!;
    u.preferredWeaponUid = (a.weaponUid as number | null) ?? null;
    return u;
  },
  upsert_guest: (a) => {
    const ssn = a.ssn as string;
    const existing = users.find((u) => u.isGuest && u.ssn === ssn && u.active);
    if (existing) return existing;
    const g = user({ uid: ++nextId, name: a.name as string, ssn, isGuest: true });
    users.push(g);
    return g;
  },
  promote_guest: (a) => {
    const u = byUid(users, a.uid as number)!;
    u.isGuest = false;
    return u;
  },

  list_weapons: () => weapons,
  get_weapon: (a) => byUid(weapons, a.uid as number),
  next_weapon_display_id: () => '57',
  create_weapon: (a) => {
    const input = a.input as Partial<MockWeapon>;
    const w = weapon({ ...input, uid: ++nextId, displayId: input.displayId ?? '57' });
    weapons.push(w);
    return w;
  },
  update_weapon: (a) => {
    const input = a.input as Partial<MockWeapon> & { uid: number };
    const w = byUid(weapons, input.uid)!;
    Object.assign(w, input, { updatedAt: now() });
    return w;
  },
  set_weapon_active: (a) => {
    const w = byUid(weapons, a.uid as number)!;
    w.active = a.active as boolean;
    w.inactiveReason = (a.inactiveReason as string | null) ?? null;
    return w;
  },
  set_weapon_tags: (a) => {
    const w = byUid(weapons, a.weaponUid as number)!;
    w.tagNeedsService = a.needsService as boolean;
    w.tagBroken = a.broken as boolean;
    w.tagMissingParts = a.missingParts as boolean;
    w.tagNeedsCleaning = a.needsCleaning as boolean;
    w.tagComment = (a.comment as string | null) ?? null;
    return w;
  },

  evaluate_checkout: (a) => evaluate(a.weaponUid as number | null, a.userUid as number | null),
  checkout: (a) => {
    const c: MockCheckout = {
      id: ++nextId,
      weaponUid: a.weaponUid as number,
      userUid: a.userUid as number,
      operatorOutUid: a.operatorUid as number,
      checkedOutAt: now(),
      operatorInUid: null,
      checkedInAt: null,
      notes: null,
    };
    checkouts.push(c);
    if (a.assign) byUid(users, c.userUid)!.preferredWeaponUid = c.weaponUid;
    return c;
  },
  checkin: (a) => {
    const c = checkouts.find((x) => x.id === (a.checkoutId as number))!;
    c.checkedInAt = now();
    c.operatorInUid = a.operatorUid as number;
    return c;
  },
  list_open_checkouts: () => openCheckouts(),

  outstanding_debts: () =>
    users
      .map((u) => ({ userUid: u.uid, amountKr: debts.filter((d) => d.userUid === u.uid && !d.settledAt).reduce((s, d) => s + d.amountKr, 0) }))
      .filter((d) => d.amountKr > 0),
  list_user_debts: (a) => debts.filter((d) => d.userUid === (a.userUid as number)),
  add_debt: (a) => {
    const d: MockDebt = {
      id: ++nextId,
      userUid: a.userUid as number,
      operatorUid: a.operatorUid as number,
      amountKr: a.amountKr as number,
      reason: (a.reason as string) ?? null,
      createdAt: now(),
      settledAt: null,
      settledOperatorUid: null,
      checkoutId: (a.checkoutId as number) ?? null,
    };
    debts.push(d);
    return d;
  },
  settle_debt: (a) => {
    const d = debts.find((x) => x.id === (a.debtId as number))!;
    d.settledAt = now();
    d.settledOperatorUid = a.operatorUid as number;
    return d;
  },

  last_shot_dates: () =>
    users
      .map((u) => {
        const last = checkouts.filter((c) => c.userUid === u.uid).sort((a, b) => b.checkedOutAt.localeCompare(a.checkedOutAt))[0];
        return last ? { userUid: u.uid, lastShotAt: last.checkedOutAt } : null;
      })
      .filter(Boolean),
  last_weapon_users: () =>
    weapons
      .map((w) => {
        const last = checkouts.filter((c) => c.weaponUid === w.uid).sort((a, b) => b.checkedOutAt.localeCompare(a.checkedOutAt))[0];
        if (!last) return null;
        const u = byUid(users, last.userUid);
        return { weaponUid: w.uid, userUid: last.userUid, userName: userLabel(u), userDisplayId: u?.displayId ?? null, userActive: u?.active ?? false, lastUsedAt: last.checkedOutAt };
      })
      .filter(Boolean),

  list_checkouts: (a) =>
    checkouts
      .filter((c) => (a.weaponUid ? c.weaponUid === a.weaponUid : true))
      .filter((c) => (a.userUid ? c.userUid === a.userUid : true))
      .filter((c) => (a.onlyOpen ? !c.checkedInAt : true))
      .sort((x, y) => y.checkedOutAt.localeCompare(x.checkedOutAt))
      .map((c) => {
        const u = byUid(users, c.userUid);
        const w = byUid(weapons, c.weaponUid);
        return {
          id: c.id,
          weaponUid: c.weaponUid,
          userUid: c.userUid,
          userName: userLabel(u),
          userDisplayId: u?.displayId ?? null,
          userActive: u?.active ?? false,
          weaponBrand: w?.brand ?? null,
          weaponModel: w?.model ?? null,
          weaponSerial: w?.serial ?? null,
          weaponDisplayId: w?.displayId ?? null,
          weaponCaliber: w?.caliber ?? null,
          weaponActive: w?.active ?? false,
          checkedOutAt: c.checkedOutAt,
          checkedInAt: c.checkedInAt,
          operatorOutName: userLabel(byUid(users, c.operatorOutUid)),
          operatorInName: c.operatorInUid ? userLabel(byUid(users, c.operatorInUid)) : null,
          notes: c.notes,
          userIsGuest: u?.isGuest ?? false,
        };
      }),
  list_weapon_service: (a) => service.filter((s) => s.weaponUid === (a.weaponUid as number)),
};

const mockInvoke = async (cmd: string, args: Args = {}) => {
  // Plugin calls (window, updater, opener, dialog) are no-ops in the browser.
  if (cmd.startsWith('plugin:')) return null;
  const handler = handlers[cmd];
  if (!handler) {
    console.warn('[mockIpc] unhandled command', cmd, args);
    return null;
  }
  return handler(args);
};

let callbackId = 0;

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: (cmd: string, args: Args) => mockInvoke(cmd, args),
  transformCallback: (cb?: (v: unknown) => void) => {
    const id = ++callbackId;
    (window as unknown as Record<string, unknown>)[`_${id}`] = cb ?? (() => {});
    return id;
  },
  metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
  plugins: {},
  convertFileSrc: (p: string) => p,
};

console.info('[mockIpc] Tauri IPC mocked — browser preview only');

export {};
