import api, { apiClient } from '@/lib/api';

/** Laravel paginates warehouse inventory (max per_page=200 server-side). */
export async function fetchAllWarehouseInventoryPages(warehouseId: string): Promise<any[]> {
    const out: any[] = [];
    let page = 1;
    const perPage = 200;
    while (true) {
        const res = await apiClient.get(`warehouses/${warehouseId}/inventory`, {
            params: { per_page: perPage, page },
        });
        const body = res.data;
        const chunk = Array.isArray(body?.data) ? body.data : [];
        out.push(...chunk);
        const lastPage = Number(body?.last_page ?? 1);
        if (page >= lastPage || chunk.length === 0) break;
        page += 1;
    }
    return out;
}

export function resolveInventoryRowQty(item: any): number {
    return Number(item?.quantity ?? item?.qty ?? item?.available ?? item?.on_hand ?? 0);
}

/** Resolve master product id from a warehouse inventory row (API may use snake_case or camelCase). */
export function resolveInventoryRowMasterProductId(item: any): string {
    const sku = item?.sku;
    const offer = sku?.offer;
    const candidates = [
        offer?.master_product_id,
        offer?.masterProduct?.id,
        offer?.master_product?.id,
        sku?.master_product_id,
        item?.master_product_id,
    ];
    for (const c of candidates) {
        if (c != null && String(c).trim() !== '') return String(c);
    }
    return '';
}

/** Sum qty for a SKU’s inventory rows that belong to this warehouse/location id. */
function inventoryQtyForLocation(skuInventoryRows: any[] | undefined, locationId: string): number {
    if (!Array.isArray(skuInventoryRows)) return 0;
    let sum = 0;
    for (const row of skuInventoryRows) {
        const lid = String(row?.location_id ?? row?.inventory_location_id ?? '').trim();
        if (lid && lid !== String(locationId)) continue;
        sum += Number(row?.quantity ?? row?.qty ?? 0);
    }
    return sum;
}

/** Add missing channel SKUs as synthetic stock rows (0 or computed qty) so channel-linked locations stay searchable. */
export function mergeChannelSkusIntoInventoryRows(
    rows: any[],
    channelSkus: any[],
    locationId: string
): any[] {
    const bySkuId = new Map<string, any>();
    for (const r of rows) {
        const sid = String(r?.sku?.id ?? '').trim();
        if (sid) bySkuId.set(sid, r);
    }
    for (const sk of channelSkus) {
        const sid = String(sk?.id ?? '').trim();
        if (!sid || bySkuId.has(sid)) continue;
        const q = inventoryQtyForLocation(sk?.inventory, locationId);
        bySkuId.set(sid, {
            id: `channel-sku-${sid}`,
            quantity: q,
            sku: {
                id: sk.id,
                sku: sk.sku ?? sk.sku_code ?? '',
                name: sk.name ?? sk.product_name ?? '',
                offer: sk.offer,
                channel: sk.channel,
                product: sk.product,
                image_url: sk.image_url,
            },
        });
    }
    return Array.from(bySkuId.values());
}

/** All inventory rows for a location, optionally merged with channel SKUs when the warehouse has `channel_id`. */
export async function fetchMergedLocationInventory(
    warehouseId: string,
    channelId?: string | number | null
): Promise<any[]> {
    const wid = String(warehouseId);
    const base = await fetchAllWarehouseInventoryPages(wid);
    const cid = channelId != null && String(channelId).trim() !== '' ? String(channelId) : '';
    if (!cid) return base;
    const channelSkus = await api.getArray(`/skus?channel_id=${cid}`);
    return mergeChannelSkusIntoInventoryRows(base, channelSkus, wid);
}
