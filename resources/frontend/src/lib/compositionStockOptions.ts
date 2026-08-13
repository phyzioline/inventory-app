import { getTransferStockKind, type TransferStockKind } from '@/lib/transferStockKind';

export type CompositionSkuLocationOption = {
    value: string;
    label: string;
    qty: number;
    skuId: string;
    locationId: string;
    locationName: string;
    kind: TransferStockKind;
};

function channelHay(sku: any, inv: any): string {
    const ch = sku?.channel ?? inv?.location?.channel ?? {};
    return `${ch.type || ''} ${ch.name || ''} ${ch.slug || ''} ${inv?.location?.name || ''}`.toLowerCase();
}

function isMerchantPhantom(sku: any, inv: any): boolean {
    const hay = channelHay(sku, inv);
    if (/\bfba\b|amazon_fba|\bafn\b/.test(hay)) return false;
    return /merchant|\bmfn\b|\bfbm\b|تاجر/.test(hay);
}

/**
 * Real warehouse rows only — merchant/FBM phantom listings are not a pack/unpack bucket.
 * Sort is by qty desc as a fallback; callers should pick same-location dest explicitly.
 */
export function buildCompositionSkuLocationOptions(offerDetail: any): CompositionSkuLocationOption[] {
    const skus = Array.isArray(offerDetail?.skus) ? offerDetail.skus : [];
    const rows: CompositionSkuLocationOption[] = [];
    for (const sku of skus) {
        const invRows = Array.isArray(sku.inventory) ? sku.inventory : [];
        for (const inv of invRows) {
            const locId = String(inv.location_id ?? inv.location?.id ?? '');
            if (!locId) continue;
            if (isMerchantPhantom(sku, inv)) continue;
            const locationName = String(inv.location?.name || ('#' + locId));
            rows.push({
                value: `${sku.id}:${locId}`,
                label: `${sku.sku} (${sku.channel?.name || 'بدون قناة'}) @ ${locationName}`,
                qty: Number(inv.quantity || 0),
                skuId: String(sku.id),
                locationId: locId,
                locationName,
                kind: getTransferStockKind({ sku }, inv.location),
            });
        }
    }
    return rows.sort((a, b) => b.qty - a.qty);
}

export function pickCompositionSourceOption(
    options: CompositionSkuLocationOption[],
): CompositionSkuLocationOption | null {
    if (!options.length) return null;
    const shop = options.filter((o) => o.kind === 'shop');
    const pool = shop.length ? shop : options;
    return [...pool].sort((a, b) => b.qty - a.qty)[0] ?? null;
}

/**
 * Prefer the same warehouse as the source, even when that row is currently 0.
 * That is the operator-expected pack/unpack behaviour (المحل → المحل).
 */
export function pickCompositionDestOption(
    options: CompositionSkuLocationOption[],
    sourceLocationId?: string,
): CompositionSkuLocationOption | null {
    if (!options.length) return null;
    const loc = String(sourceLocationId || '').trim();
    if (loc) {
        const same = options.filter((o) => o.locationId === loc);
        if (same.length) {
            const shopSame = same.filter((o) => o.kind === 'shop');
            const pool = shopSame.length ? shopSame : same;
            return [...pool].sort((a, b) => b.qty - a.qty)[0] ?? null;
        }
    }
    return pickCompositionSourceOption(options);
}
