import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from './i18n';

export type Lang = 'sv' | 'en';

/** The operator is a user (is_staff). `uid` is the FK recorded on every logged
 *  action; `name` is for display. */
export interface Operator {
  uid: number;
  name: string;
}

interface AppState {
  /** Chosen at launch. Never persisted — must be re-selected each session. */
  operator: Operator | null;
  language: Lang;
  setOperator: (op: Operator | null) => void;
  setLanguage: (lang: Lang) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      operator: null,
      language: 'sv',
      setOperator: (op) => set({ operator: op }),
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
      },
    }),
    {
      name: 'srl-app',
      // Persist language only — operator selection is per-session.
      partialize: (s) => ({ language: s.language }),
      onRehydrateStorage: () => (state) => {
        if (state) i18n.changeLanguage(state.language);
      },
    },
  ),
);
