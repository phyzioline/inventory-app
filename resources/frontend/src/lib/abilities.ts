import type { User } from '@/contexts/AuthContext';

/** True if the user has the ability (or wildcard `*`). */
export function canAbility(user: User | null | undefined, ability: string): boolean {
  const abilities = user?.abilities;
  if (!abilities || abilities.length === 0) {
    // Owners without abilities payload should not silently unlock; rely on role fallback.
    if (user?.role === 'owner' || user?.is_super_admin) return true;
    return false;
  }
  if (abilities.includes('*')) return true;
  return abilities.includes(ability);
}

export function canAnyAbility(user: User | null | undefined, abilities: string[]): boolean {
  return abilities.some((a) => canAbility(user, a));
}
