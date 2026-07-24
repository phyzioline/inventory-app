import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useWarehouses, useCreateWarehouse } from '@/hooks/useWarehouses';
import {
  Warehouse,
  Package,
  ArrowRightLeft,
  AlertTriangle,
  TrendingUp,
  MoreVertical,
  Eye,
  Plus,
  Minus,
  ClipboardList,
  Settings,
  Loader2,
  AlertCircle,
  Globe,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import TransferModal from '@/components/inventory/TransferModal';
import api from '@/lib/api';

export default function WarehousesPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>(undefined);
  const [renameWarehouse, setRenameWarehouse] = useState<{ id: number; name: string } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  const { data: warehouses, isLoading, error, refetch } = useWarehouses();
  const createWarehouse = useCreateWarehouse();

  // Group warehouses by type (handle both 'shop' and 'store' type values)
  const warehouseGroups = [
    {
      title: 'المتجر الرئيسي',
      type: 'physical' as const,
      stores: warehouses?.filter(w => w.type === 'physical' || w.type === 'shop' || w.type === 'store') || [],
    },
    {
      title: 'قنوات البيع',
      type: 'channel' as const,
      stores: warehouses?.filter(w => w.type === 'channel' || w.type === 'amazon_fba' || w.type === 'marketplace') || [],
    },
  ];

  // Calculate stats (wallet balance moved to Finance module)
  const stats = {
    totalWarehouses: warehouses?.length || 0,
    physicalCount: warehouses?.filter(w => w.type === 'physical' || w.type === 'shop' || w.type === 'store').length || 0,
    channelCount: warehouses?.filter(w => w.type === 'channel' || w.type === 'amazon_fba' || w.type === 'marketplace').length || 0,
    mainWarehouse: warehouses?.find(w => w.is_main)?.name || 'None',
  };

  const getWarehouseTypeColor = (type: string) => {
    switch (type) {
      case 'physical':
      case 'shop':
      case 'store':
        return { bg: 'bg-primary/10 group-hover:bg-primary/20', text: 'text-primary' };
      case 'channel':
      case 'amazon_fba':
      case 'marketplace':
        return { bg: 'bg-warning/10 group-hover:bg-warning/20', text: 'text-warning' };
      default:
        return { bg: 'bg-secondary/10', text: 'text-secondary' };
    }
  };

  const handleAddWarehouse = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    createWarehouse.mutate({
      name: formData.get('name') as string,
      type: formData.get('type') as 'physical' | 'channel',
      is_main: formData.get('is_main') === 'on',
      wallet_balance: 0,
    }, {
      onSuccess: () => setIsAddDialogOpen(false),
    });
  };

  const openTransfer = (sourceId?: string) => {
    setSelectedSourceId(sourceId);
    setIsTransferModalOpen(true);
  };

  const openRename = (warehouse: { id: number; name: string }) => {
    setRenameWarehouse(warehouse);
    setRenameName(warehouse.name);
  };

  const handleRename = async () => {
    if (!renameWarehouse || !renameName.trim()) return;
    setIsRenaming(true);
    try {
      await api.put(`warehouses/${renameWarehouse.id}`, { name: renameName.trim() });
      toast.success('Warehouse renamed successfully!');
      setRenameWarehouse(null);
      refetch();
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to rename warehouse');
    } finally {
      setIsRenaming(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading warehouses...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t('warehouses.title')}</h1>
            <p className="text-muted-foreground">Monitor and manage all warehouse locations</p>
          </div>
        </div>

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>
            Unable to load warehouse data. Please ensure you're logged in and try again.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        defaultSourceId={selectedSourceId}
      />

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('warehouses.title')}</h1>
          <p className="text-muted-foreground">Monitor and manage all warehouse locations</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => openTransfer()}>
            <ArrowRightLeft className="w-4 h-4" />
            {t('warehouses.transfer')}
          </Button>
          <Button className="gap-2" onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="w-4 h-4" />
            Add Warehouse
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-primary/10">
              <Warehouse className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Warehouses</p>
              <p className="text-2xl font-bold">{stats.totalWarehouses}</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-warning/10">
              <Warehouse className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Physical Warehouses</p>
              <p className="text-2xl font-bold">{stats.physicalCount}</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-success/10">
              <Globe className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Channel Locations</p>
              <p className="text-2xl font-bold">{stats.channelCount}</p>
            </div>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="stat-card"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-info/10">
              <Package className="w-5 h-5 text-info" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Main Warehouse</p>
              <p className="text-2xl font-bold">{stats.mainWarehouse}</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* No Warehouses Message */}
      {warehouses && warehouses.length === 0 && (
        <Alert>
          <Package className="h-4 w-4" />
          <AlertTitle>No Warehouses Found</AlertTitle>
          <AlertDescription>
            <p className="mb-2">You haven't added any warehouses yet. Click "Add Warehouse" to get started.</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Warehouse Groups */}
      {warehouseGroups.map((group, groupIndex) => {
        if (group.stores.length === 0) return null;

        return (
          <motion.div
            key={group.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + groupIndex * 0.1 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{group.title}</h2>
              <span className="badge-status badge-info">{group.stores.length}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {group.stores.map((warehouse, index) => {
                const typeColors = getWarehouseTypeColor(warehouse.type);

                return (
                  <motion.div
                    key={warehouse.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4 + groupIndex * 0.1 + index * 0.03 }}
                    className="glass-card rounded-xl p-5 hover:border-primary/30 transition-all group cursor-pointer"
                    onClick={() => navigate(`/stores/${warehouse.id}`)}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={cn('p-2 rounded-lg transition-colors', typeColors.bg)}>
                          <Warehouse className={cn('w-4 h-4', typeColors.text)} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-sm">{warehouse.name}</h3>
                            {warehouse.is_main && (
                              <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">Main</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground capitalize">
                            {warehouse.type.replace('_', ' ')}
                          </p>
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 bg-popover border-border">
                          <DropdownMenuLabel>Manage Inventory</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/stores/${warehouse.id}`);
                          }}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Inventory
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            toast.info('Please use "Purchase" to add stock officially, or "Adjustment" via transactions.');
                          }}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Stock
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            openTransfer(String(warehouse.id));
                          }}>
                            <ArrowRightLeft className="mr-2 h-4 w-4" />
                            Transfer Stock
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            openRename({ id: warehouse.id, name: warehouse.name });
                          }}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            toast.info('Stock logs feature coming soon');
                          }}>
                            <ClipboardList className="mr-2 h-4 w-4" />
                            Stock Logs
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-border/50">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Status</span>
                        <span className={cn(
                          'font-medium text-xs px-2 py-0.5 rounded-full',
                          warehouse.is_active !== false ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
                        )}>
                          {warehouse.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {warehouse.address && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Location</span>
                          <span className="font-medium text-xs truncate max-w-[120px]">{warehouse.address}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        );
      })}

      {/* Rename Warehouse Dialog */}
      <Dialog open={!!renameWarehouse} onOpenChange={(open) => !open && setRenameWarehouse(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Warehouse</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>New Name</Label>
              <Input
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                placeholder="e.g., Main Store, Amazon FBA"
                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameWarehouse(null)}>Cancel</Button>
            <Button onClick={handleRename} disabled={isRenaming || !renameName.trim()}>
              {isRenaming ? 'Saving...' : 'Save Name'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Warehouse Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Warehouse</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddWarehouse} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Warehouse Name</Label>
              <Input id="name" name="name" placeholder="e.g., Shop, Phyzio, Art" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select name="type" defaultValue="channel">
                <SelectTrigger>
                  <SelectValue placeholder="اختر النوع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="physical">مستودع رئيسي</SelectItem>
                  <SelectItem value="channel">قناة بيع</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="is_main" name="is_main" />
              <Label htmlFor="is_main">Set as main warehouse</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createWarehouse.isPending}>
                {createWarehouse.isPending ? 'Creating...' : 'Create Warehouse'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
