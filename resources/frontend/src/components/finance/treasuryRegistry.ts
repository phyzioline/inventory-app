/**
 * Optional treasury categories (extend here so new modules appear without editing TreasuryDashboard).
 * Each row needs a stable `id`, labels, numeric `value`, SPA `path`, and a Lucide icon component.
 */
import type { TreasuryExtraRow } from '@/components/finance/TreasuryDashboard';

export const treasuryExtraInbound: TreasuryExtraRow[] = [];

export const treasuryExtraOutbound: TreasuryExtraRow[] = [];
