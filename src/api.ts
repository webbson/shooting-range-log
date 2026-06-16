import { invoke } from '@tauri-apps/api/core';

// Thin typed wrappers over Tauri commands. All DB access goes through Rust.
export const dbHealth = () => invoke<string>('db_health');
