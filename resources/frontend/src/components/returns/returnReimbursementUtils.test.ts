import { describe, expect, it } from 'vitest';
import {
  isPhysicallyClosedForClaim,
  resolveReimbursementDisplay,
  resolveRowReimbursementDisplay,
} from './returnReimbursementUtils';

describe('reimbursement vs physical receipt', () => {
  const claimablePending = {
    return_status: 'return_requested',
    reason: 'CUSTOMER_DAMAGED',
    order: {
      order_date: new Date(Date.now() - 10 * 86400000).toISOString(),
      channel: { slug: 'amazon-fba', name: 'Amazon FBA' },
    },
  };

  const receivedRow = {
    ...claimablePending,
    return_status: 'arrived_to_warehouse',
    physical_status: 'received' as const,
  };

  it('hides row reimbursement when physically received', () => {
    expect(resolveRowReimbursementDisplay(claimablePending).display).not.toBe('none');
    expect(resolveRowReimbursementDisplay(receivedRow).display).toBe('none');
    expect(isPhysicallyClosedForClaim(receivedRow)).toBe(true);
  });

  it('hides group reimbursement when all lines are received', () => {
    expect(resolveReimbursementDisplay([claimablePending]).display).not.toBe('none');
    expect(resolveReimbursementDisplay([receivedRow]).display).toBe('none');
    expect(
      resolveReimbursementDisplay([receivedRow, { ...receivedRow, id: 2 }]).display,
    ).toBe('none');
  });

  it('keeps group claim when only some lines are still open', () => {
    const mixed = [receivedRow, claimablePending];
    expect(resolveReimbursementDisplay(mixed).display).not.toBe('none');
  });
});
