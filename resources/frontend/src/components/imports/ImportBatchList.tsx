import React from 'react';
import { format } from 'date-fns';
import { FileSpreadsheet, CheckCircle, Clock, XCircle, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ImportBatch } from '@/hooks/useAmazonImport';
import { cn } from '@/lib/utils';

interface ImportBatchListProps {
  batches: ImportBatch[];
  currentBatchId: string | null;
  onSelectBatch: (batchId: string) => void;
  onRollback: (batchId: string) => void;
  isRollingBack?: boolean;
}

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  validated: <CheckCircle className="h-4 w-4 text-blue-500" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  rolled_back: <RotateCcw className="h-4 w-4 text-yellow-500" />,
  error: <XCircle className="h-4 w-4 text-destructive" />
};

const statusColors: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  validated: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  rolled_back: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  error: 'bg-destructive text-destructive-foreground'
};

export function ImportBatchList({ 
  batches, 
  currentBatchId, 
  onSelectBatch, 
  onRollback,
  isRollingBack 
}: ImportBatchListProps) {
  if (batches.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Imports</CardTitle>
          <CardDescription>No import batches yet</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent Import Batches</CardTitle>
        <CardDescription>Click to view transactions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 p-2">
        {batches.map((batch) => (
          <div
            key={batch.id}
            className={cn(
              "p-3 rounded-lg border cursor-pointer transition-colors hover:bg-muted/50",
              currentBatchId === batch.id && "border-primary bg-muted/30"
            )}
            onClick={() => onSelectBatch(batch.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <FileSpreadsheet className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {batch.file_name || 'Unknown file'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(batch.created_at), 'MMM d, yyyy HH:mm')}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {statusIcons[batch.status || 'pending']}
                <Badge className={cn("text-xs", statusColors[batch.status || 'pending'])}>
                  {batch.status}
                </Badge>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span>Total: {batch.records_total}</span>
              {batch.records_success > 0 && (
                <span className="text-green-600">✓ {batch.records_success}</span>
              )}
              {batch.records_skipped > 0 && (
                <span className="text-yellow-600">⊘ {batch.records_skipped}</span>
              )}
              {batch.records_failed > 0 && (
                <span className="text-destructive">✗ {batch.records_failed}</span>
              )}
            </div>

            {batch.status === 'completed' && currentBatchId === batch.id && (
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRollback(batch.id);
                  }}
                  disabled={isRollingBack}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  {isRollingBack ? 'Rolling back...' : 'Rollback'}
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
