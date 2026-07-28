export type TransferBatch = {
  key: string;
  minuteKey: string;
  direction: string;
  fromLocationId: string;
  toLocationId: string;
  fromExternalLocationId: string;
  userNotes: string;
  created_at: string;
  location: any;
  items: any[];
  totalQty: number;
};

export function parseTransferNotes(raw: unknown) {
  const text = String(raw || '').trim();
  const outMatch = text.match(/Transfer\s+OUT\s+to\s+Location\s+#(\d+)/i);
  const inMatch = text.match(/Transfer\s+IN\s+from\s+Location\s+#(\d+)/i);
  const toLocationId = outMatch ? String(outMatch[1]) : '';
  const fromExternalLocationId = inMatch ? String(inMatch[1]) : '';
  const userNotes = text
    .replace(/^Transfer\s+OUT\s+to\s+Location\s+#\d+\.\s*/i, '')
    .replace(/^Transfer\s+IN\s+from\s+Location\s+#\d+\.\s*/i, '')
    .replace(/\s*\[cross-SKU:[^\]]+\]\s*$/i, '')
    .trim();
  return { toLocationId, fromExternalLocationId, userNotes };
}

export function buildTransferBatches(transfers: unknown): TransferBatch[] {
  const rows = Array.isArray(transfers) ? transfers : [];
  const map = new Map<string, TransferBatch>();

  for (const tx of rows) {
    const created = new Date(tx.created_at || tx.updated_at || 0);
    const minuteKey = Number.isNaN(created.getTime())
      ? 'unknown'
      : `${created.getFullYear()}-${created.getMonth() + 1}-${created.getDate()} ${created.getHours()}:${created.getMinutes()}`;
    const fromLocationId = String(tx.location_id || tx.location?.id || '');
    const { toLocationId, fromExternalLocationId, userNotes } = parseTransferNotes(tx.notes);
    const direction = String(tx.type || '').toUpperCase() === 'IN' ? 'IN' : 'OUT';

    const remoteId = direction === 'IN' ? fromExternalLocationId : toLocationId;
    const key = [minuteKey, direction, fromLocationId, remoteId, userNotes].join('|');
    if (!map.has(key)) {
      map.set(key, {
        key,
        minuteKey,
        direction,
        fromLocationId,
        toLocationId,
        fromExternalLocationId,
        userNotes,
        created_at: tx.created_at,
        location: tx.location,
        items: [],
        totalQty: 0,
      });
    }
    const g = map.get(key)!;
    g.items.push(tx);
    g.totalQty += Number(tx.quantity || 0);
    map.set(key, g);
  }

  return Array.from(map.values()).sort((a, b) => {
    const ad = new Date(a.created_at || 0).getTime();
    const bd = new Date(b.created_at || 0).getTime();
    return bd - ad;
  });
}

export function getBatchEndpoints(
  batch: TransferBatch,
  resolveLocationName: (id: string) => string,
) {
  const fromName =
    batch.direction === 'IN'
      ? resolveLocationName(batch.fromExternalLocationId)
      : batch.location?.name || resolveLocationName(batch.fromLocationId);
  const toName =
    batch.direction === 'IN'
      ? batch.location?.name || resolveLocationName(batch.toLocationId)
      : resolveLocationName(batch.toLocationId);
  const fromId =
    batch.direction === 'IN' ? batch.fromExternalLocationId : batch.fromLocationId;
  const toId =
    batch.direction === 'IN'
      ? String(batch.location?.id || batch.toLocationId || '')
      : batch.toLocationId;

  return { fromName, toName, fromId, toId };
}

export function resolveProductLabel(tx: any): string {
  return (
    tx?.sku?.offer?.master_product?.internal_name ||
    tx?.sku?.offer?.masterProduct?.internal_name ||
    tx?.sku?.offer?.name ||
    tx?.sku?.product?.name ||
    tx?.sku?.name ||
    '-'
  );
}

export function batchMatchesSearch(
  batch: TransferBatch,
  query: string,
  resolveLocationName: (id: string) => string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    batch.userNotes,
    batch.location?.name,
    batch.fromLocationId,
    batch.toLocationId,
    batch.fromExternalLocationId,
    resolveLocationName(batch.toLocationId),
    resolveLocationName(batch.fromExternalLocationId),
    ...batch.items.flatMap((tx: any) => [
      tx.sku?.sku,
      tx.sku?.offer?.name,
      tx.sku?.product?.name,
      resolveProductLabel(tx),
      tx.notes,
      tx.location?.name,
    ]),
  ]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return hay.includes(q);
}
