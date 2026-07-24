import { quantityForChannelScopedSku } from '@/lib/channelScopedQuantity';

export type ChannelInventoryMetrics = {
  products: number;
  pieces: number;
  purchaseCost: number;
};

export function resolveMasterProduct(sku: any): any {
  return sku?.offer?.master_product ?? sku?.offer?.masterProduct ?? null;
}

function pickFirstPositive(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * Purchase unit cost: shop purchase invoices → master product, shared by all linked SKUs.
 */
export function resolvePurchaseUnitCost(sku: any): number {
  const fromApi = pickFirstPositive(sku?.effective_purchase_unit_cost, sku?.effectivePurchaseUnitCost);
  if (fromApi > 0) return fromApi;

  const master = resolveMasterProduct(sku);
  const masterCost = pickFirstPositive(
    master?.last_purchase_price,
    master?.avg_purchase_price,
    master?.cost_price,
    master?.specifications?.cost_price
  );
  if (masterCost > 0) return masterCost;

  return pickFirstPositive(sku?.last_purchase_price, sku?.cost_price);
}

export function getSkuQtyForMetrics(sku: any): number {
  if (
    sku?.display_quantity != null &&
    sku.display_quantity !== '' &&
    !Number.isNaN(Number(sku.display_quantity))
  ) {
    return Number(sku.display_quantity);
  }
  return quantityForChannelScopedSku(sku);
}

export function addSkuToChannelMetrics(map: Record<string, ChannelInventoryMetrics>, sku: any): void {
  const channelId = String(sku?.channel_id || '');
  if (!channelId) return;

  const qty = Math.max(0, getSkuQtyForMetrics(sku));
  const unit = resolvePurchaseUnitCost(sku);

  if (!map[channelId]) {
    map[channelId] = { products: 0, pieces: 0, purchaseCost: 0 };
  }
  map[channelId].products += 1;
  map[channelId].pieces += qty;
  if (qty > 0 && unit > 0) {
    map[channelId].purchaseCost += qty * unit;
  }
}

export function buildChannelMetricsMap(allSkus: any[]): Record<string, ChannelInventoryMetrics> {
  const map: Record<string, ChannelInventoryMetrics> = {};
  (allSkus || []).forEach((sku) => addSkuToChannelMetrics(map, sku));
  return map;
}

export function computeChannelStatsFromSkus(skus: any[]): ChannelInventoryMetrics & { unlinked: number; sellingValue: number } {
  let products = 0;
  let pieces = 0;
  let purchaseCost = 0;
  let unlinked = 0;
  let sellingValue = 0;

  for (const sku of skus || []) {
    products += 1;
    if (!sku?.offer_id) unlinked += 1;
    const qty = Math.max(0, getSkuQtyForMetrics(sku));
    const unit = resolvePurchaseUnitCost(sku);
    const price = pickFirstPositive(sku?.selling_price);
    pieces += qty;
    if (qty > 0 && unit > 0) purchaseCost += qty * unit;
    if (qty > 0 && price > 0) sellingValue += qty * price;
  }

  return { products, pieces, purchaseCost, unlinked, sellingValue };
}
