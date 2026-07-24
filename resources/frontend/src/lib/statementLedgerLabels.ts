/** Extract PAY-xxx / receipt ref from legacy English ledger descriptions. */
export function extractLedgerReference(description: string): string {
  const text = String(description ?? '').trim();
  if (!text) return '';

  const hashMatch = text.match(/#\s*(\S+)/);
  if (hashMatch?.[1]) return hashMatch[1];

  const dashMatch = text.match(/—\s*#?\s*(\S+)/);
  if (dashMatch?.[1]) return dashMatch[1];

  return '';
}

export function formatSupplierPaymentDescription(
  supplierName: string,
  reference: string | number | null | undefined,
  rtl: boolean
): string {
  const name = String(supplierName ?? '').trim() || (rtl ? 'المورد' : 'supplier');
  const ref = reference != null && String(reference).trim() !== '' ? String(reference).trim() : '';

  if (rtl) {
    return `سداد نقدي إلى ${name}${ref ? ` — #${ref}` : ''}`;
  }

  return `Cash payment to ${name}${ref ? ` — #${ref}` : ''}`;
}

export function formatCustomerCollectionDescription(
  customerName: string,
  reference: string | number | null | undefined,
  rtl: boolean
): string {
  const name = String(customerName ?? '').trim() || (rtl ? 'العميل' : 'customer');
  const ref = reference != null && String(reference).trim() !== '' ? String(reference).trim() : '';

  if (rtl) {
    return `سداد نقدي من ${name}${ref ? ` — #${ref}` : ''}`;
  }

  return `Cash payment from ${name}${ref ? ` — #${ref}` : ''}`;
}

export function formatSupplierLedgerRowDescription(
  row: { source?: string; description?: string },
  supplierName: string,
  rtl: boolean
): string {
  if (String(row.source ?? '') === 'payment') {
    const ref = extractLedgerReference(String(row.description ?? ''));
    return formatSupplierPaymentDescription(supplierName, ref, rtl);
  }

  return String(row.description ?? '');
}

export function formatCustomerLedgerRowDescription(
  row: { source?: string; description?: string },
  customerName: string,
  rtl: boolean
): string {
  const src = String(row.source ?? '');
  if (src === 'payment' || src === 'receipt' || src === 'order_payment') {
    const ref = extractLedgerReference(String(row.description ?? ''));
    return formatCustomerCollectionDescription(customerName, ref, rtl);
  }

  return String(row.description ?? '');
}
