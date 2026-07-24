import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle, MoreHorizontal, Package } from 'lucide-react';
import { getPhysicalStatus, isFbaReturn } from '@/components/returns/returnDisplayUtils';

type ReturnRow = Record<string, unknown> & { id: string | number; sku_code?: string | null };

type Props = {
  rows: ReturnRow[];
  isAr: boolean;
  t: (key: string) => string;
  onStatusChange: (id: string, status: 'received' | 'lost' | 'restocked') => void;
};

function isActionableRow(row: ReturnRow): boolean {
  const ps = getPhysicalStatus(row);
  return ps === 'pending' || ps === 'in_transit';
}

function lineLabel(row: ReturnRow, isAr: boolean): string {
  const sku = String(row.sku_code || '').trim();
  if (sku) {
    return sku;
  }
  const id = String(row.id);
  return isAr ? `حركة #${id}` : `Line #${id}`;
}

function ReturnLineActions({
  row,
  isAr,
  t,
  onStatusChange,
}: {
  row: ReturnRow;
  isAr: boolean;
  t: (key: string) => string;
  onStatusChange: Props['onStatusChange'];
}) {
  return (
    <>
      <DropdownMenuItem onClick={() => onStatusChange(String(row.id), 'received')}>
        <Package className="w-4 h-4 mr-2" />
        {t('returns.actions.markReceived') || 'Mark Received'}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => onStatusChange(String(row.id), 'lost')}>
        <AlertTriangle className="w-4 h-4 mr-2" />
        {t('returns.actions.markLost') || 'Mark Lost'}
      </DropdownMenuItem>
      {isFbaReturn(row) ? (
        <DropdownMenuItem onClick={() => onStatusChange(String(row.id), 'restocked')}>
          <CheckCircle className="w-4 h-4 mr-2" />
          {t('returns.actions.markRestockedFba') || 'Restocked to FBA'}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

export function ReturnGroupActionsMenu({ rows, isAr, t, onStatusChange }: Props) {
  const actionable = rows.filter(isActionableRow);

  if (!actionable.length) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }

  if (actionable.length === 1) {
    const row = actionable[0];
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-8 w-8"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-popover border-border text-popover-foreground">
          <ReturnLineActions row={row} isAr={isAr} t={t} onStatusChange={onStatusChange} />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground h-8 w-8"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border text-popover-foreground">
        {actionable.map((row) => (
          <DropdownMenuSub key={String(row.id)}>
            <DropdownMenuSubTrigger className="font-mono text-xs">
              {lineLabel(row, isAr)}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="bg-popover border-border text-popover-foreground">
              <ReturnLineActions row={row} isAr={isAr} t={t} onStatusChange={onStatusChange} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
