import { useState, useMemo, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowRight, Package, AlertTriangle, Search, ChevronsUpDown, Check } from 'lucide-react';
import api from '@/lib/api';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

interface BulkTransferDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onBackToSelection?: () => void;
    selectedItems: any[];
    sourceLocationId?: string;
}

export function BulkTransferDialog({
    isOpen,
    onClose,
    onBackToSelection,
    selectedItems,
    sourceLocationId,
}: BulkTransferDialogProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: warehouses = [] } = useWarehouses();
    const [destinationId, setDestinationId] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [toSkuIds, setToSkuIds] = useState<Record<string, string>>({});
    const [destSkuPickerOpen, setDestSkuPickerOpen] = useState<Record<string, boolean>>({});
    const [notes, setNotes] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        api.post('/channels/sync-locations', {}).catch(() => null);
        queryClient.invalidateQueries({ queryKey: ['warehouses'] });
        setDestinationId('');
        setQuantities({});
        setToSkuIds({});
        setDestSkuPickerOpen({});
    }, [isOpen]);

    // Fetch destination inventory for SKU matching
    const { data: destInventory = [], isLoading: loadingDest } = useQuery({
        queryKey: ['transfer-dest-inventory', destinationId],
        queryFn: () => api.getArray(`warehouses/${destinationId}/inventory?per_page=500`),
        enabled: isOpen && !!destinationId,
    });

    const allDestSkus = useMemo(() => {
        return (destInventory || []).map((item: any) => ({
            sku_id: String(item?.sku?.id || ''),
            sku_code: item?.sku?.sku || '',
            name: item?.sku?.offer?.master_product?.internal_name ||
                item?.sku?.offer?.masterProduct?.internal_name ||
                item?.sku?.name ||
                item?.sku?.offer?.name ||
                '',
            available: Number(item?.quantity || 0),
        })).filter((s: any) => s.sku_id);
    }, [destInventory]);

    // Initialize quantities when items change
    useMemo(() => {
        const initialQuantities: Record<string, number> = {};
        selectedItems.forEach((item, idx) => {
            const id = item.id || idx;
            initialQuantities[id] = item.quantity || 0;
        });
        setQuantities(initialQuantities);
    }, [selectedItems]);

    const handleQuantityChange = (id: string, value: string) => {
        const numValue = parseInt(value) || 0;
        setQuantities(prev => ({ ...prev, [id]: numValue }));
    };

    const handleTransfer = async () => {
        if (!destinationId) {
            toast({
                title: "Error",
                description: "Please select a destination location",
                variant: "destructive",
            });
            return;
        }

        setIsSubmitting(true);
        try {
            // Execute transfers one by one or as a batch if the API supports it
            const transferPromises = selectedItems.map((item, idx) => {
                const id = item.id || idx;
                return api.post('transactions/transfer', {
                    from_location_id: item.location?.id || sourceLocationId,
                    to_location_id: destinationId,
                    sku_id: item.sku?.id || item.sku_id,
                    to_sku_id: toSkuIds[id] || null,
                    quantity: quantities[id] || 0,
                    notes: notes || `Bulk transfer of ${selectedItems.length} items`,
                });
            });

            await Promise.all(transferPromises);

            toast({
                title: "Success",
                description: `Successfully transferred ${selectedItems.length} items`,
            });

            queryClient.invalidateQueries({ queryKey: ['inventory-by-location'] });
            queryClient.invalidateQueries({ queryKey: ['transfers'] });
            onClose();
        } catch (error: any) {
            toast({
                title: "Transfer Failed",
                description: error.message || "An error occurred during bulk transfer",
                variant: "destructive",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const destinationWarehouse = warehouses.find(w => String(w.id) === destinationId);
    const isFBA = destinationWarehouse?.type === 'amazon_fba';

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <Package className="w-5 h-5 text-primary" />
                        Bulk Stock Transfer
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto py-4 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Source Location</Label>
                            <div className="p-2 border rounded-md bg-muted/50 text-sm font-medium">
                                {selectedItems[0]?.location?.name || 'Multiple Locations'}
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Destination Location *</Label>
                            <Select value={destinationId} onValueChange={setDestinationId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select destination" />
                                </SelectTrigger>
                                <SelectContent>
                                    {warehouses
                                        .filter(w => w?.is_active !== false)
                                        .filter(w => String(w.id) !== sourceLocationId)
                                        .map((w) => (
                                            <SelectItem key={w.id} value={String(w.id)}>
                                                {w.name} ({w.type?.replace('_', ' ')})
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {isFBA && (
                        <Alert className="bg-blue-50 border-blue-200">
                            <AlertTriangle className="h-4 w-4 text-blue-600" />
                            <AlertTitle className="text-blue-800">FBA Transfer Mode</AlertTitle>
                            <AlertDescription className="text-blue-700">
                                You are transferring stock to an Amazon FBA warehouse. This will update the FBA virtual inventory and mark these items as "In Transit".
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="border rounded-lg overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>Source SKU</TableHead>
                                    <TableHead>Dest. SKU (Manual Search)</TableHead>
                                    <TableHead className="text-right">Available</TableHead>
                                    <TableHead className="w-[120px]">Transfer Qty</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {selectedItems.map((item, idx) => {
                                    const id = item.id || idx;
                                    const maxQty = item.quantity || 0;
                                    const currentQty = quantities[id] || 0;
                                    const isOverLimit = currentQty > maxQty;

                                    return (
                                        <TableRow key={id}>
                                            <TableCell>
                                                <div className="font-medium text-sm">
                                                    {item.product_name || item.sku?.offer?.name || 'Unknown Product'}
                                                </div>
                                                <div className="text-xs text-muted-foreground font-mono">
                                                    {item.sku?.sku || item.sku_code}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {!destinationId ? (
                                                    <span className="text-xs text-muted-foreground italic">Select destination first</span>
                                                ) : loadingDest ? (
                                                    <Loader2 className="h-4 w-4 animate-spin opacity-50" />
                                                ) : (
                                                    <Popover
                                                        open={!!destSkuPickerOpen[id]}
                                                        onOpenChange={(o) => setDestSkuPickerOpen(prev => ({ ...prev, [id]: o }))}
                                                    >
                                                        <PopoverTrigger asChild>
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className={cn(
                                                                    "w-full justify-between h-auto py-1.5 px-2 text-xs font-normal",
                                                                    toSkuIds[id] ? "border-emerald-500/50 bg-emerald-50 text-emerald-700" : "border-dashed"
                                                                )}
                                                            >
                                                                <span className="truncate">
                                                                    {toSkuIds[id] 
                                                                        ? allDestSkus.find(s => s.sku_id === toSkuIds[id])?.sku_code || toSkuIds[id]
                                                                        : "Search dest. SKU..."
                                                                    }
                                                                </span>
                                                                <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-[300px] p-0" align="start">
                                                            <Command>
                                                                <CommandInput placeholder="Search SKU or name..." />
                                                                <CommandList>
                                                                    <CommandEmpty>No matching SKU found</CommandEmpty>
                                                                    <CommandGroup heading={`${allDestSkus.length} SKUs at destination`}>
                                                                        {allDestSkus.map((dsku: any) => (
                                                                            <CommandItem
                                                                                key={dsku.sku_id}
                                                                                value={`${dsku.sku_code} ${dsku.name}`}
                                                                                onSelect={() => {
                                                                                    setToSkuIds(prev => ({ ...prev, [id]: dsku.sku_id }));
                                                                                    setDestSkuPickerOpen(prev => ({ ...prev, [id]: false }));
                                                                                }}
                                                                                className="flex flex-col items-start py-2"
                                                                            >
                                                                                <div className="flex items-center w-full">
                                                                                    <Check className={cn("mr-2 h-4 w-4", toSkuIds[id] === dsku.sku_id ? "opacity-100" : "opacity-0")} />
                                                                                    <div className="truncate flex-1">
                                                                                        <div className="font-medium text-sm font-mono">{dsku.sku_code}</div>
                                                                                        <div className="text-xs text-muted-foreground truncate">{dsku.name}</div>
                                                                                    </div>
                                                                                    <Badge variant="outline" className="ml-2 text-[10px] font-mono whitespace-nowrap">
                                                                                        {dsku.available}
                                                                                    </Badge>
                                                                                </div>
                                                                            </CommandItem>
                                                                        ))}
                                                                    </CommandGroup>
                                                                </CommandList>
                                                            </Command>
                                                        </PopoverContent>
                                                    </Popover>
                                                )}
                                                {toSkuIds[id] && (
                                                    <p className="text-[10px] text-muted-foreground mt-1 truncate">
                                                        {allDestSkus.find(s => s.sku_id === toSkuIds[id])?.name}
                                                    </p>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-medium">
                                                {maxQty}
                                            </TableCell>
                                            <TableCell>
                                                <Input
                                                    type="number"
                                                    value={currentQty}
                                                    onChange={(e) => handleQuantityChange(String(id), e.target.value)}
                                                    className={`h-8 text-right ${isOverLimit ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                                                    min={0}
                                                    max={maxQty}
                                                />
                                                {isOverLimit && (
                                                    <div className="text-[10px] text-destructive text-right mt-1">
                                                        Exceeds available
                                                    </div>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="space-y-2">
                        <Label>Batch Notes (Optional)</Label>
                        <Input
                            placeholder="e.g., Seasonal replenishment for FBA"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter className="border-t pt-4">
                    <Button
                        variant="secondary"
                        onClick={() => onBackToSelection?.()}
                        disabled={isSubmitting}
                    >
                        Edit Selected Products
                    </Button>
                    <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                        Back
                    </Button>
                    <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleTransfer}
                        disabled={isSubmitting || selectedItems.length === 0 || !destinationId}
                        className="gap-2"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Transferring...
                            </>
                        ) : (
                            <>
                                <ArrowRight className="w-4 h-4" />
                                Execute Transfer
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
