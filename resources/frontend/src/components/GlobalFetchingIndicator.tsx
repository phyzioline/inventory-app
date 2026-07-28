import { useEffect, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const SHOW_AFTER_MS = 280;

/**
 * Top-of-app banner while any React Query request is in flight.
 * Prevents “empty / صفر” screens from looking like missing data during load.
 */
export function GlobalFetchingIndicator() {
  const fetchingCount = useIsFetching();
  const { t, language } = useLanguage();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (fetchingCount <= 0) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [fetchingCount]);

  if (!visible || fetchingCount <= 0) {
    return null;
  }

  const label = t('common.loading') || (language === 'ar' ? 'جاري التحميل...' : 'Loading...');

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-3 inset-x-0 z-[100] flex justify-center px-3"
    >
      <div className="pointer-events-none inline-flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <span>{label}</span>
      </div>
    </div>
  );
}
