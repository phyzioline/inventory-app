const CHANNEL_NAME = 'phyzioline-inventory-catalog';

export type InventoryCatalogBroadcastMessage = {
    ts: number;
    scope?: string;
};

/** Notify other browser tabs that catalog / SKU links changed (mirrors FBA live preview behaviour). */
export function broadcastInventoryCatalogUpdated(scope?: string): void {
    try {
        const channel = new BroadcastChannel(CHANNEL_NAME);
        channel.postMessage({ ts: Date.now(), scope: scope ?? 'catalog' } satisfies InventoryCatalogBroadcastMessage);
        channel.close();
    } catch {
        // BroadcastChannel unavailable — same-tab refresh still works via React Query.
    }
}

export function subscribeInventoryCatalogUpdated(onMessage: () => void): () => void {
    try {
        const channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = () => onMessage();
        return () => channel.close();
    } catch {
        return () => undefined;
    }
}
