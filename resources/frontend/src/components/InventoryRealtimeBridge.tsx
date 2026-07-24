import { useAuth } from '@/contexts/AuthContext';
import { useInventoryRealtime } from '@/hooks/useInventoryRealtime';

/** Activates Reverb stock.updated listeners when the user is authenticated. */
export function InventoryRealtimeBridge() {
    const { user, loading } = useAuth();
    useInventoryRealtime(!loading && user !== null, user?.id);
    return null;
}
