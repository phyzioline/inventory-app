import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { productService, offerService } from "@/lib/supabase-services";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Loader2, Plus, Box, ShoppingBag, Barcode, ArrowLeft, Trash2, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AddSKUDialog from "@/components/inventory/AddSKUDialog";

export default function MasterProductDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [isOfferDialogOpen, setIsOfferDialogOpen] = useState(false);
    const [isSkuDialogOpen, setIsSkuDialogOpen] = useState(false);
    const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);

    // Initial state for forms
    const [offerForm, setOfferForm] = useState({ name: "", type: "single", description: "" });

    const { data: masterProducts = [], isLoading: masterProductsLoading } = useQuery({
        queryKey: ["master-products"],
        queryFn: () => productService.getAll(),
    });

    const resolvedFromList = useMemo(() => {
        const routeId = String(id || "");
        if (!routeId || masterProducts.length === 0) return null;

        const byMasterId = masterProducts.find((p: any) => String(p.id) === routeId);
        if (byMasterId) return byMasterId;

        const bySupplierSku = masterProducts.find((p: any) => String(p.original_supplier_sku || "") === routeId);
        if (bySupplierSku) return bySupplierSku;

        const byOfferOrSku = masterProducts.find((p: any) =>
            (p.offers || []).some((offer: any) =>
                String(offer?.id || "") === routeId ||
                (offer?.skus || []).some((sku: any) =>
                    String(sku?.id || "") === routeId || String(sku?.sku || "") === routeId
                )
            )
        );

        return byOfferOrSku || null;
    }, [id, masterProducts]);

    const resolvedMasterId = resolvedFromList?.id ? String(resolvedFromList.id) : String(id || "");

    const { data: productById, isLoading: productLoading } = useQuery({
        queryKey: ["master-product", resolvedMasterId],
        queryFn: () => productService.getById(resolvedMasterId),
        enabled: !!resolvedMasterId,
        retry: 0,
    });

    const product: any = productById || resolvedFromList;
    const offers: any[] = product?.offers || [];

    useEffect(() => {
        if (!id || !resolvedFromList?.id) return;
        const normalizedCurrent = String(id);
        const normalizedResolved = String(resolvedFromList.id);
        if (normalizedCurrent !== normalizedResolved) {
            navigate(`/master-products/${normalizedResolved}`, { replace: true });
        }
    }, [id, resolvedFromList?.id, navigate]);

    // Create Offer Mutation
    const createOffer = useMutation({
        mutationFn: async (data: any) => {
            await offerService.create({ ...data, master_product_id: resolvedMasterId });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["offers", resolvedMasterId] });
            queryClient.invalidateQueries({ queryKey: ["master-product", resolvedMasterId] });
            queryClient.invalidateQueries({ queryKey: ["master-products"] });
            setIsOfferDialogOpen(false);
            toast({ title: "Success", description: "Offer created successfully" });
        },
    });

    // Create SKU Mutation (No longer needed here as AddSKUDialog handles its own mutation)

    if (productLoading || masterProductsLoading) {
        return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8" /></div>;
    }

    if (!product) return <div>Product not found</div>;

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => navigate("/master-products")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Box className="h-6 w-6 text-primary" />
                        {product.name}
                    </h1>
                    <p className="text-muted-foreground flex items-center gap-2">
                        SKU: <Badge variant="outline">{product.sku}</Badge> • Category: {product.category?.name || 'N/A'}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Left Column: Product Info */}
                <Card className="h-fit">
                    <CardHeader>
                        <CardTitle>Product Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Original Supplier</span>
                            <p>{(product as any).original_supplier || 'N/A'}</p>
                        </div>
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Supplier SKU</span>
                            <p>{(product as any).original_supplier_sku || 'N/A'}</p>
                        </div>
                        <Separator />
                        <div>
                            <span className="text-sm font-medium text-muted-foreground">Statistics</span>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                <div className="bg-muted p-2 rounded">
                                    <span className="text-xs">Inv. Offers</span>
                                    <p className="font-bold text-lg">{offers?.length || 0}</p>
                                </div>
                                <div className="bg-muted p-2 rounded">
                                    <span className="text-xs">Total SKUs</span>
                                    <p className="font-bold text-lg">
                                        {offers?.reduce((acc: number, o: any) => acc + (o.skus?.length || 0), 0) || 0}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Right Column: Offers & SKUs Hierarchy */}
                <div className="md:col-span-2 space-y-4">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-semibold">Inventory Offers</h2>
                        <Dialog open={isOfferDialogOpen} onOpenChange={setIsOfferDialogOpen}>
                            <DialogTrigger asChild>
                                <Button>
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add Offer
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Create New Offer</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Offer Name</Label>
                                        <Input
                                            placeholder="e.g. Single Pack, Bundle of 2"
                                            value={offerForm.name}
                                            onChange={e => setOfferForm({ ...offerForm, name: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Type</Label>
                                        <Select
                                            value={offerForm.type}
                                            onValueChange={v => setOfferForm({ ...offerForm, type: v })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="single">Single Unit</SelectItem>
                                                <SelectItem value="bundle">Bundle</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Button onClick={() => createOffer.mutate(offerForm)} className="w-full">
                                        Create Offer
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <ScrollArea className="h-[600px] pr-4">
                        <div className="space-y-4">
                            {offers?.map((offer: any) => (
                                <Card key={offer.id} className="overflow-hidden border-l-4 border-l-blue-500">
                                    <CardHeader className="bg-muted/30 pb-3">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <CardTitle className="text-lg flex items-center gap-2">
                                                    <ShoppingBag className="h-5 w-5 text-blue-500" />
                                                    {offer.name}
                                                </CardTitle>
                                                <div className="text-sm text-muted-foreground mt-1 flex gap-2">
                                                    <Badge variant="secondary">{offer.type}</Badge>
                                                    {offer.components && <Badge variant="outline">Has Components</Badge>}
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setSelectedOfferId(offer.id);
                                                    setIsSkuDialogOpen(true);
                                                }}
                                            >
                                                <Plus className="mr-2 h-3 w-3" />
                                                Add SKU
                                            </Button>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="mt-4">
                                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                            <Barcode className="h-4 w-4" />
                                            Associated SKUs ({offer.skus?.length || 0})
                                        </h4>
                                        {offer.skus && offer.skus.length > 0 ? (
                                            <div className="grid gap-3">
                                                {offer.skus.map((sku: any) => (
                                                    <div key={sku.id} className="flex items-center justify-between p-3 bg-card border rounded-lg shadow-sm">
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-8 w-8 bg-green-100 dark:bg-green-900 rounded flex items-center justify-center text-green-700 dark:text-green-300 font-bold text-xs ring-1 ring-green-200">
                                                                SKU
                                                            </div>
                                                            <div>
                                                                <p className="font-mono font-medium">{sku.sku}</p>
                                                                <p className="text-xs text-muted-foreground">
                                                                    Price: {Number(sku.selling_price).toFixed(2)} EGP
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <Badge variant={sku.channel_id ? "default" : "outline"}>
                                                            {sku.channel_id ? "Channel Assigned" : "General"}
                                                        </Badge>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center py-4 bg-muted/20 rounded-lg text-sm text-muted-foreground">
                                                No SKUs assigned to this offer yet.
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}

                            {offers?.length === 0 && (
                                <div className="text-center py-12 border-2 border-dashed rounded-xl">
                                    <ShoppingBag className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                                    <h3 className="font-semibold text-lg">No Inventory Offers</h3>
                                    <p className="text-muted-foreground mb-4">Create an offer (e.g. Single, Pack of 2) to start adding SKUs.</p>
                                    <Button onClick={() => setIsOfferDialogOpen(true)}>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Create First Offer
                                    </Button>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>
            </div>

            {/* SKU Dialog */}
            <AddSKUDialog
                open={isSkuDialogOpen}
                onOpenChange={setIsSkuDialogOpen}
                offerId={selectedOfferId || undefined}
            />
        </div>
    );
}
