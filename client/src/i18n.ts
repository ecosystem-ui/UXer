import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import he from './locales/he';

export const SUPPORTED_LANGUAGES = ['en', 'he'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'uxer.language';
const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

function initialLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'he') return stored;
  } catch {
    // ignore storage errors (e.g. privacy mode)
  }
  return DEFAULT_LANGUAGE;
}

export function setLanguage(language: SupportedLanguage) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // ignore
  }
  void i18n.changeLanguage(language);
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    he: { translation: he },
  },
  lng: initialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    // React already escapes interpolated values.
    escapeValue: false,
  },
});

// Keep the document language attribute in sync with the active locale.
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

export default i18n;
