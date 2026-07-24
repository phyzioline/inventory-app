export type PurchasePickerRow = {
    id: string;
    master_id: string;
    sku_id: string | null;
    sku_code: string;
    label: string;
    sub: string;
    place?: string;
    price: number;
    type: 'sku' | 'product';
    skuChannelId?: string | null;
};

export function resolveSkuMasterId(sk: any): string {
    const mp = sk?.offer?.master_product ?? sk?.offer?.masterProduct;
    return String(
        mp?.id ??
            sk?.offer?.master_product_id ??
            sk?.offer?.masterProductId ??
            sk?.master_product_id ??
            ''
    ).trim();
}

export function skuMatchesSearchQuery(sk: any, rawQuery: string): boolean {
    const q = String(rawQuery || '').trim().toLowerCase();
    if (!q) return true;
    const mp = sk?.offer?.master_product ?? sk?.offer?.masterProduct;
    const haystack = [
        sk?.sku,
        sk?.sku_code,
        sk?.name,
        sk?.product_name,
        mp?.internal_name,
        mp?.original_supplier_sku,
    ]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
    return haystack.includes(q);
}

export function buildPickerRowFromChannelSku(
    sk: any,
    storeName: string,
    isAr: boolean
): PurchasePickerRow | null {
    const sid = String(sk?.id ?? '').trim();
    const masterId = resolveSkuMasterId(sk);
    if (!sid || !masterId) return null;

    const mp = sk?.offer?.master_product ?? sk?.offer?.masterProduct;
    const skuCode = String(sk?.sku || sk?.sku_code || '').trim();
    const mpName = String(mp?.internal_name || sk?.name || sk?.product_name || '').trim();
    const label =
        mpName && skuCode && skuCode.toLowerCase() !== mpName.toLowerCase()
            ? `${mpName} — ${skuCode}`
            : skuCode || mpName;
    const channelName = String(sk?.channel?.name || '').trim();
    const place = channelName || storeName || (isAr ? 'المستودع المحدد' : 'Selected warehouse');

    return {
        id: `s-${sid}`,
        master_id: masterId,
        sku_id: sid,
        sku_code: skuCode,
        label,
        sub: [mpName, place].filter(Boolean).join(' • '),
        place,
        price: Number(sk?.cost_price ?? 0),
        type: 'sku',
        skuChannelId: sk?.channel_id != null ? String(sk.channel_id) : null,
    };
}

export function normalizePickerText(value: string) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '');
}

export function matchesPickerQuery(
    item: { label: string; sku_code?: string; sub?: string },
    rawQuery: string
) {
    const q = normalizePickerText(rawQuery);
    if (!q) return true;
    const label = normalizePickerText(item.label);
    const code = normalizePickerText(item.sku_code || '');
    const sub = normalizePickerText(item.sub || '');
    if (label.includes(q) || code.includes(q) || sub.includes(q)) return true;
    if (code && q.includes(code)) return true;
    const qBase = q.replace(/[-_][a-z0-9]+$/i, '');
    const cBase = code.replace(/[-_][a-z0-9]+$/i, '');
    if (qBase.length >= 4 && cBase.length >= 4 && (qBase === cBase || cBase.startsWith(qBase) || qBase.startsWith(cBase))) {
        return true;
    }
    return false;
}
