import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from './i18n';

export type Lang = 'sv' | 'en';

interface AppState {
  /** Operator chosen at launch. Never persisted — must be re-selected each session. */
  operatorName: string | null;
  language: Lang;
  setOperator: (name: string | null) => void;
  setLanguage: (lang: Lang) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      operatorName: null,
      language: 'sv',
      setOperator: (name) => set({ operatorName: name }),
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
