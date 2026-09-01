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

type CompositionLocationHint = {
    locationId: string;
    locationName: string;
    kind: TransferStockKind;
    channelId?: string;
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

function isMerchantPhantomSku(sku: any): boolean {
    const hay = channelHay(sku, null);
    if (/\bfba\b|amazon_fba|\bafn\b/.test(hay)) return false;
    return /merchant|\bmfn\b|\bfbm\b|تاجر/.test(hay);
}

function compositionEligibleSkus(offerDetail: any): any[] {
    return (Array.isArray(offerDetail?.skus) ? offerDetail.skus : []).filter((sku) => !isMerchantPhantomSku(sku));
}

function skuMatchesKind(sku: any, kind: TransferStockKind): boolean {
    return getTransferStockKind({ sku }, null) === kind;
}

function collectChannelLinkedLocations(offerDetail: any): CompositionLocationHint[] {
    const hints = new Map<string, CompositionLocationHint>();
    for (const sku of compositionEligibleSkus(offerDetail)) {
        const locs = Array.isArray(sku?.channel?.locations) ? sku.channel.locations : [];
        const channelId = String(sku.channel_id ?? sku.channel?.id ?? '').trim() || undefined;
        for (const loc of locs) {
            const locId = String(loc?.id ?? '').trim();
            if (!locId) continue;
            hints.set(locId, {
                locationId: locId,
                locationName: String(loc?.name || ('#' + locId)),
                kind: getTransferStockKind({ sku }, loc),
                channelId,
            });
        }
    }
    return [...hints.values()];
}

function collectLocationHints(
    peerOptions: CompositionSkuLocationOption[],
    offerDetail: any,
): CompositionLocationHint[] {
    const hints = new Map<string, CompositionLocationHint>();
    for (const p of peerOptions) {
        hints.set(p.locationId, {
            locationId: p.locationId,
            locationName: p.locationName,
            kind: p.kind,
        });
    }
    for (const h of collectChannelLinkedLocations(offerDetail)) {
        if (!hints.has(h.locationId)) hints.set(h.locationId, h);
    }
    return [...hints.values()];
}

/**
 * Pick the SKU on this offer that should receive/produce stock at the given warehouse.
 * Shop rows require a shop-channel SKU — never map FBA/merchant SKUs onto المحل.
 */
export function pickCompositionSkuForLocation(
    offerDetail: any,
    hint: CompositionLocationHint,
): any | null {
    const skus = compositionEligibleSkus(offerDetail);
    if (!skus.length) return null;

    const locId = hint.locationId;
    const chId = String(hint.channelId || '').trim();

    for (const sku of skus) {
        const locs = Array.isArray(sku?.channel?.locations) ? sku.channel.locations : [];
        if (locs.some((loc: any) => String(loc?.id ?? '') === locId)) {
            return sku;
        }
    }

    if (chId) {
        const byChannel = skus.find((sku) => String(sku.channel_id ?? sku.channel?.id ?? '') === chId);
        if (byChannel) return byChannel;
    }

    const byKind = skus.filter((sku) => skuMatchesKind(sku, hint.kind));
    if (hint.kind === 'shop') {
        return byKind[0] ?? null;
    }
    if (byKind.length) return byKind[0];

    return skus[0] ?? null;
}

/**
 * Add zero-qty rows for warehouses visible on the linked offer but missing from this one
 * (e.g. المحل on the pack SKU when only the single SKU has a shop inventory row).
 */
export function mergeCompositionPeerLocations(
    options: CompositionSkuLocationOption[],
    peerOptions: CompositionSkuLocationOption[],
    offerDetail: any,
): CompositionSkuLocationOption[] {
    const byValue = new Map(options.map((o) => [o.value, o]));
    const existingLocIds = new Set(options.map((o) => o.locationId));

    for (const hint of collectLocationHints(peerOptions, offerDetail)) {
        if (existingLocIds.has(hint.locationId)) continue;
        const sku = pickCompositionSkuForLocation(offerDetail, hint);
        if (!sku) continue;
        const value = `${sku.id}:${hint.locationId}`;
        if (byValue.has(value)) continue;
        byValue.set(value, {
            value,
            label: `${sku.sku} (${sku.channel?.name || 'بدون قناة'}) @ ${hint.locationName}`,
            qty: 0,
            skuId: String(sku.id),
            locationId: hint.locationId,
            locationName: hint.locationName,
            kind: hint.kind,
        });
        existingLocIds.add(hint.locationId);
    }

    return [...byValue.values()].sort((a, b) => b.qty - a.qty);
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

export function buildMergedCompositionSkuLocationOptions(
    offerDetail: any,
    peerOfferDetail: any,
): CompositionSkuLocationOption[] {
    const base = buildCompositionSkuLocationOptions(offerDetail);
    const peerBase = buildCompositionSkuLocationOptions(peerOfferDetail);
    return mergeCompositionPeerLocations(base, peerBase, offerDetail);
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
