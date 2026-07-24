import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { History, Package } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Product } from '@/lib/supabase-services';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

interface PurchaseHistoryDialogProps {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
}

export function PurchaseHistoryDialog({ product, isOpen, onClose }: PurchaseHistoryDialogProps) {
  const { data: history, isLoading } = useQuery({
    queryKey: ['purchase-history', product.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_invoice_items')
        .select(`
          *,
          invoice:purchase_invoices(
            id,
            invoice_number,
            created_at,
            supplier:suppliers(name)
          )
        `)
        .eq('product_id', product.id)
        .order('id', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: isOpen,
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Purchase History
          </DialogTitle>
          <DialogDescription>
            {product.name} ({product.sku})
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4 py-4">
          <div className="text-center p-3 rounded-lg bg-secondary/50">
            <p className="text-2xl font-bold text-primary">
              {product.lowest_price?.toLocaleString() || '-'}
            </p>
            <p className="text-xs text-muted-foreground">Lowest Price</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-secondary/50">
            <p className="text-2xl font-bold">
              {product.avg_purchase_price?.toLocaleString() || '-'}
            </p>
            <p className="text-xs text-muted-foreground">Avg Price</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-secondary/50">
            <p className="text-2xl font-bold text-destructive">
              {product.highest_price?.toLocaleString() || '-'}
            </p>
            <p className="text-xs text-muted-foreground">Highest Price</p>
          </div>
        </div>

        <ScrollArea className="h-[300px] pr-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              Loading history...
            </div>
          )}

          {!isLoading && (!history || history.length === 0) && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Package className="w-12 h-12 mb-2 opacity-50" />
              <p>No purchase history yet</p>
            </div>
          )}

          {history && history.length > 0 && (
            <div className="space-y-3">
              {history.map((item: any) => (
                <div 
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-card"
                >
                  <div>
                    <p className="font-medium">
                      {item.invoice?.invoice_number || 'Invoice'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.invoice?.supplier?.name || 'Unknown Supplier'} • 
                      {item.invoice?.created_at 
                        ? format(new Date(item.invoice.created_at), 'dd MMM yyyy')
                        : '-'}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline">{item.quantity} units</Badge>
                    <p className="text-sm font-medium mt-1">
                      {item.unit_price.toLocaleString()} EGP/unit
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
