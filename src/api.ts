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
