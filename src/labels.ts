import type { TFunction } from 'i18next';

// Identity is looked up live (by uid) and composed for display here — not
// snapshotted at event time. Active entities show their current tag; inactive
// ones show a "disabled" marker (their tag may have been cleared or reassigned).

export function userLabel(
  name: string | null,
  displayId: string | null,
  active: boolean,
  t: TFunction,
): string {
  const n = name ?? '';
  if (!active) return `${n} [${t('label_disabled')}]`;
  return displayId ? `${n} [${displayId}]` : n;
}

export function weaponLabel(
  brand: string | null,
  model: string | null,
  displayId: string | null,
  active: boolean,
  t: TFunction,
): string {
  const base = [brand, model].filter(Boolean).join(' ');
  const id = active ? displayId : t('label_disabled');
  const suffix = id ? `[${id}]` : '';
  return [base, suffix].filter(Boolean).join(' ');
}
