import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { Search } from 'lucide-react';

interface ViewInventoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: {
    name: string;
    items: number;
  } | null;
}

const mockInventory = [
  { id: 1, name: 'Product A', sku: 'SKU-001', quantity: 150, minStock: 50, status: 'in-stock' },
  { id: 2, name: 'Product B', sku: 'SKU-002', quantity: 30, minStock: 40, status: 'low-stock' },
  { id: 3, name: 'Product C', sku: 'SKU-003', quantity: 200, minStock: 60, status: 'in-stock' },
  { id: 4, name: 'Product D', sku: 'SKU-004', quantity: 0, minStock: 20, status: 'out-of-stock' },
  { id: 5, name: 'Product E', sku: 'SKU-005', quantity: 85, minStock: 30, status: 'in-stock' },
];

export function ViewInventoryDialog({ open, onOpenChange, warehouse }: ViewInventoryDialogProps) {
  const [search, setSearch] = useState('');

  const filteredInventory = mockInventory.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase()) ||
    item.sku.toLowerCase().includes(search.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'in-stock':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">In Stock</Badge>;
      case 'low-stock':
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Low Stock</Badge>;
      case 'out-of-stock':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Out of Stock</Badge>;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">{warehouse?.name} - Inventory</DialogTitle>
        </DialogHeader>
        
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Min Stock</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInventory.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{item.minStock}</TableCell>
                  <TableCell>{getStatusBadge(item.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
