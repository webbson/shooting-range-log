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
  createdAt: string;
  updatedAt: string;
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
export const nextUserDisplayId = () => invoke<string>('next_user_display_id');
export const createUser = (input: NewUser) => invoke<User>('create_user', { input });
export const updateUser = (input: UpdateUser) => invoke<User>('update_user', { input });
export const setUserActive = (uid: number, active: boolean, clearDisplayId = false) =>
  invoke<User>('set_user_active', { uid, active, clearDisplayId });

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
  suggestedUserUid: number | null;
  suggestedUserName: string | null;
  suggestedUserDisplayId: string | null;
  suggestedUserActive: boolean;
  suggestedUserBusy: boolean;
  suggestedWeaponUid: number | null;
  suggestedWeaponBrand: string | null;
  suggestedWeaponModel: string | null;
  suggestedWeaponSerial: string | null;
  suggestedWeaponDisplayId: string | null;
  suggestedWeaponCaliber: string | null;
  suggestedWeaponActive: boolean;
  suggestedWeaponOut: boolean;
  weaponInactive: boolean;
  weaponInactiveReason: string | null;
  weaponAlreadyOut: boolean;
  openHolderName: string | null;
  openHolderDisplay: string | null;
  openHolderActive: boolean;
  openCheckoutId: number | null;
  userInactive: boolean;
  userOutstandingDebtKr: number;
  fresherUserName: string | null;
  fresherUserDisplay: string | null;
  fresherUserActive: boolean;
  fresherUserAt: string | null;
  canCheckout: boolean;
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
}

export const evaluateCheckout = (weaponUid: number | null, userUid: number | null) =>
  invoke<CheckoutEval>('evaluate_checkout', { weaponUid, userUid });

export const doCheckout = (
  weaponUid: number,
  userUid: number,
  operatorUid: number,
  notes?: string,
) => invoke<Checkout>('checkout', { weaponUid, userUid, operatorUid, notes });

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
