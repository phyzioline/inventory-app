import type { TransferBatch } from '@/lib/transferBatchUtils';
import { resolveSkuListingLabel } from '@/lib/transferBatchUtils';
import type { FbaTransferSummary, FbaTransferSummaryRow } from '@/components/inventory/FbaTransferSummaryTable';

export type TransferBatchSummaryRow = FbaTransferSummaryRow & {
  tx_id?: string;
  source_image_url?: string | null;
  dest_image_url?: string | null;
  source_product_name?: string;
  dest_product_name?: string;
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

function isInTransferTx(tx: any): boolean {
  const type = String(tx?.type || '').toUpperCase();
  const notes = String(tx?.notes || '');
  const ref = String(tx?.reference_type || '');
  if (type === 'IN' && (/Transfer\s+IN/i.test(notes) || /^transfer_in/i.test(ref))) return true;
  return type === 'TRANSFER' && /Transfer\s+IN/i.test(notes);
}

function parseSheetQtyFromNotes(notes: unknown): number | null {
  const text = String(notes || '');
  const match = text.match(/SheetQty\s*:\s*(\d+)/i);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
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
  if (!tx) return null;
  const sku = tx?.sku;
  const offer = sku?.offer;
  const master = offer?.master_product ?? offer?.masterProduct;
  const raw =
    sku?.image_url ||
    master?.image_url ||
    master?.image ||
    sku?.product?.image_url ||
    null;
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
  if (fba.shipmentId) return fba.shipmentId;
  const notes = String(batch.userNotes || '').trim();
  if (notes && !/^Transfer\s+(IN|OUT)/i.test(notes)) {
    return notes.length > 48 ? `${notes.slice(0, 48)}…` : notes;
  }
  const created = new Date(batch.created_at || 0);
  if (!Number.isNaN(created.getTime())) {
    const datePart = created.toLocaleDateString('en-GB');
    return `Batch ${datePart}`;
  }
  return '—';
}

export function getBatchShipmentMeta(batch: TransferBatch) {
  const fba = parseFbaMeta(batch.userNotes);
  const outItems = batch.items.filter(isOutTransferTx);
  const sourceItems = outItems.length > 0 ? outItems : batch.items.filter((tx) => !isInTransferTx(tx));
  return {
    shipmentId: parseBatchShipmentLabel(batch),
    shipToFc: fba.shipToFc,
    skuCount: sourceItems.length,
    totalUnits: sourceItems.reduce((sum, tx) => sum + Number(tx.quantity || 0), 0) || batch.totalQty,
    isFba: Boolean(fba.shipmentId),
  };
}

function findPairedInTx(outTx: any, txById: Map<string, any>): any | null {
  if (!outTx) return null;

  // Preferred: OUT.reference_id → IN.id
  if (outTx.reference_id != null) {
    const byRef = txById.get(String(outTx.reference_id));
    if (byRef) return byRef;
  }

  // Reverse: IN.reference_id → OUT.id
  const outId = String(outTx.id);
  for (const tx of txById.values()) {
    if (!isInTransferTx(tx)) continue;
    if (String(tx.reference_id || '') === outId) return tx;
  }

  // Same client transfer id: transfer_out:xxx ↔ transfer_in:xxx
  const outRef = String(outTx.reference_type || '');
  const clientMatch = outRef.match(/^transfer_out:(.+)$/i);
  if (clientMatch?.[1]) {
    const inRef = `transfer_in:${clientMatch[1]}`;
    for (const tx of txById.values()) {
      if (String(tx.reference_type || '') === inRef) return tx;
    }
  }

  return null;
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
  const sourceItems =
    outItems.length > 0
      ? outItems
      : batch.items.filter((tx) => !isInTransferTx(tx));
  const fba = parseFbaMeta(batch.userNotes);

  const rows: TransferBatchSummaryRow[] = sourceItems.map((outTx) => {
    const inTx = findPairedInTx(outTx, txById);
    const sourceSku = String(outTx?.sku?.sku || outTx?.sku?.name || '—');
    const msku = parseMskuFromReferenceType(outTx?.reference_type);
    const destFromIn = inTx?.sku?.sku || inTx?.sku?.name;
    const destSku = String(destFromIn || msku || '—');
    const qty = Number(outTx.quantity || 0);
    const sheetQty = parseSheetQtyFromNotes(outTx?.notes);
    const required = sheetQty !== null ? sheetQty : qty;
    const sourceName = resolveSkuListingLabel(outTx);
    const destName = inTx ? resolveSkuListingLabel(inTx) : '—';
    const sourceImage = resolveTxImage(outTx);
    // Never borrow the other side's image — each column shows its own SKU media only.
    const destImage = resolveTxImage(inTx);

    return {
      amazon_msku: msku || destSku || sourceSku,
      source_sku: sourceSku,
      dest_sku: destSku,
      product_name: sourceName,
      source_product_name: sourceName,
      dest_product_name: destName,
      required,
      actual: qty,
      status: qty > 0 ? 'transferred' : 'skipped',
      tx_id: String(outTx.id),
      source_image_url: sourceImage,
      dest_image_url: destImage,
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
