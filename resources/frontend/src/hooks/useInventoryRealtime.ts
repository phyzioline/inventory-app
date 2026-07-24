import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const STOCK_QUERY_PREFIXES = [
    'warehouses-summary',
    'warehouses',
    'channel-skus',
    'master-products',
    'all-skus-lookup',
    'channels-all-skus-metrics',
    'dashboard-metrics',
] as const;

function invalidateStockQueries(queryClient: ReturnType<typeof useQueryClient>): void {
    for (const key of STOCK_QUERY_PREFIXES) {
        queryClient.invalidateQueries({ queryKey: [key] });
    }
}

const REALTIME_DEFER_MS = 2000;

/**
 * Subscribe to inventory.user.{userId} and refresh stock caches on stock.updated.
 * Deferred so initial dashboard/API load is not blocked by WebSocket auth.
 */
export function useInventoryRealtime(enabled: boolean, userId?: number | null): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!enabled || !userId || userId <= 0) {
            return;
        }

        let cancelled = false;
        let channelTeardown: (() => void) | null = null;
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
                        invalidateStockQueries(queryClient);
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
            void import('@/lib/echo').then((m) => m.disconnectInventoryEcho()).catch(() => undefined);
        };
    }, [enabled, userId, queryClient]);
}
