import type { TFunction } from 'i18next';

// Identity is looked up live (by uid) and composed for display here — not
// snapshotted at event time. Active entities show their current tag; inactive
// ones show a "disabled" marker (their tag may have been cleared or reassigned).

export function userLabel(
  name: string | null,
  displayId: string | null,
  active: boolean,
  t: TFunction,
  isGuest = false,
): string {
  const n = name ?? '';
  const guest = isGuest ? ` (${t('label_guest')})` : '';
  if (!active) return `${n}${guest} [${t('label_disabled')}]`;
  return displayId ? `${n}${guest} [${displayId}]` : `${n}${guest}`;
}

export function weaponLabel(
  brand: string | null,
  model: string | null,
  caliber: string | null,
  displayId: string | null,
  active: boolean,
  t: TFunction,
): string {
  // "Glock 17, 9mm [1]" — caliber appended after a comma when present.
  const base = [brand, model].filter(Boolean).join(' ');
  const withCaliber = [base, caliber].filter(Boolean).join(', ');
  const id = active ? displayId : t('label_disabled');
  const suffix = id ? `[${id}]` : '';
  return [withCaliber, suffix].filter(Boolean).join(' ');
}
