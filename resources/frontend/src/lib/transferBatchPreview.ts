import type { TransferBatch } from '@/lib/transferBatchUtils';
import { resolveProductLabel } from '@/lib/transferBatchUtils';

export type TransferBatchPreviewRow = {
  id: string;
  sourceSku: string;
  destSku: string;
  productName: string;
  quantity: number;
  imageUrl: string | null;
};

export type TransferBatchPreviewMeta = {
  fromName: string;
  toName: string;
  createdAt: string;
  userNotes: string;
  totalQty: number;
  itemCount: number;
  shipmentId?: string;
  shipToFc?: string;
};

function isOutTransferTx(tx: any): boolean {
  const type = String(tx?.type || '').toUpperCase();
  const notes = String(tx?.notes || '');
  if (type === 'OUT') return true;
  return type === 'TRANSFER' && /Transfer\s+OUT/i.test(notes);
}

function resolveTxImage(tx: any): string | null {
  const sku = tx?.sku;
  const offer = sku?.offer;
  const master = offer?.master_product ?? offer?.masterProduct;
  const raw = sku?.image_url || master?.image_url || master?.image || null;
  return raw ? String(raw) : null;
}

function parseFbaMeta(notes: string): { shipmentId?: string; shipToFc?: string; units?: number } {
  const text = String(notes || '');
  const shipmentMatch = text.match(/FBA\s+Shipment\s+([^|]+)/i);
  const fcMatch = text.match(/FC\s+([^|]+)/i);
  const unitsMatch = text.match(/Units\s+(\d+)/i);
  return {
    shipmentId: shipmentMatch?.[1]?.trim(),
    shipToFc: fcMatch?.[1]?.trim(),
    units: unitsMatch?.[1] ? Number(unitsMatch[1]) : undefined,
  };
}

export function buildTransferBatchPreview(
  batch: TransferBatch,
  resolveLocationName: (id: string) => string,
  txById: Map<string, any>,
): { meta: TransferBatchPreviewMeta; rows: TransferBatchPreviewRow[] } {
  const { fromName, toName } = (() => {
    const from =
      batch.direction === 'IN'
        ? resolveLocationName(batch.fromExternalLocationId)
        : batch.location?.name || resolveLocationName(batch.fromLocationId);
    const to =
      batch.direction === 'IN'
        ? batch.location?.name || resolveLocationName(batch.toLocationId)
        : resolveLocationName(batch.toLocationId);
    return { fromName: from || '—', toName: to || '—' };
  })();

  const outItems = batch.items.filter(isOutTransferTx);
  const sourceItems = outItems.length > 0 ? outItems : batch.items;

  const rows: TransferBatchPreviewRow[] = sourceItems.map((outTx) => {
    const inTx = outTx?.reference_id != null ? txById.get(String(outTx.reference_id)) : null;
    const sourceSku = String(outTx?.sku?.sku || outTx?.sku?.name || '—');
    const destSku = String(inTx?.sku?.sku || inTx?.sku?.name || '—');
    const imageUrl = resolveTxImage(outTx) || resolveTxImage(inTx);

    return {
      id: String(outTx.id),
      sourceSku,
      destSku,
      productName: resolveProductLabel(outTx),
      quantity: Number(outTx.quantity || 0),
      imageUrl,
    };
  });

  const fba = parseFbaMeta(batch.userNotes);

  return {
    meta: {
      fromName,
      toName,
      createdAt: batch.created_at,
      userNotes: batch.userNotes,
      totalQty: rows.reduce((sum, row) => sum + row.quantity, 0),
      itemCount: rows.length,
      shipmentId: fba.shipmentId,
      shipToFc: fba.shipToFc,
    },
    rows,
  };
}
