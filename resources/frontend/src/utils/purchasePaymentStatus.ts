export type PurchasePaymentMeta = {
  paid: number | null;
  remaining: number | null;
  type: 'cash' | 'credit' | '';
  status: string;
};

export function parsePurchasePaymentMeta(rawNotes: unknown): PurchasePaymentMeta {
  const notes = String(rawNotes || '');
  const line = notes.split('\n').find((entry) => entry.trim().startsWith('[PAYMENT]')) || '';
  const paidMatch = line.match(/paid=([0-9]+(?:\.[0-9]+)?)/i);
  const remainingMatch = line.match(/remaining=([0-9]+(?:\.[0-9]+)?)/i);
  const typeMatch = line.match(/type=(cash|credit)/i);
  const statusMatch = line.match(/status=([a-z_]+)/i);
  return {
    paid: paidMatch ? Number(paidMatch[1]) : null,
    remaining: remainingMatch ? Number(remainingMatch[1]) : null,
    type: (typeMatch?.[1] || '').toLowerCase() as PurchasePaymentMeta['type'],
    status: (statusMatch?.[1] || '').toLowerCase(),
  };
}

/** Payment/settlement status for UI badges (not workflow status like received). */
export function resolvePurchasePaymentDisplayStatus(
  batchStatus: string | null | undefined,
  paid: number,
  remaining: number,
  _paymentType?: string | null
): string {
  const s = String(batchStatus || '').toLowerCase();
  if (s === 'cancelled') return 'cancelled';
  if (s === 'draft') return 'draft';
  if (s === 'review') return 'review';
  if (remaining <= 0.00001) return 'paid';
  if (paid > 0.00001) return 'partially_paid';
  return 'confirmed';
}

export function resolvePaidRemainingFromBatchNotes(
  rawNotes: unknown,
  totalAmount: number
): { paid: number; remaining: number; type: 'cash' | 'credit' } {
  const total = Math.max(0, Number(totalAmount) || 0);
  const meta = parsePurchasePaymentMeta(rawNotes);
  if (meta.type === 'cash') {
    return { paid: total, remaining: 0, type: 'cash' };
  }
  if (meta.remaining != null && !Number.isNaN(Number(meta.remaining))) {
    const remaining = Math.max(0, Math.min(Number(meta.remaining), total));
    return { paid: Math.max(0, total - remaining), remaining, type: 'credit' };
  }
  if (meta.paid != null && !Number.isNaN(Number(meta.paid))) {
    const paid = Math.max(0, Math.min(Number(meta.paid), total));
    return { paid, remaining: Math.max(0, total - paid), type: 'credit' };
  }
  return { paid: 0, remaining: total, type: 'credit' };
}
