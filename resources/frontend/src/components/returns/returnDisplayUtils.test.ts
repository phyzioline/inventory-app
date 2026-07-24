import { describe, expect, it } from 'vitest';
import {
  countsAsPendingPhysicalReturn,
  deriveFinancialStatusFromRaw,
  derivePhysicalStatusFromRaw,
  formatReturnReasonLabel,
  getFinancialStatus,
  getPhysicalStatus,
  isFbaReturn,
  isSettlementOnlyFinancialMarker,
  isVisiblePhysicalReturnRow,
  matchesPhysicalStatusFilter,
  returnMatchesSearch,
} from './returnDisplayUtils';

describe('derivePhysicalStatusFromRaw', () => {
  it('does not map settlement refund to physical received', () => {
    const raw = {
      return_status: 'return_requested',
      external_status: 'settlement:refund',
      refund_amount: 120,
      inventory_order: { channel: { slug: 'amazon-fba', name: 'Amazon FBA' } },
    };
    expect(derivePhysicalStatusFromRaw(raw)).toBe('pending');
    expect(deriveFinancialStatusFromRaw(raw)).toBe('amazon_refund');
  });

  it('maps warehouse arrival separately from financial refund', () => {
    const raw = {
      return_status: 'arrived_to_warehouse',
      external_status: 'settlement:refund',
      inventory_order: { channel: { slug: 'amazon-fba' } },
    };
    expect(derivePhysicalStatusFromRaw(raw)).toBe('received');
    expect(deriveFinancialStatusFromRaw(raw)).toBe('amazon_refund');
  });

  it('maps FBA restock only for FBA channel', () => {
    const fba = {
      return_status: 'restocked',
      inventory_order: { channel: { slug: 'amazon-fba', name: 'Amazon FBA' } },
    };
    const shop = {
      return_status: 'restocked',
      inventory_order: { channel: { slug: 'shop', name: 'Shop' } },
    };
    expect(derivePhysicalStatusFromRaw(fba)).toBe('restocked_fba');
    expect(derivePhysicalStatusFromRaw(shop)).toBe('restocked_shop');
  });
});

describe('mapped row helpers', () => {
  it('filters financial refund separately from physical pending', () => {
    const row = {
      return_status: 'refunded',
      physical_status: 'pending' as const,
      financial_status: 'amazon_refund' as const,
      order: { channel: { slug: 'amazon-fba', name: 'Amazon FBA' } },
    };
    expect(getPhysicalStatus(row)).toBe('pending');
    expect(getFinancialStatus(row)).toBe('amazon_refund');
    expect(matchesPhysicalStatusFilter(row, 'refunded')).toBe(true);
    expect(matchesPhysicalStatusFilter(row, 'received')).toBe(false);
  });

  it('detects FBA returns', () => {
    expect(isFbaReturn({ order: { channel: { slug: 'amazon-fba' } } })).toBe(true);
    expect(isFbaReturn({ order: { channel: { slug: 'merchant' } } })).toBe(false);
  });

  it('excludes settlement-only financial markers from pending physical counts', () => {
    const marker = {
      external_status: 'refund_from_payment_sheet',
      physical_status: 'pending' as const,
      financial_status: 'amazon_refund' as const,
    };
    const principalMarker = {
      external_status: 'refund_from_payment_sheet',
      platform_return_id: 'STL-1-ORDER-abc',
      reason: 'RefundPrice: Principal',
      physical_status: 'pending' as const,
    };
    const physical = {
      external_status: 'fba_returns:SELLABLE@FC1',
      physical_status: 'pending' as const,
    };
    expect(isSettlementOnlyFinancialMarker(marker)).toBe(true);
    expect(countsAsPendingPhysicalReturn(marker)).toBe(false);
    expect(isVisiblePhysicalReturnRow(principalMarker)).toBe(false);
    expect(isVisiblePhysicalReturnRow(physical)).toBe(true);
  });
});

describe('returnMatchesSearch', () => {
  it('matches product name and sku from return row and order items', () => {
    const row = {
      amazon_order_number: '171-3749970-2949902',
      sku_code: 'NK-MPPF-2GBV',
      product_name: 'Jewelry Box',
      order: {
        order_number: '171-3749970-2949902',
        items: [{ product_name: 'Velvet Ring Box', sku_code: 'NK-MPPF-2GBV' }],
      },
    };
    expect(returnMatchesSearch(row, 'jewelry')).toBe(true);
    expect(returnMatchesSearch(row, 'NK-MPPF')).toBe(true);
    expect(returnMatchesSearch(row, '3749970')).toBe(true);
    expect(returnMatchesSearch(row, 'velvet')).toBe(true);
    expect(returnMatchesSearch(row, 'missing-item')).toBe(false);
  });
});

describe('formatReturnReasonLabel', () => {
  it('translates common Amazon reason codes', () => {
    expect(formatReturnReasonLabel('CUSTOMER_DAMAGED', true)).toBe('تالف من العميل');
    expect(formatReturnReasonLabel("Customer didn't receive", false)).toBe('Customer did not receive');
  });
});
