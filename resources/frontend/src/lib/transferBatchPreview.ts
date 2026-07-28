import type { TransferBatch } from '@/lib/transferBatchUtils';
import { resolveProductLabel } from '@/lib/transferBatchUtils';
import type { FbaTransferSummary, FbaTransferSummaryRow } from '@/components/inventory/FbaTransferSummaryTable';

export type TransferBatchSummaryRow = FbaTransferSummaryRow & {
  tx_id?: string;
  source_image_url?: string | null;
  dest_image_url?: string | null;
};

export type TransferBatchSummary = FbaTransferSummary & {
  batchDate: string;
  batchDateLabel: string;
  fromName: string;
  toName: string;
  userNotes: string;
  rows: TransferBatchSummaryRow[];
};

function isOutTransferTx(tx: any): boolean {
  const type = String(tx?.type || '').toUpperCase();
  const notes = String(tx?.notes || '');
  if (type === 'OUT') return true;
  return type === 'TRANSFER' && /Transfer\s+OUT/i.test(notes);
}

function parseMskuFromReferenceType(referenceType: unknown): string {
  const ref = String(referenceType || '');
  const fbaMatch = ref.match(/^transfer_out:fba:[^:]+:(.+)$/i);
  if (fbaMatch?.[1]) return fbaMatch[1].trim();
  return '';
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

function resolveTxImage(tx: any): string | null {
  const sku = tx?.sku;
  const offer = sku?.offer;
  const master = offer?.master_product ?? offer?.masterProduct;
  const raw = sku?.image_url || master?.image_url || master?.image || null;
  return raw ? String(raw) : null;
}

function deriveShipmentLabel(batch: TransferBatch, fbaShipmentId?: string): string {
  if (fbaShipmentId) return fbaShipmentId;
  const notes = String(batch.userNotes || '').trim();
  if (notes) {
    const short = notes.length > 48 ? `${notes.slice(0, 48)}…` : notes;
    return short;
  }
  return '—';
}

export function parseBatchShipmentLabel(batch: TransferBatch): string {
  const fba = parseFbaMeta(batch.userNotes);
  return deriveShipmentLabel(batch, fba.shipmentId);
}

export function buildBatchFbaSummary(
  batch: TransferBatch,
  resolveLocationName: (id: string) => string,
  txById: Map<string, any>,
  isAr: boolean,
): TransferBatchSummary {
  const fromName =
    batch.direction === 'IN'
      ? resolveLocationName(batch.fromExternalLocationId)
      : batch.location?.name || resolveLocationName(batch.fromLocationId);
  const toName =
    batch.direction === 'IN'
      ? batch.location?.name || resolveLocationName(batch.toLocationId)
      : resolveLocationName(batch.toLocationId);

  const created = new Date(batch.created_at || 0);
  const batchDateLabel =
    !Number.isNaN(created.getTime())
      ? created.toLocaleString(isAr ? 'ar-EG' : 'en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';

  const outItems = batch.items.filter(isOutTransferTx);
  const sourceItems = outItems.length > 0 ? outItems : batch.items;
  const fba = parseFbaMeta(batch.userNotes);

  const rows: TransferBatchSummaryRow[] = sourceItems.map((outTx) => {
    const inTx = outTx?.reference_id != null ? txById.get(String(outTx.reference_id)) : null;
    const sourceSku = String(outTx?.sku?.sku || outTx?.sku?.name || '—');
    const destSku = String(inTx?.sku?.sku || inTx?.sku?.name || '—');
    const msku = parseMskuFromReferenceType(outTx?.reference_type) || destSku || sourceSku;
    const qty = Number(outTx.quantity || 0);

    return {
      amazon_msku: msku,
      source_sku: sourceSku,
      dest_sku: destSku,
      product_name: resolveProductLabel(outTx),
      required: qty,
      actual: qty,
      status: qty > 0 ? 'transferred' : 'skipped',
      tx_id: String(outTx.id),
      source_image_url: resolveTxImage(outTx),
      dest_image_url: resolveTxImage(inTx),
    };
  });

  const totalRequired = rows.reduce((s, r) => s + r.required, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const shipmentId = deriveShipmentLabel(batch, fba.shipmentId);

  return {
    shipment_id: shipmentId,
    ship_to_fc: fba.shipToFc,
    rows,
    totalRequired,
    totalActual,
    totalDiff: totalRequired - totalActual,
    batchDate: batch.created_at,
    batchDateLabel,
    fromName: fromName || '—',
    toName: toName || '—',
    userNotes: batch.userNotes || '',
  };
}
