import { useQuery } from '@tanstack/react-query';
import { hasAdmin } from './api';
import { useAppStore } from './store';

/** UI-only admin gate. Bootstrap rule: while no active admin exists in the DB,
 *  gating is disabled (everything visible) so a blank install can create and
 *  flag its first admin. Backend commands are deliberately not gated. */
export function useIsAdmin(): boolean {
  const operator = useAppStore((s) => s.operator);
  const q = useQuery({ queryKey: ['hasAdmin'], queryFn: hasAdmin });
  if (q.data === false) return true; // bootstrap mode
  return operator?.isAdmin ?? false;
}
