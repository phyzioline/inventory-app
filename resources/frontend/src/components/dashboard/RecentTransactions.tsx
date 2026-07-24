import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowUpRight, ArrowDownLeft, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RecentTransactionsProps {
  transactions: Array<{
    id: string | number;
    type: string;
    description: string;
    amount: number;
    customer: string;
    time: string;
    status: string;
  }>;
}

export function RecentTransactions({ transactions }: RecentTransactionsProps) {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'sale':
        return <ArrowUpRight className="w-4 h-4" />;
      case 'purchase':
        return <ArrowDownLeft className="w-4 h-4" />;
      case 'return':
        return <RotateCcw className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'sale':
        return 'bg-success/10 text-success';
      case 'purchase':
        return 'bg-info/10 text-info';
      case 'return':
        return 'bg-warning/10 text-warning';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return 'badge-success';
      case 'credit':
        return 'badge-warning';
      case 'pending':
        return 'badge-info';
      case 'processing':
      case 'shipped':
      case 'confirmed':
      case 'completed':
      case 'delivered':
      case 'sold':
        return 'badge-info';
      case 'cancelled':
        return 'badge-warning';
      default:
        return '';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      className="glass-card rounded-xl p-6"
    >
      <h3 className="text-lg font-semibold mb-4">{t('dashboard.recentTransactions')}</h3>
      <div className="space-y-3">
        {transactions.map((transaction, index) => (
          <motion.div
            key={transaction.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.7 + index * 0.05 }}
            className="flex items-center gap-4 p-3 rounded-lg hover:bg-secondary/30 transition-colors"
          >
            <div className={cn('p-2 rounded-lg', getTypeColor(transaction.type))}>
              {getTypeIcon(transaction.type)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{String(transaction.description ?? '')}</p>
              <p className="text-xs text-muted-foreground">{String(transaction.customer ?? '')}</p>
            </div>
            <div className="text-right">
              <p className={cn(
                'text-sm font-semibold',
                transaction.type === 'sale' ? 'text-success' :
                  transaction.type === 'purchase' ? 'text-info' : 'text-warning'
              )}>
                {transaction.type === 'sale' ? '+' : '-'}{transaction.amount.toLocaleString()} {isAr ? 'ج.م' : 'EGP'}
              </p>
              <p className="text-xs text-muted-foreground">{transaction.time}</p>
            </div>
            <span className={cn('badge-status', getStatusBadge(transaction.status))}>
              {(() => {
                const slug =
                  typeof transaction.status === 'string' && transaction.status.trim()
                    ? transaction.status.trim().toLowerCase().replace(/\s+/g, '_')
                    : 'pending';
                const key = `common.${slug}`;
                const translated = t(key);
                return translated === key ? slug.replace(/_/g, ' ') : translated;
              })()}
            </span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
