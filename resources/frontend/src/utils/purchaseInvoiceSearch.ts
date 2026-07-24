/** Match purchase invoice list search (number, supplier, line item / product names). */
export function purchaseInvoiceMatchesSearch(invoice: any, query: string): boolean {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;

  const haystacks = [
    invoice?.invoice_number,
    invoice?.batch_number,
    invoice?.supplier_name,
    invoice?.notes,
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());

  if (haystacks.some((h) => h.includes(q))) return true;

  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  for (const item of items) {
    const labels = [
      item?.raw_description,
      item?.master_product?.internal_name,
      item?.masterProduct?.internal_name,
      item?.sku?.sku,
      item?.sku?.sku_code,
      item?.sku?.name,
    ]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());

    if (labels.some((label) => label.includes(q))) return true;
  }

  return false;
}
