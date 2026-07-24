import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { Warehouse, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface WarehouseStatusProps {
  warehouses: Array<{
    id: number | string;
    name: string;
    type: string;
    capacity: number;
    items: number;
    alerts: number;
  }>;
}

export function WarehouseStatus({ warehouses }: WarehouseStatusProps) {
  const { t } = useLanguage();

  const getCapacityColor = (capacity: number) => {
    if (capacity >= 90) return 'text-destructive';
    if (capacity >= 70) return 'text-warning';
    return 'text-success';
  };

  const getProgressColor = (capacity: number) => {
    if (capacity >= 90) return 'bg-destructive';
    if (capacity >= 70) return 'bg-warning';
    return 'bg-success';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className="glass-card rounded-xl p-6"
    >
      <h3 className="text-lg font-semibold mb-4">{t('dashboard.warehouseStatus')}</h3>
      <div className="space-y-4">
        {warehouses.map((warehouse, index) => (
          <motion.div
            key={warehouse.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.6 + index * 0.05 }}
            className="p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm">{warehouse.name}</span>
                {warehouse.alerts > 0 ? (
                  <span className="badge-status badge-warning">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {warehouse.alerts}
                  </span>
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-success" />
                )}
              </div>
              <span className={cn('text-sm font-medium', getCapacityColor(warehouse.capacity))}>
                {warehouse.capacity}%
              </span>
            </div>
            <div className="relative">
              <Progress value={warehouse.capacity} className="h-2" />
              <div
                className={cn(
                  'absolute top-0 left-0 h-full rounded-full transition-all',
                  getProgressColor(warehouse.capacity)
                )}
                style={{ width: `${warehouse.capacity}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {warehouse.items.toLocaleString()} items
            </p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
