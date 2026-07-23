import { invoke } from '@tauri-apps/api/core';

// Thin typed wrappers over Tauri commands. All DB access goes through Rust.
export const dbHealth = () => invoke<string>('db_health');

// ---- Interfaces ----

export interface User {
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

export interface NewUser {
  displayId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  ssn?: string | null;
  isStaff: boolean;
  notes?: string | null;
  isAdmin?: boolean;
}

export interface UpdateUser extends NewUser {
  uid: number;
}

export interface Weapon {
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

export interface NewWeapon {
  displayId?: string | null;
  brand?: string | null;
  model?: string | null;
  serial?: string | null;
  caliber?: string | null;
  notes?: string | null;
}

export interface UpdateWeapon extends NewWeapon {
  uid: number;
}

// ---- User commands ----

export const listUsers = () => invoke<User[]>('list_users');
export const listOperators = () => invoke<User[]>('list_operators');
export const getUser = (uid: number) => invoke<User | null>('get_user', { uid });
export const createUser = (input: NewUser) => invoke<User>('create_user', { input });
export const updateUser = (input: UpdateUser) => invoke<User>('update_user', { input });
export const setUserActive = (uid: number, active: boolean, clearDisplayId = false) =>
  invoke<User>('set_user_active', { uid, active, clearDisplayId });

export const setPreferredWeapon = (userUid: number, weaponUid: number | null) =>
  invoke<User>('set_preferred_weapon', { userUid, weaponUid });

// ---- Guests ----

export const upsertGuest = (name: string, ssn: string) =>
  invoke<User>('upsert_guest', { name, ssn });
export const promoteGuest = (uid: number) => invoke<User>('promote_guest', { uid });
export const hasAdmin = () => invoke<boolean>('has_admin');

// ---- Weapon tags ----

/** Fixed tag set; i18n label key = `tag_${key}`, weapon field = camelCase `tag${Key}`. */
export const WEAPON_TAG_KEYS = [
  'needs_service',
  'broken',
  'missing_parts',
  'needs_cleaning',
] as const;
export type WeaponTagKey = (typeof WEAPON_TAG_KEYS)[number];

export interface WeaponTags {
  needsService: boolean;
  broken: boolean;
  missingParts: boolean;
  needsCleaning: boolean;
  comment: string | null;
}

export const setWeaponTags = (weaponUid: number, tags: WeaponTags) =>
  invoke<Weapon>('set_weapon_tags', {
    weaponUid,
    needsService: tags.needsService,
    broken: tags.broken,
    missingParts: tags.missingParts,
    needsCleaning: tags.needsCleaning,
    comment: tags.comment,
  });

/** Active tag keys for a weapon row (weapons list / pickers / info modal). */
export const activeTagKeys = (w: Weapon): WeaponTagKey[] => {
  const out: WeaponTagKey[] = [];
  if (w.tagNeedsService) out.push('needs_service');
  if (w.tagBroken) out.push('broken');
  if (w.tagMissingParts) out.push('missing_parts');
  if (w.tagNeedsCleaning) out.push('needs_cleaning');
  return out;
};

// ---- Weapon commands ----

export const listWeapons = () => invoke<Weapon[]>('list_weapons');
export const getWeapon = (uid: number) => invoke<Weapon | null>('get_weapon', { uid });
export const nextWeaponDisplayId = () => invoke<string>('next_weapon_display_id');
export const createWeapon = (input: NewWeapon) => invoke<Weapon>('create_weapon', { input });
export const updateWeapon = (input: UpdateWeapon) => invoke<Weapon>('update_weapon', { input });
export const setWeaponActive = (
  uid: number,
  active: boolean,
  inactiveReason?: string,
  clearDisplayId = false,
) => invoke<Weapon>('set_weapon_active', { uid, active, inactiveReason, clearDisplayId });

// ---- Checkout / checkin ----

export interface CheckoutEval {
  suggestedWeaponUid: number | null;
  suggestedWeaponBrand: string | null;
  suggestedWeaponModel: string | null;
  suggestedWeaponSerial: string | null;
  suggestedWeaponDisplayId: string | null;
  suggestedWeaponCaliber: string | null;
  suggestedWeaponActive: boolean;
  suggestedWeaponOut: boolean;
  lastWeaponUid: number | null;
  weaponInactive: boolean;
  weaponInactiveReason: string | null;
  weaponAlreadyOut: boolean;
  openHolderName: string | null;
  openHolderDisplay: string | null;
  openHolderActive: boolean;
  openCheckoutId: number | null;
  userInactive: boolean;
  userOutstandingDebtKr: number;
  canCheckout: boolean;
  weaponTags: string[];
  weaponTagComment: string | null;
}

export interface Checkout {
  id: number;
  weaponUid: number;
  userUid: number;
  operatorOutUid: number;
  checkedOutAt: string;
  operatorInUid: number | null;
  checkedInAt: string | null;
  notes: string | null;
}

export interface OpenCheckout {
  id: number;
  weaponUid: number;
  userUid: number;
  userName: string | null;
  userDisplayId: string | null;
  userActive: boolean;
  weaponBrand: string | null;
  weaponModel: string | null;
  weaponSerial: string | null;
  weaponDisplayId: string | null;
  weaponCaliber: string | null;
  weaponActive: boolean;
  checkedOutAt: string;
  userIsGuest: boolean;
}

export const evaluateCheckout = (weaponUid: number | null, userUid: number | null) =>
  invoke<CheckoutEval>('evaluate_checkout', { weaponUid, userUid });

export const doCheckout = (
  weaponUid: number,
  userUid: number,
  operatorUid: number,
  assign?: boolean,
) => invoke<Checkout>('checkout', { weaponUid, userUid, operatorUid, assign });

export const doCheckin = (checkoutId: number, operatorUid: number) =>
  invoke<Checkout>('checkin', { checkoutId, operatorUid });

export const listOpenCheckouts = () => invoke<OpenCheckout[]>('list_open_checkouts');

// ---- Debt ----

export interface Debt {
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

export interface OutstandingDebt {
  userUid: number;
  amountKr: number;
}

export const addDebt = (
  userUid: number,
  operatorUid: number,
  amountKr: number,
  reason?: string,
  checkoutId?: number,
) => invoke<Debt>('add_debt', { userUid, operatorUid, amountKr, reason, checkoutId });

export const listUserDebts = (userUid: number) =>
  invoke<Debt[]>('list_user_debts', { userUid });

export const settleDebt = (debtId: number, operatorUid: number) =>
  invoke<Debt>('settle_debt', { debtId, operatorUid });

export const outstandingDebts = () => invoke<OutstandingDebt[]>('outstanding_debts');

export interface LastShot {
  userUid: number;
  lastShotAt: string;
}

export const lastShotDates = () => invoke<LastShot[]>('last_shot_dates');

export interface WeaponLastUse {
  weaponUid: number;
  userUid: number;
  userName: string | null;
  userDisplayId: string | null;
  userActive: boolean;
  lastUsedAt: string;
}

export const lastWeaponUsers = () => invoke<WeaponLastUse[]>('last_weapon_users');

// ---- Logs ----

export interface CheckoutLog {
  id: number;
  weaponUid: number;
  userUid: number;
  userName: string | null;
  userDisplayId: string | null;
  userActive: boolean;
  weaponBrand: string | null;
  weaponModel: string | null;
  weaponSerial: string | null;
  weaponDisplayId: string | null;
  weaponCaliber: string | null;
  weaponActive: boolean;
  checkedOutAt: string;
  checkedInAt: string | null;
  operatorOutName: string | null;
  operatorInName: string | null;
  notes: string | null;
  userIsGuest: boolean;
}

export interface CheckoutFilters {
  weaponUid?: number | null;
  userUid?: number | null;
  operatorUid?: number | null;
  from?: string | null;
  to?: string | null;
  onlyOpen?: boolean;
}

export const listCheckouts = (f: CheckoutFilters) =>
  invoke<CheckoutLog[]>('list_checkouts', {
    weaponUid: f.weaponUid ?? null,
    userUid: f.userUid ?? null,
    operatorUid: f.operatorUid ?? null,
    from: f.from ?? null,
    to: f.to ?? null,
    onlyOpen: f.onlyOpen ?? false,
  });

// ---- Weapon service log ----

export interface ServiceLog {
  id: number;
  weaponUid: number;
  operatorUid: number;
  operatorName: string | null;
  servicedAt: string;
  description: string;
  notes: string | null;
}

export const addService = (
  weaponUid: number,
  operatorUid: number,
  description: string,
  notes?: string,
  servicedAt?: string,
) => invoke<ServiceLog>('add_service', { weaponUid, operatorUid, description, notes, servicedAt });

export const listWeaponService = (weaponUid: number) =>
  invoke<ServiceLog[]>('list_weapon_service', { weaponUid });

// ---- Excel import ----

export interface ImportWarning {
  row: number;
  code: string;
  message: string;
}

export interface ImportPreview {
  membersToCreate: number;
  membersToMatch: number;
  weaponsToCreate: number;
  weaponsExisting: number;
  loansToCreate: number;
  loansSkippedDuplicate: number;
  openLoans: number;
  warnings: ImportWarning[];
}

export interface ImportResult {
  membersCreated: number;
  membersMatched: number;
  weaponsCreated: number;
  weaponsMatched: number;
  loansCreated: number;
  loansSkipped: number;
  openLoansMarkedReturned: number;
  warnings: ImportWarning[];
}

export const importListSheets = (path: string) =>
  invoke<string[]>('import_list_sheets', { path });

export const importPreview = (path: string, sheet: string) =>
  invoke<ImportPreview>('import_preview', { path, sheet });

export const importCommit = (path: string, sheet: string, markOpenAsReturned: boolean) =>
  invoke<ImportResult>('import_commit', { path, sheet, markOpenAsReturned });

// ---- Settings (M6) ----

export interface Settings {
  s3Endpoint: string | null;
  s3Region: string | null;
  s3Bucket: string | null;
  s3Prefix: string | null;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  backupPassphrase: string | null;
}

export const getSettings = () => invoke<Settings>('get_settings');
export const updateSettings = (input: Settings) =>
  invoke<void>('update_settings', { input });

// ---- Backup operations (M6) ----

export type BackupSource = 'local' | 'remote';

export interface BackupInfo {
  filename: string;
  timestamp: string;   // RFC3339 UTC
  schemaVersion: number;
  source: BackupSource;
}

export const testS3Connection = (input: Settings) => invoke<string>('test_s3_connection', { input });
export const backupNow = () => invoke<string>('backup_now');
export const listBackups = () => invoke<BackupInfo[]>('list_backups');
export const restoreBackup = (filename: string, source: BackupSource) =>
  invoke<void>('restore_backup', { filename, source });

// ---- Stats & maintenance ----

export interface StatsSummary { loanCount: number; memberCount: number; guestCount: number }
export interface LoanBucket { bucket: string; count: number }
export interface WeaponUsage {
  weaponUid: number; brand: string | null; model: string | null; caliber: string | null;
  displayId: string | null; active: boolean; count: number;
}
export interface MemberActivity {
  userUid: number; name: string; isGuest: boolean; active: boolean; count: number;
}
export interface StaleAssignment {
  userUid: number; name: string; weaponUid: number; brand: string | null; model: string | null;
  caliber: string | null; displayId: string | null; weaponActive: boolean; lastUsed: string | null;
}
export interface NeverBorrowedWeapon {
  weaponUid: number; brand: string | null; model: string | null; caliber: string | null;
  displayId: string | null; createdAt: string;
}
export interface TaggedWeapon {
  weaponUid: number; brand: string | null; model: string | null; caliber: string | null;
  displayId: string | null; tagNeedsService: boolean; tagBroken: boolean;
  tagMissingParts: boolean; tagNeedsCleaning: boolean; tagComment: string | null;
}
export interface GuestRow { userUid: number; name: string; loanCount: number; lastVisit: string | null }
export type ExportKind =
  | 'loans_raw' | 'weapon_usage' | 'member_activity' | 'debts' | 'stale_assignments' | 'guests';
export type Bucket = 'hour' | 'day' | 'month' | 'year';

export const statsSummary = (from: string | null, to: string | null) =>
  invoke<StatsSummary>('stats_summary', { from, to });
export const statsLoansBuckets = (from: string | null, to: string | null, bucket: Bucket) =>
  invoke<LoanBucket[]>('stats_loans_buckets', { from, to, bucket });
export const statsWeaponUsage = (from: string | null, to: string | null) =>
  invoke<WeaponUsage[]>('stats_weapon_usage', { from, to });
export const statsMemberActivity = (from: string | null, to: string | null) =>
  invoke<MemberActivity[]>('stats_member_activity', { from, to });
export const maintenanceStaleAssignments = (months: number) =>
  invoke<StaleAssignment[]>('maintenance_stale_assignments', { months });
export const maintenanceNeverBorrowed = () =>
  invoke<NeverBorrowedWeapon[]>('maintenance_never_borrowed');
export const maintenanceTaggedWeapons = () =>
  invoke<TaggedWeapon[]>('maintenance_tagged_weapons');
export const maintenanceGuests = () => invoke<GuestRow[]>('maintenance_guests');
export const exportCsvCmd = (
  kind: ExportKind,
  path: string,
  from?: string | null,
  to?: string | null,
  months?: number | null,
) =>
  invoke<number>('export_csv', {
    kind,
    path,
    from: from ?? null,
    to: to ?? null,
    months: months ?? null,
  });
