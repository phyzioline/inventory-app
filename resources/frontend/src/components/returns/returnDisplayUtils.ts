/** Physical warehouse lifecycle — never conflated with Amazon financial refund. */
export type PhysicalStatus =
  | 'pending'
  | 'in_transit'
  | 'received'
  | 'restocked_fba'
  | 'restocked_shop'
  | 'lost';

export type FinancialStatus = 'amazon_refund' | 'none';

export type ReturnRowLike = {
  id?: string | number | null;
  return_number?: string | null;
  platform_return_id?: string | null;
  return_status?: string | null;
  status?: string | null;
  external_status?: string | null;
  refund_amount?: number | null;
  return_location?: string | null;
  reason?: string | null;
  physical_status?: PhysicalStatus;
  financial_status?: FinancialStatus;
  customer_name?: string | null;
  order?: { order_number?: string | null; channel?: { name?: string | null; slug?: string | null } | null } | null;
  amazon_order_number?: string | null;
  channel?: string | null;
  metadata?: Record<string, unknown> | null;
  sku_code?: string | null;
  product_image_url?: string | null;
  product_name?: string | null;
};

export function returnHasFbaSheetEvidence(r: ReturnRowLike): boolean {
  const ext = String(r.external_status ?? '').toLowerCase();
  if (ext.startsWith('fba_returns:')) {
    return true;
  }
  const meta = r.metadata;
  if (meta && typeof meta === 'object') {
    if (meta.fba_license_plate || meta.fba_row_hash) {
      return true;
    }
  }

  return false;
}

/** Payment-sheet row with no FBA returns CSV / license-plate evidence — financial only. */
export function isSettlementOnlyFinancialMarker(r: ReturnRowLike): boolean {
  return String(r.external_status ?? '') === 'refund_from_payment_sheet'
    && ! returnHasFbaSheetEvidence(r);
}

export function countsAsPendingPhysicalReturn(r: ReturnRowLike): boolean {
  if (String(r.status ?? '').toLowerCase() === 'void') {
    return false;
  }
  if (isSettlementOnlyFinancialMarker(r)) {
    return false;
  }
  const physical = getPhysicalStatus(r);

  return physical === 'pending' || physical === 'in_transit';
}

export function isVisiblePhysicalReturnRow(r: ReturnRowLike): boolean {
  if (String(r.status ?? '').toLowerCase() === 'void') {
    return false;
  }
  if (isSettlementOnlyFinancialMarker(r)) {
    return false;
  }
  const platformId = String(r.platform_return_id ?? '');
  if (platformId.startsWith('STL-')) {
    return returnHasFbaSheetEvidence(r);
  }

  return true;
}

export function channelLabelFromReturn(r: ReturnRowLike): string {
  const ch = r.order?.channel;
  if (ch && typeof ch === 'object' && ch.name) {
    return String(ch.name);
  }
  if (typeof r.channel === 'string' && r.channel.trim() !== '') {
    return r.channel;
  }
  return '—';
}

export function isFbaReturn(r: ReturnRowLike): boolean {
  const slug = String(r.order?.channel?.slug ?? '').toLowerCase();
  const name = channelLabelFromReturn(r).toLowerCase();
  const ext = String(r.external_status ?? '').toLowerCase();
  return slug.includes('fba') || name.includes('fba') || ext.includes('fba_returns');
}

export function isMerchantReturn(r: ReturnRowLike): boolean {
  if (isFbaReturn(r)) {
    return false;
  }
  const slug = String(r.order?.channel?.slug ?? '').toLowerCase();
  const name = channelLabelFromReturn(r).toLowerCase();
  return (
    slug.includes('merchant') ||
    slug.includes('fbm') ||
    name.includes('merchant') ||
    name.includes('fbm') ||
    name.includes('تاجر')
  );
}

export function isCustomerDidNotReceive(r: ReturnRowLike): boolean {
  const reason = String(r.reason ?? '').toLowerCase();
  return (
    /لم\s*يستلم|عدم\s*استلام|لم\s*يتسلم|didn.?t\s*receive|not\s*received|never\s*received|customer.*not.*receive|non.?receipt|cr_not_received|crs/i.test(
      reason,
    ) || reason.includes('لم يستلم العميل')
  );
}

export function formatPhysicalReturnLocation(r: ReturnRowLike): string {
  const direct = String(r.return_location ?? '').trim();
  if (direct) {
    return direct;
  }
  const meta = r.metadata;
  if (meta && typeof meta === 'object' && meta.fulfillment_center_id) {
    return String(meta.fulfillment_center_id).trim();
  }
  const ext = String(r.external_status ?? '');
  const at = ext.lastIndexOf('@');
  if (at >= 0) {
    const tail = ext.slice(at + 1).trim().split(/[,\s]/)[0];
    if (tail) {
      return tail;
    }
  }
  return '';
}

/** Derive physical status from API row (before financial refund conflation). */
export function derivePhysicalStatusFromRaw(r: Record<string, unknown>): PhysicalStatus {
  const lifecycle = String(r.return_status ?? '').toLowerCase();
  if (lifecycle === 'lost') {
    return 'lost';
  }
  if (lifecycle === 'in_transit') {
    return 'in_transit';
  }
  if (lifecycle === 'arrived_to_warehouse') {
    return 'received';
  }
  if (lifecycle === 'restocked' || lifecycle === 'closed') {
    return isFbaReturnRaw(r) ? 'restocked_fba' : 'restocked_shop';
  }

  const internal = String(r.status ?? '').toLowerCase();
  if (internal === 'completed') {
    return isFbaReturnRaw(r) ? 'restocked_fba' : 'restocked_shop';
  }
  if (internal === 'approved') {
    return 'received';
  }
  if (internal === 'in_transit') {
    return 'in_transit';
  }

  const ext = String(r.external_status ?? '').toLowerCase();
  if (ext.includes('transit') || ext.includes('pickup') || ext.includes('carrier')) {
    return 'in_transit';
  }

  return 'pending';
}

export function deriveFinancialStatusFromRaw(r: Record<string, unknown>): FinancialStatus {
  const ext = String(r.external_status ?? '').toLowerCase();
  if (ext.includes('refund') || ext.includes('chargeback')) {
    return 'amazon_refund';
  }
  if (Number(r.refund_amount ?? 0) > 0) {
    return 'amazon_refund';
  }

  return 'none';
}

function isFbaReturnRaw(r: Record<string, unknown>): boolean {
  const order = r.inventory_order as Record<string, unknown> | undefined;
  const ch = order?.channel as Record<string, unknown> | undefined;
  const slug = String(ch?.slug ?? '').toLowerCase();
  const name = String(ch?.name ?? r.channel ?? '').toLowerCase();
  const ext = String(r.external_status ?? '').toLowerCase();
  return slug.includes('fba') || name.includes('fba') || ext.includes('fba_returns');
}

export function getPhysicalStatus(r: ReturnRowLike): PhysicalStatus {
  if (r.physical_status) {
    return r.physical_status;
  }
  const legacy = String(r.return_status ?? '').toLowerCase();
  if (legacy === 'lost') {
    return 'lost';
  }
  if (legacy === 'in_transit') {
    return 'in_transit';
  }
  if (legacy === 'received') {
    return 'received';
  }
  if (legacy === 'restocked') {
    return isFbaReturn(r) ? 'restocked_fba' : 'restocked_shop';
  }
  if (legacy === 'refunded') {
    return 'pending';
  }

  return 'pending';
}

export function getFinancialStatus(r: ReturnRowLike): FinancialStatus {
  if (r.financial_status) {
    return r.financial_status;
  }
  const ext = String(r.external_status ?? '').toLowerCase();
  if (ext.includes('refund') || ext.includes('chargeback')) {
    return 'amazon_refund';
  }
  if (Number(r.refund_amount ?? 0) > 0) {
    return 'amazon_refund';
  }

  return 'none';
}

const PHYSICAL_LABELS: Record<PhysicalStatus, { ar: string; en: string }> = {
  pending: { ar: 'بانتظار الوصول', en: 'Awaiting arrival' },
  in_transit: { ar: 'في الطريق للمستودع', en: 'In transit to warehouse' },
  received: { ar: 'تم الاستلام', en: 'Received' },
  restocked_fba: { ar: 'رجع لمخزون FBA', en: 'Restocked to FBA' },
  restocked_shop: { ar: 'رجع للمحل', en: 'Restocked to shop' },
  lost: { ar: 'هالك / مفقود', en: 'Lost' },
};

const FINANCIAL_LABELS: Record<FinancialStatus, { ar: string; en: string }> = {
  amazon_refund: { ar: 'رد مالي (شيت الدفع)', en: 'Financial refund (settlement)' },
  none: { ar: '', en: '' },
};

export function formatPhysicalStatusLabel(r: ReturnRowLike, isAr: boolean): string {
  const key = getPhysicalStatus(r);
  return isAr ? PHYSICAL_LABELS[key].ar : PHYSICAL_LABELS[key].en;
}

export function formatFinancialStatusLabel(r: ReturnRowLike, isAr: boolean): string {
  const key = getFinancialStatus(r);
  if (key === 'none') {
    return '';
  }
  return isAr ? FINANCIAL_LABELS[key].ar : FINANCIAL_LABELS[key].en;
}

export function physicalStatusBadgeClass(status: PhysicalStatus): string {
  switch (status) {
    case 'restocked_fba':
    case 'restocked_shop':
      return 'bg-emerald-500 text-white';
    case 'in_transit':
      return 'bg-indigo-500 text-white';
    case 'pending':
      return 'bg-amber-500 text-white';
    case 'received':
      return 'bg-teal-600 text-white';
    case 'lost':
      return 'bg-rose-600 text-white';
    default:
      return 'bg-gray-700 text-white';
  }
}

export function matchesPhysicalStatusFilter(r: ReturnRowLike, filter: string): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'refunded') {
    return getFinancialStatus(r) === 'amazon_refund';
  }
  if (filter === 'restocked') {
    return getPhysicalStatus(r) === 'restocked_fba';
  }
  if (filter === 'pending') {
    return getPhysicalStatus(r) === 'pending';
  }
  if (filter === 'in_transit') {
    return getPhysicalStatus(r) === 'in_transit';
  }
  if (filter === 'received') {
    return getPhysicalStatus(r) === 'received';
  }

  return true;
}

export function formatReturnReasonLabel(reason: string | null | undefined, isAr: boolean): string {
  const raw = String(reason ?? '').trim();
  if (!raw) {
    return '—';
  }
  const low = raw.toLowerCase();
  const map: Array<{ test: RegExp; ar: string; en: string }> = [
    { test: /amazon financial refund|claim tracking|رد مالي/i, ar: 'رد مالي (مطالبة)', en: 'Financial refund (claim)' },
    { test: /customer_damaged|damaged/i, ar: 'تالف من العميل', en: 'Customer damaged' },
    { test: /warehouse_damaged|warehouse_damage/i, ar: 'تالف في المستودع', en: 'Warehouse damaged' },
    { test: /lost/i, ar: 'مفقود', en: 'Lost' },
    { test: /لم\s*يستلم|didn.?t\s*receive|not\s*received/i, ar: 'العميل لم يستلم', en: 'Customer did not receive' },
    { test: /defect|quality|عيب/i, ar: 'معيب', en: 'Defective' },
    { test: /wrong|خطأ/i, ar: 'منتج خطأ', en: 'Wrong item' },
    { test: /cancel/i, ar: 'إلغاء', en: 'Cancelled' },
  ];
  for (const row of map) {
    if (row.test.test(low) || row.test.test(raw)) {
      return isAr ? row.ar : row.en;
    }
  }

  return raw;
}

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

type ReturnOrderItemLike = {
  product_name?: string | null;
  sku_code?: string | null;
};

function returnOrderItems(r: ReturnRowLike): ReturnOrderItemLike[] {
  const order = r.order as { items?: ReturnOrderItemLike[] } | null | undefined;
  return Array.isArray(order?.items) ? order.items : [];
}

export function buildReturnSearchIndex(r: ReturnRowLike): { searchBlob: string; productLabels: string[] } {
  const productLabels: string[] = [];
  const parts: string[] = [
    r.id,
    r.return_number,
    r.amazon_order_number,
    r.order?.order_number,
    r.customer_name,
    r.platform_return_id,
    r.sku_code,
    r.reason,
    r.product_name,
  ]
    .filter((x) => x != null && String(x).trim() !== '')
    .map((x) => String(x).toLowerCase());

  const directProduct = String(r.product_name ?? '').trim();
  if (directProduct) {
    productLabels.push(directProduct);
    parts.push(directProduct.toLowerCase(), digitsOnly(directProduct));
  }

  const directSku = String(r.sku_code ?? '').trim();
  if (directSku) {
    parts.push(directSku.toLowerCase(), digitsOnly(directSku));
  }

  for (const item of returnOrderItems(r)) {
    const name = String(item.product_name ?? '').trim();
    const sku = String(item.sku_code ?? '').trim();
    if (name) {
      productLabels.push(name);
      parts.push(name.toLowerCase(), digitsOnly(name));
    }
    if (sku) {
      parts.push(sku.toLowerCase(), digitsOnly(sku));
    }
  }

  return {
    searchBlob: parts.join(' '),
    productLabels: [...new Set(productLabels)],
  };
}

export function returnMatchesSearch(r: ReturnRowLike, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) {
    return true;
  }

  const index = buildReturnSearchIndex(r);
  if (index.searchBlob.includes(q)) {
    return true;
  }

  const qDigits = digitsOnly(q);
  if (qDigits.length >= 2 && digitsOnly(index.searchBlob).includes(qDigits)) {
    return true;
  }

  for (const label of index.productLabels) {
    if (label.toLowerCase().includes(q)) {
      return true;
    }
  }

  return false;
}

export function isFbaNotPhysicallyReturned(r: ReturnRowLike): boolean {
  if (!isFbaReturn(r)) {
    return false;
  }
  const physical = getPhysicalStatus(r);
  const hasLocation = formatPhysicalReturnLocation(r).trim() !== '';
  if (hasLocation && (physical === 'received' || physical === 'restocked_fba')) {
    return false;
  }
  return (
    physical === 'pending' ||
    physical === 'in_transit' ||
    (getFinancialStatus(r) === 'amazon_refund' && physical !== 'restocked_fba')
  );
}

export function orderNumberForCopy(r: ReturnRowLike): string {
  return String(r.order?.order_number ?? r.amazon_order_number ?? '').trim();
}
