import { useState } from 'react';
import { MoreHorizontal, Edit, Trash2, Eye, History, Tag, ImagePlus } from 'lucide-react';
import { Product } from '@/lib/supabase-services';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EditProductDialog } from './EditProductDialog';
import { PurchaseHistoryDialog } from './PurchaseHistoryDialog';
import { AssignASINDialog } from './AssignASINDialog';
import { ProductImagesDialog } from './ProductImagesDialog';

interface ProductActionsMenuProps {
  product: Product;
  onDelete: (id: string) => void;
}

export function ProductActionsMenu({ product, onDelete }: ProductActionsMenuProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [asinOpen, setAsinOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setEditOpen(true)} className="gap-2">
            <Edit className="w-4 h-4" />
            Edit Product
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setImagesOpen(true)} className="gap-2">
            <ImagePlus className="w-4 h-4" />
            Manage Images
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setHistoryOpen(true)} className="gap-2">
            <History className="w-4 h-4" />
            Purchase History
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setAsinOpen(true)} className="gap-2">
            <Tag className="w-4 h-4" />
            Assign ASIN
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            onClick={() => onDelete(product.id)} 
            className="gap-2 text-destructive focus:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditProductDialog 
        product={product}
        isOpen={editOpen} 
        onClose={() => setEditOpen(false)} 
      />
      <PurchaseHistoryDialog 
        product={product}
        isOpen={historyOpen} 
        onClose={() => setHistoryOpen(false)} 
      />
      <AssignASINDialog 
        product={product}
        isOpen={asinOpen} 
        onClose={() => setAsinOpen(false)} 
      />
      <ProductImagesDialog 
        product={product}
        isOpen={imagesOpen} 
        onClose={() => setImagesOpen(false)} 
      />
    </>
  );
}
