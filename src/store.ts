import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from './i18n';

export type Lang = 'sv' | 'en';

/** The operator is a user (is_staff). `uid` is the FK recorded on every logged
 *  action; `name` is for display. */
export interface Operator {
  uid: number;
  name: string;
  isAdmin: boolean;
}

interface AppState {
  /** Chosen at launch. Never persisted — must be re-selected each session. */
  operator: Operator | null;
  /** uid of the most recently chosen operator, persisted so the picker can
   *  preselect them by default (the operator itself is still re-confirmed). */
  lastOperatorUid: number | null;
  language: Lang;
  /** Window fullscreen mode. Persisted so the app relaunches in the same mode. */
  fullscreen: boolean;
  /** Handheld scanner: whether the global capture listener is active. Persisted —
   *  per-laptop hardware config. */
  scannerEnabled: boolean;
  /** Handheld scanner: max inter-keystroke gap (ms) before a burst is treated as
   *  human typing rather than a scan. Persisted. */
  scannerMaxGapMs: number;
  /** Handheld scanner: weapon QR template, e.g. 'v####'. Persisted. */
  scannerWeaponFormat: string;
  /** True while the settings Measure modal is open, so the global capture listener
   *  (useScanner) stands down instead of swallowing the Enter or toasting over the
   *  very code being measured. Transient per-session state — NOT persisted. */
  scannerSuspended: boolean;
  setOperator: (op: Operator | null) => void;
  setLanguage: (lang: Lang) => void;
  setFullscreen: (on: boolean) => void;
  setScannerEnabled: (on: boolean) => void;
  setScannerMaxGapMs: (ms: number) => void;
  setScannerWeaponFormat: (fmt: string) => void;
  setScannerSuspended: (on: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      operator: null,
      lastOperatorUid: null,
      language: 'sv',
      fullscreen: false,
      scannerEnabled: false,
      scannerMaxGapMs: 60,
      scannerWeaponFormat: 'v####',
      scannerSuspended: false,
      // Selecting an operator also remembers them; clearing (switch) keeps the
      // last uid so the picker still defaults to it.
      setOperator: (op) => set(op ? { operator: op, lastOperatorUid: op.uid } : { operator: op }),
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
      },
      setFullscreen: (fullscreen) => set({ fullscreen }),
      setScannerEnabled: (scannerEnabled) => set({ scannerEnabled }),
      setScannerMaxGapMs: (scannerMaxGapMs) => set({ scannerMaxGapMs }),
      setScannerWeaponFormat: (scannerWeaponFormat) => set({ scannerWeaponFormat }),
      setScannerSuspended: (scannerSuspended) => set({ scannerSuspended }),
    }),
    {
      name: 'srl-app',
      // Persist language + fullscreen + last operator uid + scanner settings —
      // the active operator and scannerSuspended (transient modal flag) are per-session.
      partialize: (s) => ({
        language: s.language,
        fullscreen: s.fullscreen,
        lastOperatorUid: s.lastOperatorUid,
        scannerEnabled: s.scannerEnabled,
        scannerMaxGapMs: s.scannerMaxGapMs,
        scannerWeaponFormat: s.scannerWeaponFormat,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) i18n.changeLanguage(state.language);
      },
    },
  ),
);
