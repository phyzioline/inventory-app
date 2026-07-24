import { useLanguage } from '@/contexts/LanguageContext';
import { TrendingUp, TrendingDown, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TopProductsTableProps {
  products: Array<{
    id: number | string;
    name: string;
    sku: string;
    sales: number;
    revenue: number;
    trend: number;
  }>;
}

export function TopProductsTable({ products }: TopProductsTableProps) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';

  return (
    <div className="glass-card rounded-lg p-2.5 flex flex-col min-h-0 max-h-[260px]">
      <div className="flex items-center justify-between mb-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <Trophy className="h-3.5 w-3.5 text-primary shrink-0" />
          <h3 className="text-[11px] font-semibold leading-none">{t('dashboard.topProducts')}</h3>
        </div>
        <span className="text-[9px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          {products.length} {isAr ? 'منتج' : 'items'}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-0.5">
        {products.length === 0 ? (
          <p className="text-center text-muted-foreground py-4 text-[10px]">
            {isAr ? 'لا توجد بيانات للفترة المحددة.' : 'No product data for the selected period.'}
          </p>
        ) : (
          products.map((product) => (
            <div
              key={product.id}
              className="flex items-center gap-1.5 py-1 px-1.5 rounded-md bg-muted/25 border border-border/40 hover:bg-muted/40 transition-colors"
            >
              <div className="p-0.5 rounded bg-primary/10 shrink-0">
                <Trophy className="h-2.5 w-2.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium leading-tight truncate" title={product.name}>
                  {product.name}
                </p>
                <p className="text-[9px] text-muted-foreground leading-tight truncate" title={product.sku}>
                  {product.sku}
                  <span className="mx-1 opacity-40">•</span>
                  {product.sales.toLocaleString()} {isAr ? 'مبيع' : 'sold'}
                </p>
              </div>
              <div className="text-end shrink-0 leading-tight">
                <p className="text-[10px] font-semibold tabular-nums whitespace-nowrap">
                  {product.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  <span className="text-[8px] font-normal text-muted-foreground ms-0.5">
                    {isAr ? 'ج.م' : 'EGP'}
                  </span>
                </p>
                <p
                  className={cn(
                    'text-[9px] tabular-nums inline-flex items-center justify-end gap-0.5',
                    product.trend > 0 ? 'text-success' : 'text-destructive'
                  )}
                >
                  {product.trend > 0 ? (
                    <TrendingUp className="h-2.5 w-2.5" />
                  ) : (
                    <TrendingDown className="h-2.5 w-2.5" />
                  )}
                  {Math.abs(product.trend).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
