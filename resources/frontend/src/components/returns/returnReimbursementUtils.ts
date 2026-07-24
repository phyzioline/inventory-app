import { getPhysicalStatus, type PhysicalStatus } from '@/components/returns/returnDisplayUtils';

/** Amazon FBA reimbursement filing window from purchase/order date (seller workflow). */
export const REIMBURSEMENT_WINDOW_DAYS = 45;
/** Lost / inventory-ledger style claims often use a 60-day window from the anchor event. */
export const LOST_REIMBURSEMENT_WINDOW_DAYS = 60;

const PHYSICALLY_CLOSED_FOR_CLAIM: PhysicalStatus[] = [
  'received',
  'restocked_fba',
  'restocked_shop',
  'lost',
];

export function isPhysicallyClosedForClaim(row: Record<string, unknown>): boolean {
  return PHYSICALLY_CLOSED_FOR_CLAIM.includes(getPhysicalStatus(row));
}

export type ReimbursementMode =
  | 'none'
  | 'lost_no_anchor'
  | 'lost_track_pending'
  | 'lost_track_ready'
  | 'damaged_pending'
  | 'damaged_ready'
  | 'damaged_no_order_date'
  | 'anchor_pending'
  | 'anchor_ready'
  | 'claim_paid';

export type ReimbursementState = {
  mode: ReimbursementMode;
  daysLeft?: number;
  eligibleDate?: Date;
  subkind?: string;
};

export type ReimbursementCategory = 'ready' | 'pending' | 'paid' | 'none';

export type ReimbursementDisplay = 'ready' | 'pending' | 'paid' | 'none';

function parseMetadataReimbursement(r: Record<string, unknown>): {
  anchor: Date;
  windowDays: number;
  kind?: string;
} | null {
  const meta = r.metadata as Record<string, unknown> | undefined;
  const rm = meta?.reimbursement;
  if (!rm || typeof rm !== 'object') {
    return null;
  }
  const rmObj = rm as Record<string, unknown>;
  const anchorRaw = rmObj.anchor_date ?? rmObj.anchorDate;
  if (anchorRaw == null || String(anchorRaw).trim() === '') {
    return null;
  }
  const anchor = new Date(String(anchorRaw));
  if (Number.isNaN(anchor.getTime())) {
    return null;
  }
  const kindRaw = rmObj.kind;
  const kind = kindRaw != null ? String(kindRaw) : undefined;
  const wd = Number(rmObj.window_days ?? rmObj.windowDays ?? NaN);
  const defaultWindow = kind === 'settlement_vs_returns_sheet_gap' ? 45 : 60;
  const windowDays = Number.isFinite(wd) && wd > 0 ? wd : defaultWindow;

  return { anchor, windowDays, kind };
}

export function isSettlementSheetGapKind(subkind?: string): boolean {
  return subkind === 'settlement_gap' || subkind === 'settlement_vs_returns_sheet_gap';
}

export function computeReimbursementWindow(anchor: Date, windowDays: number) {
  const eligible = new Date(anchor);
  eligible.setDate(eligible.getDate() + windowDays);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const el = new Date(eligible);
  el.setHours(0, 0, 0, 0);
  const diffMs = el.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffMs / 86400000);

  return { daysLeft, eligibleDate: eligible, ready: daysLeft <= 0 };
}

export function parseDetailedDisposition(r: Record<string, unknown>): string {
  const meta = r.metadata as Record<string, unknown> | undefined;
  if (meta?.raw && typeof meta.raw === 'object') {
    const raw = meta.raw as Record<string, unknown>;
    const v = raw['detailed-disposition'] ?? raw['detailed_disposition'];
    if (v != null && String(v).trim() !== '') {
      return String(v).trim().toUpperCase();
    }
  }
  const ext = String(r.external_status || '');
  const m = ext.match(/fba_returns:([^@]+)@/i);
  if (m) {
    return m[1].trim().toUpperCase();
  }

  return String(r.reason || '').trim().toUpperCase();
}

export function isLostDisposition(r: Record<string, unknown>): boolean {
  const d = parseDetailedDisposition(r);
  if (/\bLOST\b/i.test(d)) {
    return true;
  }

  return String(r.reason || '')
    .toUpperCase()
    .includes('LOST');
}

export function isReimbursementDamagedDisposition(detailed: string): boolean {
  if (!detailed) {
    return false;
  }
  const u = detailed.toUpperCase();
  return (
    u.includes('CUSTOMER_DAMAGED') ||
    u.includes('WAREHOUSE_DAMAGED') ||
    u.includes('WAREHOUSE_DAMAGE')
  );
}

export function getReimbursementState(r: Record<string, unknown>): ReimbursementState {
  const meta = r.metadata as Record<string, unknown> | undefined;
  const rmTop = meta?.reimbursement;
  if (rmTop && typeof rmTop === 'object') {
    const rmObj = rmTop as Record<string, unknown>;
    const paid = rmObj.claim_paid ?? rmObj.claimPaid;
    if (paid === true) {
      const pAt = rmObj.claim_paid_at ?? rmObj.claimPaidAt;
      const eligible =
        pAt != null && String(pAt).trim() !== '' ? new Date(String(pAt)) : undefined;
      return {
        mode: 'claim_paid',
        eligibleDate: eligible && !Number.isNaN(eligible.getTime()) ? eligible : undefined,
      };
    }
  }

  const rmEarly = meta?.reimbursement;
  if (rmEarly && typeof rmEarly === 'object') {
    const rmObj = rmEarly as Record<string, unknown>;
    const ri = rmObj.ready_immediate ?? rmObj.readyImmediate;
    const srcEarly = String(rmObj.source ?? '');
    if (ri === true && srcEarly === 'settlement_refund_missing_returns_sheet') {
      const wdRaw = Number(rmObj.window_days ?? rmObj.windowDays ?? 45);
      const windowDays = Number.isFinite(wdRaw) && wdRaw > 0 ? wdRaw : 45;
      const anchorPreferReturn =
        r.return_date ?? rmObj.anchor_date ?? rmObj.anchorDate;
      if (anchorPreferReturn != null && String(anchorPreferReturn).trim() !== '') {
        const start = new Date(String(anchorPreferReturn));
        if (!Number.isNaN(start.getTime())) {
          const c = computeReimbursementWindow(start, windowDays);
          if (c.ready) {
            return {
              mode: 'anchor_ready',
              daysLeft: 0,
              eligibleDate: c.eligibleDate,
              subkind: 'settlement_vs_returns_sheet_gap',
            };
          }
          return {
            mode: 'anchor_pending',
            daysLeft: c.daysLeft,
            eligibleDate: c.eligibleDate,
            subkind: 'settlement_vs_returns_sheet_gap',
          };
        }
      }
    }
  }

  const mr = parseMetadataReimbursement(r);
  if (mr) {
    const c = computeReimbursementWindow(mr.anchor, mr.windowDays);
    if (c.ready) {
      return { mode: 'anchor_ready', daysLeft: 0, eligibleDate: c.eligibleDate, subkind: mr.kind };
    }
    return {
      mode: 'anchor_pending',
      daysLeft: c.daysLeft,
      eligibleDate: c.eligibleDate,
      subkind: mr.kind,
    };
  }

  if (isLostDisposition(r)) {
    const order = r.order as Record<string, unknown> | undefined;
    const od =
      order?.order_date ?? r.order_date ?? r.return_date ?? r.transaction_return_date;
    if (!od) {
      return { mode: 'lost_no_anchor' };
    }
    const start = new Date(od as string);
    if (Number.isNaN(start.getTime())) {
      return { mode: 'lost_no_anchor' };
    }
    const c = computeReimbursementWindow(start, LOST_REIMBURSEMENT_WINDOW_DAYS);
    if (c.ready) {
      return { mode: 'lost_track_ready', daysLeft: 0, eligibleDate: c.eligibleDate };
    }
    return { mode: 'lost_track_pending', daysLeft: c.daysLeft, eligibleDate: c.eligibleDate };
  }

  const disp = parseDetailedDisposition(r);
  if (!isReimbursementDamagedDisposition(disp)) {
    return { mode: 'none' };
  }
  const order = r.order as Record<string, unknown> | undefined;
  const od = order?.order_date ?? r.order_date;
  if (!od) {
    return { mode: 'damaged_no_order_date' };
  }
  const start = new Date(od as string);
  if (Number.isNaN(start.getTime())) {
    return { mode: 'damaged_no_order_date' };
  }
  const eligible = new Date(start);
  eligible.setDate(eligible.getDate() + REIMBURSEMENT_WINDOW_DAYS);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const el = new Date(eligible);
  el.setHours(0, 0, 0, 0);
  const diffMs = el.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffMs / 86400000);
  if (daysLeft <= 0) {
    return { mode: 'damaged_ready', daysLeft: 0, eligibleDate: eligible };
  }
  return { mode: 'damaged_pending', daysLeft, eligibleDate: eligible };
}

export function rowReimbursementCategory(r: Record<string, unknown>): ReimbursementCategory {
  const st = getReimbursementState(r);
  if (st.mode === 'claim_paid') {
    return 'paid';
  }
  if (st.mode === 'lost_track_ready' || st.mode === 'damaged_ready' || st.mode === 'anchor_ready') {
    return 'ready';
  }
  if (
    st.mode === 'lost_track_pending' ||
    st.mode === 'damaged_pending' ||
    st.mode === 'anchor_pending' ||
    st.mode === 'lost_no_anchor' ||
    st.mode === 'damaged_no_order_date'
  ) {
    return 'pending';
  }

  return 'none';
}

export type GroupReimbursementSummary = {
  lostNoAnchor: boolean;
  lostTrackMinDays: number | null;
  lostTrackAny: boolean;
  lostTrackAnyReady: boolean;
  anchorMinDays: number | null;
  anchorAny: boolean;
  anchorAnyReady: boolean;
  damagedMinDays: number | null;
  anyReady: boolean;
  anyDamaged: boolean;
  noOrderDate: boolean;
  groupMinPendingDays: number | null;
  groupAnyReady: boolean;
  claimPaidAny: boolean;
};

export function summarizeGroupReimbursement(rows: Record<string, unknown>[]): GroupReimbursementSummary {
  let lostNoAnchor = false;
  let lostTrackMinDays: number | null = null;
  let lostTrackAny = false;
  let lostTrackAnyReady = false;

  let anchorMinDays: number | null = null;
  let anchorAny = false;
  let anchorAnyReady = false;

  let damagedMinDays: number | null = null;
  let anyReady = false;
  let anyDamaged = false;
  let noOrderDate = false;
  let claimPaidAny = false;

  for (const r of rows) {
    if (isPhysicallyClosedForClaim(r)) {
      continue;
    }
    const st = getReimbursementState(r);
    if (st.mode === 'claim_paid') {
      claimPaidAny = true;
    }
    if (st.mode === 'lost_no_anchor') {
      lostNoAnchor = true;
    }
    if (st.mode === 'lost_track_pending') {
      lostTrackAny = true;
      lostTrackMinDays =
        lostTrackMinDays === null ? st.daysLeft! : Math.min(lostTrackMinDays, st.daysLeft!);
    }
    if (st.mode === 'lost_track_ready') {
      lostTrackAny = true;
      lostTrackAnyReady = true;
    }
    if (st.mode === 'anchor_pending') {
      anchorAny = true;
      anchorMinDays = anchorMinDays === null ? st.daysLeft! : Math.min(anchorMinDays, st.daysLeft!);
    }
    if (st.mode === 'anchor_ready') {
      anchorAny = true;
      anchorAnyReady = true;
    }
    if (st.mode === 'damaged_pending') {
      anyDamaged = true;
      damagedMinDays =
        damagedMinDays === null ? st.daysLeft! : Math.min(damagedMinDays, st.daysLeft!);
    }
    if (st.mode === 'damaged_ready') {
      anyDamaged = true;
      anyReady = true;
    }
    if (st.mode === 'damaged_no_order_date') {
      noOrderDate = true;
    }
  }

  const pendingDays = [anchorMinDays, lostTrackMinDays, damagedMinDays].filter(
    (x): x is number => x != null && x > 0,
  );
  const groupMinPendingDays = pendingDays.length ? Math.min(...pendingDays) : null;
  const groupAnyReady = anchorAnyReady || lostTrackAnyReady || anyReady;

  return {
    lostNoAnchor,
    lostTrackMinDays,
    lostTrackAny,
    lostTrackAnyReady,
    anchorMinDays,
    anchorAny,
    anchorAnyReady,
    damagedMinDays,
    anyReady,
    anyDamaged,
    noOrderDate,
    groupMinPendingDays,
    groupAnyReady,
    claimPaidAny,
  };
}

/** Single badge rule: paid > ready > pending > none (never ready + days together). */
export function resolveReimbursementDisplay(rows: Record<string, unknown>[]): {
  display: ReimbursementDisplay;
  daysLeft?: number;
} {
  const rg = summarizeGroupReimbursement(rows);
  if (rg.claimPaidAny) {
    return { display: 'paid' };
  }
  if (rg.groupAnyReady) {
    return { display: 'ready' };
  }
  if (rg.groupMinPendingDays != null && rg.groupMinPendingDays > 0) {
    return { display: 'pending', daysLeft: rg.groupMinPendingDays };
  }
  if (rg.lostNoAnchor || rg.noOrderDate) {
    return { display: 'pending' };
  }

  return { display: 'none' };
}

export function resolveRowReimbursementDisplay(r: Record<string, unknown>): {
  display: ReimbursementDisplay;
  daysLeft?: number;
} {
  if (isPhysicallyClosedForClaim(r)) {
    return { display: 'none' };
  }
  const st = getReimbursementState(r);
  if (st.mode === 'claim_paid') {
    return { display: 'paid' };
  }
  if (st.mode === 'lost_track_ready' || st.mode === 'damaged_ready' || st.mode === 'anchor_ready') {
    return { display: 'ready' };
  }
  if (
    st.mode === 'lost_track_pending' ||
    st.mode === 'damaged_pending' ||
    st.mode === 'anchor_pending'
  ) {
    return { display: 'pending', daysLeft: st.daysLeft };
  }
  if (st.mode === 'lost_no_anchor' || st.mode === 'damaged_no_order_date') {
    return { display: 'pending' };
  }

  return { display: 'none' };
}

export function formatReimbursementExportLabel(
  rows: Record<string, unknown>[],
  isAr: boolean,
  t: (key: string) => string,
): string {
  const resolved = resolveReimbursementDisplay(rows);
  if (resolved.display === 'paid') {
    return t('returns.reimbursement.claimPaid') || 'Reimbursement received';
  }
  if (resolved.display === 'ready') {
    return t('returns.reimbursement.ready') || 'Ready to claim';
  }
  if (resolved.display === 'pending' && resolved.daysLeft != null && resolved.daysLeft > 0) {
    return isAr ? `انتظر ${resolved.daysLeft} يوم` : `Wait ${resolved.daysLeft} days`;
  }
  const rg = summarizeGroupReimbursement(rows);
  if (rg.lostNoAnchor) {
    return t('returns.lost.noDateBadge') || 'Lost — no anchor date';
  }
  if (rg.noOrderDate) {
    return t('returns.reimbursement.noOrderDate') || 'Add order date';
  }

  return '—';
}
