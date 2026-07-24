import { useState } from 'react';
import { useMarkets, useCreateMarket, useDeleteMarket } from '@/hooks/useMarkets';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Loader2, Settings } from 'lucide-react';

interface MarketSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  showManage?: boolean;
}

export function MarketSelect({ 
  value, 
  onValueChange, 
  placeholder = 'Select market',
  className,
  showManage = true,
}: MarketSelectProps) {
  const { data: markets, isLoading } = useMarkets();
  const createMarket = useCreateMarket();
  const deleteMarket = useDeleteMarket();
  const [newCode, setNewCode] = useState('');
  const [manageOpen, setManageOpen] = useState(false);

  const handleAddMarket = async () => {
    if (!newCode.trim()) return;
    await createMarket.mutateAsync({ code: newCode.toUpperCase().trim() });
    setNewCode('');
  };

  const handleDeleteMarket = async (id: string) => {
    await deleteMarket.mutateAsync(id);
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-10 ${className}`}>
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="bg-popover border border-border shadow-lg z-50">
          {(!markets || markets.length === 0) && (
            <div className="p-2 text-sm text-muted-foreground text-center">
              No markets added yet
            </div>
          )}
          {markets?.map((market) => (
            <SelectItem key={market.id} value={market.code}>
              {market.code}{market.name ? ` - ${market.name}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showManage && (
        <Popover open={manageOpen} onOpenChange={setManageOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <Settings className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 bg-popover border border-border shadow-lg z-50" align="end">
            <div className="space-y-3">
              <p className="text-sm font-medium">Manage Markets</p>
              
              {/* Add new market */}
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. US, UK, AE"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  className="flex-1"
                  maxLength={10}
                />
                <Button 
                  size="icon" 
                  onClick={handleAddMarket} 
                  disabled={!newCode.trim() || createMarket.isPending}
                >
                  {createMarket.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                </Button>
              </div>

              {/* List of markets */}
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {markets?.map((market) => (
                  <div 
                    key={market.id} 
                    className="flex items-center justify-between p-2 rounded-md bg-secondary/30 hover:bg-secondary/50"
                  >
                    <span className="text-sm font-medium">{market.code}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteMarket(market.id)}
                      disabled={deleteMarket.isPending}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                {(!markets || markets.length === 0) && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Add your first market above
                  </p>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
