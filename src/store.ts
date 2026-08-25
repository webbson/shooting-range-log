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
  setOperator: (op: Operator | null) => void;
  setLanguage: (lang: Lang) => void;
  setFullscreen: (on: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      operator: null,
      lastOperatorUid: null,
      language: 'sv',
      fullscreen: false,
      // Selecting an operator also remembers them; clearing (switch) keeps the
      // last uid so the picker still defaults to it.
      setOperator: (op) => set(op ? { operator: op, lastOperatorUid: op.uid } : { operator: op }),
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
      },
      setFullscreen: (fullscreen) => set({ fullscreen }),
    }),
    {
      name: 'srl-app',
      // Persist language + fullscreen + last operator uid — the active operator
      // is per-session.
      partialize: (s) => ({
        language: s.language,
        fullscreen: s.fullscreen,
        lastOperatorUid: s.lastOperatorUid,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) i18n.changeLanguage(state.language);
      },
    },
  ),
);
