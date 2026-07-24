import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { AlertTriangle, Package, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface LowStockAlertsProps {
  alerts: Array<{
    id: number | string;
    product: string;
    sku: string;
    current: number;
    minimum: number;
    warehouse: string;
  }>;
}

const PAGE_SIZE = 10;

export function LowStockAlerts({ alerts }: LowStockAlertsProps) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(alerts.length / PAGE_SIZE);
  const pageAlerts = alerts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.7 }}
      className="glass-card rounded-xl p-6 border-warning/20"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-warning" />
          <h3 className="text-lg font-semibold">{t('dashboard.lowStock')}</h3>
        </div>
        <span className="badge-status badge-warning">{alerts.length} {isAr ? 'منتج' : 'items'}</span>
      </div>
      <div className="space-y-3">
        {pageAlerts.map((alert, index) => (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.1 + index * 0.04 }}
            className="flex items-center gap-3 p-3 rounded-lg bg-warning/5 border border-warning/10"
          >
            <div className="p-2 rounded-lg bg-warning/10">
              <Package className="w-4 h-4 text-warning" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{alert.product}</p>
              <p className="text-xs text-muted-foreground">{alert.sku} • {alert.warehouse}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold text-warning">{alert.current} {isAr ? 'متبقي' : 'left'}</p>
              <p className="text-xs text-muted-foreground">{isAr ? `الحد الأدنى: ${alert.minimum}` : `Min: ${alert.minimum}`}</p>
            </div>
            <Button size="sm" variant="outline" className="border-warning/30 text-warning hover:bg-warning/10">
              {isAr ? 'إعادة طلب' : 'Reorder'}
            </Button>
          </motion.div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
          <span className="text-xs text-muted-foreground">
            {isAr
              ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, alerts.length)} من ${alerts.length}`
              : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, alerts.length)} of ${alerts.length}`}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
            >
              {isAr ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </Button>
            <span className="text-xs text-muted-foreground px-2">{page + 1} / {totalPages}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={page === totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              {isAr ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
