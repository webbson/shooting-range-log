import { invoke } from '@tauri-apps/api/core';

// Thin typed wrappers over Tauri commands. All DB access goes through Rust.
export const dbHealth = () => invoke<string>('db_health');

// ---- Interfaces ----

export interface User {
  uid: number;
  displayId: string | null;
  memberNumber: string | null;
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
  memberNumber?: string | null;
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
export const setUserActive = (uid: number, active: boolean) =>
  invoke<User>('set_user_active', { uid, active });

// ---- Weapon commands ----

export const listWeapons = () => invoke<Weapon[]>('list_weapons');
export const getWeapon = (uid: number) => invoke<Weapon | null>('get_weapon', { uid });
export const createWeapon = (input: NewWeapon) => invoke<Weapon>('create_weapon', { input });
export const updateWeapon = (input: UpdateWeapon) => invoke<Weapon>('update_weapon', { input });
export const setWeaponActive = (uid: number, active: boolean, inactiveReason?: string) =>
  invoke<Weapon>('set_weapon_active', { uid, active, inactiveReason });

// ---- Checkout / checkin ----

export interface CheckoutEval {
  suggestedUserUid: number | null;
  suggestedUserName: string | null;
  suggestedUserBusy: boolean;
  suggestedWeaponUid: number | null;
  suggestedWeaponLabel: string | null;
  suggestedWeaponOut: boolean;
  weaponInactive: boolean;
  weaponInactiveReason: string | null;
  weaponAlreadyOut: boolean;
  openHolderName: string | null;
  openCheckoutId: number | null;
  userInactive: boolean;
  userOutstandingDebtKr: number;
  fresherUserName: string | null;
  fresherUserAt: string | null;
  canCheckout: boolean;
}

export interface Checkout {
  id: number;
  weaponUid: number;
  userUid: number;
  weaponDisplaySnapshot: string | null;
  weaponLabelSnapshot: string | null;
  userDisplaySnapshot: string | null;
  userNameSnapshot: string | null;
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
  weaponDisplay: string | null;
  weaponLabel: string | null;
  userDisplay: string | null;
  userName: string | null;
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
  userNameSnapshot: string | null;
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
