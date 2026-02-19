import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '../i18n';

export type Language = 'en' | 'ko';

interface LanguageStore {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set) => ({
      language: (i18n.language?.substring(0, 2) as Language) || 'en',
      setLanguage: (lang: Language) => {
        i18n.changeLanguage(lang);
        set({ language: lang });
      },
    }),
    {
      name: 'method-studio-language',
      onRehydrateStorage: () => (state) => {
        if (state?.language) {
          i18n.changeLanguage(state.language);
        }
      },
    }
  )
);
