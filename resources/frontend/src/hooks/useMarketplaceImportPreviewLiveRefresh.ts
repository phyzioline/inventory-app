import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribeInventoryCatalogUpdated } from '@/lib/inventoryCatalogBroadcast';

const CATALOG_QUERY_PREFIXES = [
    'master-products',
    'channel-skus',
    'channels-all-skus-metrics',
    'all-skus-lookup',
    'warehouses-summary',
    'warehouses',
] as const;

const STOCK_QUERY_PREFIXES = [
    'warehouses-summary',
    'warehouses',
    'channel-skus',
    'inventory-by-location',
] as const;

const LIVE_REFRESH_DEBOUNCE_MS = 1200;

type Options = {
    enabled: boolean;
    onRefresh: () => void | Promise<void>;
};

/**
 * Silently re-run marketplace import preview when stock or catalog data changes
 * (same-tab React Query invalidation, cross-tab BroadcastChannel, or window focus).
 */
export function useMarketplaceImportPreviewLiveRefresh({ enabled, onRefresh }: Options): void {
    const queryClient = useQueryClient();
    const onRefreshRef = useRef(onRefresh);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastRefreshAtRef = useRef(0);

    onRefreshRef.current = onRefresh;

    useEffect(() => {
        if (!enabled) {
            return;
        }

        const scheduleRefresh = () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
            debounceRef.current = setTimeout(() => {
                const now = Date.now();
                if (now - lastRefreshAtRef.current < 400) {
                    return;
                }
                lastRefreshAtRef.current = now;
                void onRefreshRef.current();
            }, LIVE_REFRESH_DEBOUNCE_MS);
        };

        const matchesPrefix = (queryKey: unknown, prefixes: readonly string[]) => {
            const root = Array.isArray(queryKey) ? String(queryKey[0] ?? '') : '';
            return prefixes.some((p) => root === p || root.startsWith(p));
        };

        const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
            if (event?.type !== 'updated') {
                return;
            }
            const key = event.query?.queryKey;
            if (
                matchesPrefix(key, CATALOG_QUERY_PREFIXES) ||
                matchesPrefix(key, STOCK_QUERY_PREFIXES)
            ) {
                scheduleRefresh();
            }
        });

        const unsubscribeCatalog = subscribeInventoryCatalogUpdated(() => scheduleRefresh());

        const onFocus = () => scheduleRefresh();
        window.addEventListener('focus', onFocus);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
            unsubscribeCache();
            unsubscribeCatalog();
            window.removeEventListener('focus', onFocus);
        };
    }, [enabled, queryClient]);
}
