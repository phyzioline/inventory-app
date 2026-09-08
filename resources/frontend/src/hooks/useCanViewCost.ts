import { useAuth } from '@/contexts/AuthContext';
import { canAbility } from '@/lib/abilities';

/** Purchase/cost prices — cashiers and similar roles must not see these. */
export function useCanViewCost(): boolean {
  const { user } = useAuth();
  return canAbility(user, 'cost.read');
}
