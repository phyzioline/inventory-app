// Offline v1 bridge to the Tauri desktop shell's local SQLite cache/outbox
// (see tauri-inventory-app/src-tauri/src/sync.rs). No-ops everywhere when
// running as a plain web page — every export is safe to call unconditionally.

declare global {
    interface Window {
        __TAURI__?: {
            core?: {
                invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
            };
        };
    }
}

export const isDesktop = (): boolean =>
    typeof window !== 'undefined' && !!window.__TAURI__?.core?.invoke;

const invoke = <T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> | null => {
    const fn = window.__TAURI__?.core?.invoke;
    return fn ? fn<T>(cmd, args) : null;
};

const DEVICE_ID_KEY = 'phy_desktop_device_id';

export const getDeviceId = (): string => {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
};

/** Call after a successful login when isDesktop() — hands the Sanctum token to Rust for background sync. */
export const storeDesktopToken = (token: string): Promise<void> | null =>
    invoke<void>('store_desktop_token', { token, deviceId: getDeviceId() });

export const clearDesktopToken = (): Promise<void> | null => invoke<void>('clear_desktop_token');

export interface SyncStatus {
    pending_count: number;
    last_synced_at: string | null;
    device_id: string | null;
}

export const getSyncStatus = (): Promise<SyncStatus> | null => invoke<SyncStatus>('get_sync_status');

export interface SyncSummary {
    pulled: boolean;
    pushed: number;
    applied: number;
    failed: number;
}

export const syncNow = (): Promise<SyncSummary> | null => invoke<SyncSummary>('sync_now');

export interface CachedStockRow {
    sku_id: number;
    sku: string | null;
    name: string | null;
    barcode: string | null;
    location_id: number;
    location_name: string | null;
    quantity: number;
}

export const listCachedStock = (locationId?: number): Promise<CachedStockRow[]> | null =>
    invoke<CachedStockRow[]>('list_cached_stock', { locationId: locationId ?? null });

export type OfflineAdjustmentType =
    | 'DAMAGE' | 'LOST' | 'THEFT' | 'EXPIRED' | 'CORRECTION' | 'OPENING_BALANCE' | 'STOCK_IN';

export interface OfflineAdjustmentInput {
    sku_id: number;
    location_id: number;
    type: OfflineAdjustmentType;
    quantity: number;
    notes?: string;
}

/** Queues a stock adjustment locally; applied server-side on the next syncNow(). */
export const recordOfflineAdjustment = (input: OfflineAdjustmentInput): Promise<string> | null =>
    invoke<string>('record_offline_adjustment', { input });
