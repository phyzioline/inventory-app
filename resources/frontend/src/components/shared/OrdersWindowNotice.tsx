import { Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Shown on screens that read the undated order list. The server returns only the last
 * 90 days there (X-Orders-Window-Days); whole history comes from server reports.
 */
export function OrdersWindowNotice({ days = 90 }: { days?: number }) {
  const { t } = useLanguage();

  return (
    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground" role="note">
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{t('orders.windowNotice').replace('{days}', String(days))}</span>
    </p>
  );
}
