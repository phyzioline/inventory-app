import { motion } from 'framer-motion';
import { Store, ShoppingCart, DollarSign, TrendingUp, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface SalesChannelStatusProps {
  channels: Array<{
    name: string;
    orders: number;
    sales: number;
    profit: number;
    returns: number;
  }>;
  isError?: boolean;
}

export function SalesChannelsStatus({ channels, isError = false }: SalesChannelStatusProps) {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className="glass-card rounded-xl p-6"
    >
      <h3 className="text-lg font-semibold mb-4">{isAr ? 'قنوات البيع' : 'Sales Channels'}</h3>
      <div className="space-y-3">
        {channels.map((channel, index) => (
          <motion.div
            key={channel.name}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, delay: 0.6 + index * 0.04 }}
            className="rounded-lg border border-border/60 bg-secondary/20 p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Store className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{channel.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">{channel.orders} {isAr ? 'طلب' : 'orders'}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded bg-background/60 p-2">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <ShoppingCart className="w-3 h-3" />
                  <span>{isAr ? 'الطلبات' : 'Orders'}</span>
                </div>
                <div className="font-semibold">{channel.orders.toLocaleString()}</div>
              </div>
              <div className="rounded bg-background/60 p-2">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <DollarSign className="w-3 h-3" />
                  <span>{isAr ? 'المبيعات' : 'Sales'}</span>
                </div>
                <div className="font-semibold">{channel.sales.toLocaleString()} EGP</div>
              </div>
              <div className="rounded bg-background/60 p-2">
                <div className="flex items-center gap-1 text-muted-foreground mb-1">
                  <TrendingUp className="w-3 h-3" />
                  <span>{isAr ? 'الربح' : 'Profit'}</span>
                </div>
                <div className="font-semibold">{channel.profit.toLocaleString()} EGP</div>
              </div>
            </div>

            <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
              <RotateCcw className="w-3 h-3" />
              <span>{isAr ? `المرتجعات: ${channel.returns.toLocaleString()}` : `Returns: ${channel.returns.toLocaleString()}`}</span>
            </div>
          </motion.div>
        ))}
        {channels.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {isError
              ? (isAr ? 'تعذر تحميل بيانات القنوات — حاول تحديث الصفحة.' : 'Could not load channel data — try refreshing.')
              : (isAr ? 'لا توجد قنوات بيع للفترة المحددة.' : 'No sales channels for selected period.')}
          </p>
        ) : null}
      </div>
    </motion.div>
  );
}
