import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useProducts } from '@/hooks/useProducts';
import { useWarehouseInventory } from '@/hooks/useInventory';
import { internalTransferService } from '@/lib/supabase-services';
import { useQueryClient } from '@tanstack/react-query';

interface TransferStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: {
    name: string;
    id: string;
  } | null;
}

export function TransferStockDialog({ open, onOpenChange, warehouse }: TransferStockDialogProps) {
  const [selectedProduct, setSelectedProduct] = useState('');
  const [targetWarehouse, setTargetWarehouse] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const { data: warehouses } = useWarehouses();
  const { data: products } = useProducts();
  const { data: inventory } = useWarehouseInventory(warehouse?.id || '');

  const availableWarehouses = warehouses?.filter(w => w.id !== warehouse?.id) || [];

  const getAvailableQty = (productId: string) => {
    const inv = inventory?.find((i: any) => i.product_id === productId);
    return inv?.quantity || 0;
  };

  const handleSubmit = async () => {
    if (!selectedProduct || !targetWarehouse || !quantity || !warehouse) {
      toast.error('Please fill all required fields');
      return;
    }

    const qty = parseInt(quantity);
    const available = getAvailableQty(selectedProduct);
    if (qty > available) {
      toast.error(`Only ${available} units available`);
      return;
    }

    setIsSubmitting(true);
    try {
      await internalTransferService.create({
        from_warehouse_id: warehouse.id,
        to_warehouse_id: targetWarehouse,
        product_id: selectedProduct,
        quantity: qty,
        notes: notes || undefined,
      });
      toast.success('Stock transferred successfully');
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      setSelectedProduct('');
      setTargetWarehouse('');
      setQuantity('');
      setNotes('');
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || 'Transfer failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get products that exist in this warehouse's inventory
  const warehouseProducts = inventory?.map((item: any) => ({
    id: item.product_id,
    name: item.product?.name || 'Unknown',
    sku: item.product?.sku || '',
    available: item.quantity || 0,
  })).filter((p: any) => p.available > 0) || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer Stock from {warehouse?.name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Product *</Label>
            <Select value={selectedProduct} onValueChange={setSelectedProduct}>
              <SelectTrigger>
                <SelectValue placeholder="Select product" />
              </SelectTrigger>
              <SelectContent>
                {warehouseProducts.map((product: any) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} - Available: {product.available}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 p-3 rounded-lg bg-muted/50 text-center">
              <p className="text-xs text-muted-foreground">From</p>
              <p className="font-medium text-sm">{warehouse?.name}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <Select value={targetWarehouse} onValueChange={setTargetWarehouse}>
                <SelectTrigger>
                  <SelectValue placeholder="Select destination" />
                </SelectTrigger>
                <SelectContent>
                  {availableWarehouses.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Quantity *</Label>
            <Input
              type="number"
              min="1"
              max={selectedProduct ? getAvailableQty(selectedProduct) : 999}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Enter quantity"
            />
            {selectedProduct && (
              <p className="text-xs text-muted-foreground">
                Available: {getAvailableQty(selectedProduct)} units
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional transfer notes"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
