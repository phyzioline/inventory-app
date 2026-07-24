/**
 * Matches {@see \App\Http\Controllers\Api\Inventory\SkuController::quantityForChannelScopedSku}:
 * each channel SKU shows only inventory at that channel's warehouse locations.
 */
export function quantityForChannelScopedSku(sku: any): number {
  if (sku == null) return 0;

  const scopeChannelId = Number(sku?.channel_id ?? sku?.channel?.id ?? 0);
  const inv = Array.isArray(sku?.inventory) ? sku.inventory : [];

  if (!scopeChannelId) {
    return inv.reduce((sum: number, row: any) => sum + Number(row?.quantity || 0), 0);
  }

  const linkedLocationId = resolveLinkedLocationId(sku);

  let primary = 0;
  let atChannelLocations = 0;

  for (const row of inv) {
    const qty = Number(row?.quantity || 0);
    const lid = Number(row?.location_id ?? 0);
    if (linkedLocationId > 0 && lid === linkedLocationId) {
      primary += qty;
    }
    const loc = row?.location;
    if (loc && scopeChannelId > 0 && Number(loc?.channel_id ?? 0) === scopeChannelId) {
      atChannelLocations += qty;
    }
  }

  if (linkedLocationId > 0 && primary !== 0) {
    return primary;
  }

  return atChannelLocations > 0 ? atChannelLocations : primary;
}

function resolveLinkedLocationId(sku: any): number {
  const raw = sku?.channel?.linked_location_id ?? sku?.channel?.linkedLocationId;
  if (raw != null && String(raw).trim() !== '') {
    return Number(raw);
  }
  const locs = Array.isArray(sku?.channel?.locations) ? sku.channel.locations : [];
  if (locs.length === 0) return 0;
  const sorted = [...locs].sort((a: any, b: any) => Number(a.id) - Number(b.id));
  return Number(sorted[0]?.id ?? 0);
}
