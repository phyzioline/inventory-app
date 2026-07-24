import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Search, Loader2, Package, MapPin, ArrowRight, Filter
} from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onContinue: (selectedItems: any[], sourceLocationId: string) => void;
}

export default function TransferProductSelectorDialog({ open, onOpenChange, onContinue }: Props) {
    const [search, setSearch] = useState('');
    const [sourceLocation, setSourceLocation] = useState<string>('');
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!open) return;
        api.post('/channels/sync-locations', {}).catch(() => null);
    }, [open]);

    const { data: locations, isLoading: loadingLocations } = useQuery({
        queryKey: ['locations'],
        queryFn: () => api.getArray('warehouses'),
    });

    const { data: inventory, isLoading: loadingInventory } = useQuery({
        queryKey: ['inventory-by-location', sourceLocation],
        queryFn: async () => {
            if (!sourceLocation) return [];
            return await api.getArray(`warehouses/${sourceLocation}/inventory?per_page=200`);
        },
        enabled: !!sourceLocation,
    });

    const toggleItem = (id: string) => {
        const newSelected = new Set(selectedItems);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedItems(newSelected);
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked && inventory) {
            const allIds = inventory.map((item: any, idx: number) => String(item.id || idx));
            setSelectedItems(new Set(allIds));
        } else {
            setSelectedItems(new Set());
        }
    };

    const filteredInventory = useMemo(() => {
        const rows = (inventory || []).filter((item: any) => Number(item?.quantity || 0) > 0);
        if (!search) return rows;
        const query = search.toLowerCase();
        return rows.filter((item: any) => {
            const productName =
                item.sku?.offer?.master_product?.internal_name ||
                item.sku?.offer?.masterProduct?.internal_name ||
                item.product_name ||
                item.sku?.name ||
                item.sku?.offer?.name ||
                '';
            return (
                (item.sku?.sku || '').toLowerCase().includes(query) ||
                (item.sku_code || '').toLowerCase().includes(query) ||
                productName.toLowerCase().includes(query)
            );
        });
    }, [inventory, search]);

    const handleContinue = () => {
        const selectedData = (inventory || []).filter((item: any, idx: number) =>
            selectedItems.has(String(item.id || idx))
        );
        onContinue(selectedData, sourceLocation);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Package className="w-5 h-5 text-primary" />
                        Step 1: Select Products to Transfer
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Source Location</label>
                            <Select value={sourceLocation} onValueChange={(val) => {
                                setSourceLocation(val);
                                setSelectedItems(new Set());
                            }}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select Source Location..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {(locations || []).map((loc: any) => (
                                        (loc?.is_active === false ? null : (
                                        <SelectItem key={loc.id} value={String(loc.id)}>
                                            {loc.name} ({loc.type?.replace('_', ' ')})
                                        </SelectItem>
                                        ))
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Search Inventory</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Filter by SKU or Name..."
                                    className="pl-9"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    disabled={!sourceLocation}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="border rounded-lg flex-1 overflow-auto bg-card">
                        <Table>
                            <TableHeader className="sticky top-0 bg-secondary/50 backdrop-blur z-10">
                                <TableRow>
                                    <TableHead className="w-[50px]">
                                        <Checkbox
                                            checked={selectedItems.size === filteredInventory.length && filteredInventory.length > 0}
                                            onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                                            disabled={!sourceLocation || filteredInventory.length === 0}
                                        />
                                    </TableHead>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>Product Name</TableHead>
                                    <TableHead>Available</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loadingInventory ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-40 text-center">
                                            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                                        </TableCell>
                                    </TableRow>
                                ) : !sourceLocation ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
                                            <MapPin className="w-12 h-12 mx-auto mb-2 opacity-20" />
                                            Select a source location to view inventory
                                        </TableCell>
                                    </TableRow>
                                ) : filteredInventory.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
                                            <Package className="w-12 h-12 mx-auto mb-2 opacity-20" />
                                            No products found
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredInventory.map((item: any, idx: number) => {
                                        const id = String(item.id || idx);
                                        const isSelected = selectedItems.has(id);
                                        return (
                                            <TableRow key={id} className={isSelected ? "bg-primary/5" : ""}>
                                                <TableCell>
                                                    <Checkbox
                                                        checked={isSelected}
                                                        onCheckedChange={() => toggleItem(id)}
                                                    />
                                                </TableCell>
                                                <TableCell className="font-mono font-medium">
                                                    {item.sku?.sku || item.sku_code || '—'}
                                                </TableCell>
                                                <TableCell>
                                                    {item.sku?.offer?.master_product?.internal_name || item.sku?.offer?.masterProduct?.internal_name || item.product_name || item.sku?.offer?.name || item.sku?.product?.name || '—'}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="font-mono">
                                                        {item.quantity || 0}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={item.quantity > 0 ? 'secondary' : 'destructive'}>
                                                        {item.quantity > 0 ? 'In Stock' : 'Out of Stock'}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <div className="text-sm text-muted-foreground">
                            {selectedItems.size} products selected
                        </div>
                    </div>
                </div>

                <DialogFooter className="border-t pt-4 mt-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleContinue}
                        disabled={selectedItems.size === 0}
                        className="gap-2"
                    >
                        Next: Configure Transfer
                        <ArrowRight className="w-4 h-4" />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
