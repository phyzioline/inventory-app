/** Normalize Arabic supplier names for matching (ignore spaces). */
export function normalizeSupplierName(name: string | null | undefined): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/\s+/g, '').toLowerCase();
}

export function supplierNamesMatch(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = normalizeSupplierName(a);
  const right = normalizeSupplierName(b);
  return left !== '' && left === right;
}
