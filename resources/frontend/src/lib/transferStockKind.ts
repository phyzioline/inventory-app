/** Where stock "sits" for UI tagging — المحل vs marketplace seller vs FBA. */
export type TransferStockKind = 'shop' | 'merchant' | 'fba';

export type TransferSkuChannelMeta = {
    id?: string;
    name?: string;
    type?: string;
    slug?: string;
};

/** Pull channel from a warehouse inventory row or a channel-SKU payload. */
export function resolveSkuChannelMeta(item: any): TransferSkuChannelMeta | null {
    const ch = item?.sku?.channel ?? item?.channel ?? null;
    if (!ch || typeof ch !== 'object') return null;
    const name = String(ch.name ?? '').trim();
    const type = String(ch.type ?? '').trim();
    const slug = String(ch.slug ?? '').trim();
    const id = ch.id != null && String(ch.id).trim() !== '' ? String(ch.id) : '';
    if (!name && !type && !slug && !id) return null;
    return {
        id: id || undefined,
        name: name || undefined,
        type: type || undefined,
        slug: slug || undefined,
    };
}

function channelHay(meta: TransferSkuChannelMeta | null | undefined): string {
    if (!meta) return '';
    return `${meta.type || ''} ${meta.name || ''} ${meta.slug || ''}`.toLowerCase();
}

function kindFromChannelHay(hay: string): TransferStockKind | null {
    if (!hay.trim()) return null;
    if (/\bfba\b|amazon_fba|\bafn\b/.test(hay)) return 'fba';
    if (/merchant|\bmfn\b|\bfbm\b|تاجر/.test(hay)) return 'merchant';
    if (/noon|نون|jumia|جوميا|fbn/.test(hay)) return 'merchant';
    if (/pos|shop|store|physical|المحل|متجر/.test(hay)) return 'shop';
    return null;
}

/**
 * Badge kind for transfer pickers.
 * Prefer the SKU listing channel (تاجر / FBA / نون / المحل) over the selected warehouse —
 * merchant listings can have stock rows at المحل and must not be labeled as shop.
 */
export function getTransferStockKind(item: any, location: any): TransferStockKind {
    const ch = resolveSkuChannelMeta(item);
    const fromChannel = kindFromChannelHay(channelHay(ch));
    if (fromChannel) return fromChannel;
    // Named sales-channel listing without a recognized family → treat as merchant, not shop.
    if (ch?.id || ch?.name) return 'merchant';

    const loc = location || {};
    const type = String(loc.type || '').toLowerCase();
    const name = String(loc.name || '').toLowerCase();
    const rowId = String(item?.id ?? '');
    const isSyntheticChannel = rowId.startsWith('channel-sku-');

    if (type === 'amazon_fba') return 'fba';
    if (/\bfba\b/i.test(name) || /\bamazon\b.*\bfba\b/i.test(name)) return 'fba';

    if (type === 'channel' || type === 'marketplace') return 'merchant';
    if (type === 'store' && loc.channel_id) return 'merchant';

    if (isSyntheticChannel && loc.channel_id) return 'merchant';

    return 'shop';
}

export function truncateStockKindBadgeText(raw: string, max = 22): string {
    const s = raw.trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return `${s.slice(0, Math.max(1, max - 1))}…`;
}

/** Short, operator-clear label from the SKU channel (never invent المحل for تاجر listings). */
export function transferChannelBadgeLabel(
    meta: TransferSkuChannelMeta | null | undefined,
    isAr: boolean
): string {
    if (!meta) return '';
    const hay = channelHay(meta);
    if (/\bfba\b|amazon_fba|\bafn\b/.test(hay)) return 'FBA';
    if (/merchant|\bmfn\b|\bfbm\b|تاجر/.test(hay)) return isAr ? 'تاجر' : 'Merchant';
    if (/noon|نون/.test(hay)) return isAr ? 'نون' : 'Noon';
    if (/jumia|جوميا/.test(hay)) return isAr ? 'جوميا' : 'Jumia';
    if (/pos|shop|store|physical|المحل|متجر/.test(hay)) return isAr ? 'المحل' : 'Shop';
    return truncateStockKindBadgeText(String(meta.name || ''), 28);
}

/** Badge text: SKU channel first, then warehouse name for marketplace locations, then kind defaults. */
export function transferStockKindLabel(
    kind: TransferStockKind,
    isAr: boolean,
    location?: { name?: string } | null,
    channel?: TransferSkuChannelMeta | null
): string {
    const fromChannel = transferChannelBadgeLabel(channel, isAr);
    if (fromChannel) return fromChannel;

    const locLabel = truncateStockKindBadgeText(String(location?.name ?? ''));
    if (kind === 'merchant' && locLabel) return locLabel;

    if (isAr) {
        switch (kind) {
            case 'fba':
                return 'FBA';
            case 'merchant':
                return 'قناة';
            default:
                return 'المحل';
        }
    }
    switch (kind) {
        case 'fba':
            return 'FBA';
        case 'merchant':
            return 'Channel';
        default:
            return 'Shop';
    }
}

export function transferStockKindBadgeClass(kind: TransferStockKind): string {
    switch (kind) {
        case 'fba':
            return 'border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100';
        case 'merchant':
            return 'border-violet-300 bg-violet-100 text-violet-950 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-100';
        default:
            return 'border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100';
    }
}
