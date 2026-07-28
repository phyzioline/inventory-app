import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type Props = {
  className?: string;
  label?: string;
  /** Compact inline row (tables / cards) vs full page block */
  compact?: boolean;
};

/** Shared empty-slot replacement while data is still loading. */
export function DataLoadingState({ className, label, compact = false }: Props) {
  const { t, language } = useLanguage();
  const text = label || t('common.loading') || (language === 'ar' ? 'جاري التحميل...' : 'Loading...');

  if (compact) {
    return (
      <div className={cn('inline-flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="animate-pulse">{text}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className={cn('flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground', className)}
    >
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-sm animate-pulse">{text}</p>
    </div>
  );
}
