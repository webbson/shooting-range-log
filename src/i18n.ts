import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Swedish + English. Swedish is the default; English is the fallback.
// All user-facing strings are keyed here — no hardcoded copy in components.
const resources = {
  sv: {
    translation: {
      app_title: 'Skjutbaneliggare',
      nav_checkout: 'Utlämning',
      nav_members: 'Medlemmar',
      nav_weapons: 'Vapen',
      nav_logs: 'Loggar',
      nav_backup: 'Säkerhetskopiering',
      operator: 'Operatör',
      no_operator: 'Ingen operatör vald',
      language: 'Språk',
      theme: 'Tema',
      db_status: 'Databas',
      db_checking: 'Kontrollerar…',
      db_error: 'Databasfel',
      page_todo: 'Byggs i ett senare steg.',
    },
  },
  en: {
    translation: {
      app_title: 'Shooting Range Log',
      nav_checkout: 'Checkout',
      nav_members: 'Members',
      nav_weapons: 'Weapons',
      nav_logs: 'Logs',
      nav_backup: 'Backup',
      operator: 'Operator',
      no_operator: 'No operator selected',
      language: 'Language',
      theme: 'Theme',
      db_status: 'Database',
      db_checking: 'Checking…',
      db_error: 'Database error',
      page_todo: 'Built in a later milestone.',
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'sv',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
