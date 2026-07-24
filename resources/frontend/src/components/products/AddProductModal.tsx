import { useState, useMemo, useRef } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Plus, Trash2, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useCreateProduct } from '@/hooks/useProducts';
import { useCategories, useCreateCategory } from '@/hooks/useCategories';
import { asinService } from '@/lib/supabase-services';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MarketSelect } from '@/components/shared/MarketSelect';

interface AddProductModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function AddProductModal({ isOpen, onClose, onSuccess }: AddProductModalProps) {
    const { t } = useLanguage();
    const [isLoading, setIsLoading] = useState(false);
    const [newCategory, setNewCategory] = useState('');
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const createProduct = useCreateProduct();
    const { data: categories } = useCategories();
    const createCategory = useCreateCategory();

    const productSchema = useMemo(() => z.object({
        name: z.string().min(2, t('validation.nameMin')),
        category_id: z.string().optional(),
        selling_price: z.coerce.number().min(0, t('validation.pricePositive')),
        last_purchase_price: z.coerce.number().min(0, t('validation.costPositive')),
        min_stock: z.coerce.number().int().min(0, t('validation.stockPositive')),
        max_stock: z.coerce.number().int().min(0, t('validation.stockPositive')).optional(),
        asins: z.array(z.object({
            value: z.string().min(10, t('validation.asinLength')).max(10, t('validation.asinLength')).regex(/^[A-Z0-9]{10}$/, t('validation.asinFormat')),
            marketplace: z.string().optional()
        })).optional()
    }), [t]);

    type ProductFormValues = z.infer<typeof productSchema>;

    const form = useForm<ProductFormValues>({
        resolver: zodResolver(productSchema),
        defaultValues: {
            name: '',
            category_id: '',
            selling_price: 0,
            last_purchase_price: 0,
            min_stock: 0,
            max_stock: 0,
            asins: []
        }
    });

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "asins"
    });

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setImageFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const removeImage = () => {
        setImageFile(null);
        setImagePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const onSubmit = async (data: ProductFormValues) => {
        setIsLoading(true);
        try {
            let imageUrls: string[] = [];

            // Upload image if selected
            if (imageFile) {
                const fileExt = imageFile.name.split('.').pop();
                const fileName = `${Date.now()}.${fileExt}`;

                const { error: uploadError } = await supabase.storage
                    .from('product-images')
                    .upload(fileName, imageFile);

                if (uploadError) throw uploadError;

                const { data: { publicUrl } } = supabase.storage
                    .from('product-images')
                    .getPublicUrl(fileName);

                imageUrls = [publicUrl];
            }

            const product = await createProduct.mutateAsync({
                name: data.name,
                category_id: data.category_id || null,
                selling_price: data.selling_price,
                last_purchase_price: data.last_purchase_price,
                avg_purchase_price: data.last_purchase_price,
                min_stock: data.min_stock,
                max_stock: data.max_stock || null,
                lowest_price: null,
                highest_price: null,
                images: imageUrls,
            });

            // Create ASINs if any
            if (data.asins && data.asins.length > 0) {
                for (const asin of data.asins) {
                    await asinService.create({
                        product_id: product.id,
                        asin_code: asin.value,
                        marketplace: asin.marketplace || null,
                    });
                }
            }

            form.reset();
            setImageFile(null);
            setImagePreview(null);
            onSuccess();
            onClose();
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || t('common.error'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateCategory = async () => {
        if (!newCategory.trim()) return;
        try {
            const category = await createCategory.mutateAsync({ name: newCategory });
            form.setValue('category_id', category.id);
            setNewCategory('');
        } catch (error) {
            console.error(error);
        }
    };

    const handleClose = () => {
        form.reset();
        setImageFile(null);
        setImagePreview(null);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('products.addNew')}</DialogTitle>
                    <DialogDescription>
                        {t('products.createDesc')}
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        {/* Image Upload Section */}
                        <div className="space-y-2">
                            <FormLabel>Product Image</FormLabel>
                            <div className="flex items-start gap-4">
                                {imagePreview ? (
                                    <div className="relative w-24 h-24">
                                        <img
                                            src={imagePreview}
                                            alt="Preview"
                                            className="w-full h-full object-cover rounded-lg border border-border"
                                        />
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="icon"
                                            className="absolute -top-2 -right-2 h-6 w-6"
                                            onClick={removeImage}
                                        >
                                            <X className="w-3 h-3" />
                                        </Button>
                                    </div>
                                ) : (
                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-24 h-24 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors"
                                    >
                                        <Upload className="w-6 h-6 text-muted-foreground mb-1" />
                                        <span className="text-xs text-muted-foreground">Upload</span>
                                    </div>
                                )}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageChange}
                                    className="hidden"
                                />
                                <p className="text-xs text-muted-foreground pt-2">
                                    Upload a product image (optional). You can add more images later.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem className="col-span-2">
                                        <FormLabel>{t('products.name')}</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Product Name" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="category_id"
                                render={({ field }) => (
                                    <FormItem className="col-span-2">
                                        <FormLabel>{t('products.category')}</FormLabel>
                                        <div className="flex gap-2">
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select category" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {categories?.map((cat) => (
                                                        <SelectItem key={cat.id} value={cat.id}>
                                                            {cat.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="flex gap-2 mt-2">
                                            <Input
                                                placeholder="New category name"
                                                value={newCategory}
                                                onChange={(e) => setNewCategory(e.target.value)}
                                            />
                                            <Button type="button" variant="outline" onClick={handleCreateCategory}>
                                                <Plus className="w-4 h-4" />
                                            </Button>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="selling_price"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('products.price')}</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="last_purchase_price"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('products.cost')}</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="min_stock"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('products.minStock') || 'Min Stock'}</FormLabel>
                                        <FormControl>
                                            <Input type="number" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="max_stock"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('products.maxStock') || 'Max Stock'}</FormLabel>
                                        <FormControl>
                                            <Input type="number" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <FormLabel className="text-base">{t('products.asinManagement')}</FormLabel>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => append({ value: '', marketplace: '' })}
                                    className="gap-2"
                                >
                                    <Plus className="w-4 h-4" />
                                    {t('products.addAsin')}
                                </Button>
                            </div>

                            <div className="space-y-3">
                                {fields.map((field, index) => (
                                    <div key={field.id} className="flex gap-2 items-start">
                                        <FormField
                                            control={form.control}
                                            name={`asins.${index}.value`}
                                            render={({ field }) => (
                                                <FormItem className="flex-1">
                                                    <FormControl>
                                                        <Input placeholder="B0..." maxLength={10} {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name={`asins.${index}.marketplace`}
                                            render={({ field }) => (
                                                <FormItem className="w-36">
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
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive hover:text-destructive/90"
                                            onClick={() => remove(index)}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
                                {t('common.cancel')}
                            </Button>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {t('products.create')}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
