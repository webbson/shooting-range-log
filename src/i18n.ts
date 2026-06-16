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

      // Operator picker
      pick_operator: 'Välj operatör',
      no_operators_hint:
        'Inga operatörer. Lägg till en medlem med personalbehörighet först.',
      change_operator: 'Byt operatör',

      // Generic actions / status
      save: 'Spara',
      cancel: 'Avbryt',
      edit: 'Redigera',
      activate: 'Aktivera',
      deactivate: 'Inaktivera',
      saved: 'Sparat',
      staff: 'Personal',
      active: 'Aktiv',
      inactive: 'Inaktiv',
      status: 'Status',

      // Members
      new_member: 'Ny medlem',
      edit_member: 'Redigera medlem',
      no_members: 'Inga medlemmar ännu.',

      // Weapons
      new_weapon: 'Nytt vapen',
      edit_weapon: 'Redigera vapen',
      no_weapons: 'Inga vapen ännu.',
      inactive_reason: 'Orsak till inaktivering',
      confirm_deactivate_title: 'Inaktivera',

      // Fields
      field_display_id: 'ID',
      field_member_number: 'Medlemsnummer',
      field_name: 'Namn',
      field_email: 'E-post',
      field_phone: 'Telefon',
      field_address: 'Adress',
      field_ssn: 'Personnummer',
      field_is_staff: 'Personal (operatör)',
      field_notes: 'Anteckningar',
      field_brand: 'Märke',
      field_model: 'Modell',
      field_serial: 'Serienummer',
      name_required: 'Namn krävs.',
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

      // Operator picker
      pick_operator: 'Select operator',
      no_operators_hint: 'No operators. Add a member with staff access first.',
      change_operator: 'Change operator',

      // Generic actions / status
      save: 'Save',
      cancel: 'Cancel',
      edit: 'Edit',
      activate: 'Activate',
      deactivate: 'Deactivate',
      saved: 'Saved',
      staff: 'Staff',
      active: 'Active',
      inactive: 'Inactive',
      status: 'Status',

      // Members
      new_member: 'New member',
      edit_member: 'Edit member',
      no_members: 'No members yet.',

      // Weapons
      new_weapon: 'New weapon',
      edit_weapon: 'Edit weapon',
      no_weapons: 'No weapons yet.',
      inactive_reason: 'Reason for deactivation',
      confirm_deactivate_title: 'Deactivate',

      // Fields
      field_display_id: 'ID',
      field_member_number: 'Member number',
      field_name: 'Name',
      field_email: 'Email',
      field_phone: 'Phone',
      field_address: 'Address',
      field_ssn: 'SSN',
      field_is_staff: 'Staff (operator)',
      field_notes: 'Notes',
      field_brand: 'Brand',
      field_model: 'Model',
      field_serial: 'Serial number',
      name_required: 'Name is required.',
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
