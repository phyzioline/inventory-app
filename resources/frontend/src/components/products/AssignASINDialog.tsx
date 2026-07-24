import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Plus, Trash2, Tag, Loader2 } from 'lucide-react';
import { useASINsByProduct, useCreateASIN, useDeleteASIN } from '@/hooks/useASINs';
import { Product } from '@/lib/supabase-services';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Badge } from '@/components/ui/badge';
import { MarketSelect } from '@/components/shared/MarketSelect';

const schema = z.object({
  asin_code: z.string().length(10, 'ASIN must be 10 characters').regex(/^[A-Z0-9]{10}$/, 'Invalid ASIN format'),
  marketplace: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface AssignASINDialogProps {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
}

export function AssignASINDialog({ product, isOpen, onClose }: AssignASINDialogProps) {
  const { data: asins, isLoading } = useASINsByProduct(product.id);
  const createASIN = useCreateASIN();
  const deleteASIN = useDeleteASIN();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      asin_code: '',
      marketplace: '',
    },
  });

  const onSubmit = async (data: FormValues) => {
    await createASIN.mutateAsync({
      product_id: product.id,
      asin_code: data.asin_code.toUpperCase(),
      marketplace: data.marketplace || null,
    });
    form.reset();
  };

  const handleDelete = async (id: string) => {
    await deleteASIN.mutateAsync(id);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5" />
            Manage ASINs
          </DialogTitle>
          <DialogDescription>
            {product.name} ({product.sku})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Existing ASINs */}
          <div className="space-y-2">
            {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
            {asins && asins.length === 0 && (
              <p className="text-sm text-muted-foreground">No ASINs assigned yet</p>
            )}
            {asins && asins.map((asin) => (
              <div 
                key={asin.id} 
                className="flex items-center justify-between p-2 rounded-lg border border-border"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono">
                    {asin.asin_code}
                  </Badge>
                  {asin.marketplace && (
                    <span className="text-xs text-muted-foreground">
                      {asin.marketplace}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(asin.id)}
                  disabled={deleteASIN.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Add new ASIN */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-2">
              <FormField
                control={form.control}
                name="asin_code"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input 
                        placeholder="B0XXXXXXXXX" 
                        maxLength={10}
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="marketplace"
                render={({ field }) => (
                  <FormItem className="w-32">
                    <FormControl>
                      <MarketSelect
                        value={field.value || ''}
                        onValueChange={field.onChange}
                        placeholder="Market"
                        className="w-full"
                        showManage={false}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button type="submit" size="icon" disabled={createASIN.isPending}>
                {createASIN.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
