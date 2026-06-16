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
      add_first_operator: 'Lägg till operatör',
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

      // Error codes from Rust
      err_display_id_taken: "ID '{{displayId}}' används redan av en annan aktiv post.",
      err_serial_taken:
        "Serienummer '{{serial}}' är redan registrerat på ett annat vapen.",
      err_name_required: 'Namn krävs.',
      err_user_not_found: 'Medlem {{uid}} hittades inte.',
      err_weapon_not_found: 'Vapen {{uid}} hittades inte.',
      err_weapon_inactive: 'Vapnet är inaktivt.',
      err_user_inactive: 'Medlemmen är inaktiv.',
      err_weapon_already_out: 'Vapnet är redan utlånat.',
      err_checkout_not_found: 'Utlämningen hittades inte.',
      err_already_checked_in: 'Vapnet är redan återlämnat.',

      // Checkout / checkin (M2)
      checkout_new: 'Ny utlämning',
      field_weapon: 'Vapen',
      field_member: 'Medlem',
      select_weapon_ph: 'Välj vapen (ID, märke, modell)',
      select_member_ph: 'Välj medlem (ID, namn, medlemsnr)',
      held_by: 'hos {{name}}',
      banner_weapon_inactive: 'Vapnet är inaktivt: {{reason}}',
      banner_weapon_inactive_noreason: 'Vapnet är inaktivt.',
      banner_weapon_already_out: 'Vapnet är redan utlånat till {{name}}.',
      banner_user_inactive: 'Medlemmen är inaktiv.',
      banner_debt: 'Skuld: {{amount}} kr',
      banner_fresher: 'Senast använt av {{name}}.',
      confirm_checkout: 'Lämna ut',
      field_checkout_notes: 'Anteckning',
      checked_out_ok: 'Utlämnat',
      returned_ok: 'Återlämnat',
      open_checkouts: 'Utlånade vapen',
      no_open_checkouts: 'Inga utlånade vapen.',
      return_weapon: 'Återlämna',
      label_checked_out_at: 'Utlånat',
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
      add_first_operator: 'Add operator',
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

      // Error codes from Rust
      err_display_id_taken:
        "Display ID '{{displayId}}' is already in use by another active record.",
      err_serial_taken: "Serial '{{serial}}' is already registered to another weapon.",
      err_name_required: 'Name is required.',
      err_user_not_found: 'Member {{uid}} not found.',
      err_weapon_not_found: 'Weapon {{uid}} not found.',
      err_weapon_inactive: 'Weapon is inactive.',
      err_user_inactive: 'Member is inactive.',
      err_weapon_already_out: 'Weapon is already checked out.',
      err_checkout_not_found: 'Checkout not found.',
      err_already_checked_in: 'Weapon is already checked in.',

      // Checkout / checkin (M2)
      checkout_new: 'New checkout',
      field_weapon: 'Weapon',
      field_member: 'Member',
      select_weapon_ph: 'Select weapon (ID, brand, model)',
      select_member_ph: 'Select member (ID, name, member no.)',
      held_by: 'with {{name}}',
      banner_weapon_inactive: 'Weapon is inactive: {{reason}}',
      banner_weapon_inactive_noreason: 'Weapon is inactive.',
      banner_weapon_already_out: 'Weapon is already checked out to {{name}}.',
      banner_user_inactive: 'Member is inactive.',
      banner_debt: 'Debt: {{amount}} kr',
      banner_fresher: 'Last used by {{name}}.',
      confirm_checkout: 'Check out',
      field_checkout_notes: 'Note',
      checked_out_ok: 'Checked out',
      returned_ok: 'Returned',
      open_checkouts: 'Checked-out weapons',
      no_open_checkouts: 'No checked-out weapons.',
      return_weapon: 'Return',
      label_checked_out_at: 'Checked out',
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
