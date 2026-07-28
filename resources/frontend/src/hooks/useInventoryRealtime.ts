import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeInventoryCatalogUpdated } from '@/lib/inventoryCatalogBroadcast';
import { invalidateInventoryLiveQueries } from '@/lib/inventoryLiveQueries';

const REALTIME_DEFER_MS = 2000;

/**
 * Keep channel KPI boxes + product lists fresh:
 * - Laravel Reverb `stock.updated` (other tabs / other devices after stock moves)
 * - BroadcastChannel catalog pings (same browser, other tabs)
 */
export function useInventoryRealtime(enabled: boolean, userId?: number | null): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!enabled || !userId || userId <= 0) {
            return;
        }

        let cancelled = false;
        let channelTeardown: (() => void) | null = null;

        const refresh = () =>
            invalidateInventoryLiveQueries(queryClient, { broadcast: false });

        const unsubscribeCatalog = subscribeInventoryCatalogUpdated(refresh);

        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                refresh();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);

        const timer = window.setTimeout(() => {
            void (async () => {
                try {
                    const echoModule = await import('@/lib/echo');
                    if (!echoModule.isInventoryRealtimeEnabled()) {
                        return;
                    }

                    const echo = await echoModule.getInventoryEcho();
                    if (!echo || cancelled) {
                        return;
                    }

                    const channel = echo.private(`inventory.user.${userId}`);
                    channel.listen('.stock.updated', () => {
                        refresh();
                    });
                    channelTeardown = () => {
                        try {
                            channel.stopListening('.stock.updated');
                            echo.leave(`private-inventory.user.${userId}`);
                        } catch {
                            // ignore teardown errors
                        }
                    };
                } catch (error) {
                    console.warn('[InventoryRealtime] setup failed:', error);
                }
            })();
        }, REALTIME_DEFER_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            channelTeardown?.();
            unsubscribeCatalog();
            document.removeEventListener('visibilitychange', onVisibility);
            void import('@/lib/echo').then((m) => m.disconnectInventoryEcho()).catch(() => undefined);
        };
    }, [enabled, userId, queryClient]);
}
