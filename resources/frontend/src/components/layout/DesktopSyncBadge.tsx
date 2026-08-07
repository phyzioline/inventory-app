import { useEffect, useState } from 'react';
import { RefreshCw, CloudOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getSyncStatus, isDesktop, syncNow } from '@/lib/desktopSync';

/** Renders nothing outside the Tauri desktop shell. */
export function DesktopSyncBadge() {
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!isDesktop()) return;

    let cancelled = false;
    const refresh = () => {
      getSyncStatus()?.then((status) => {
        if (!cancelled) setPending(status.pending_count);
      }).catch(() => {});
    };

    refresh();
    const interval = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!isDesktop()) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
      const status = await getSyncStatus();
      if (status) setPending(status.pending_count);
    } catch {
      // Offline or not logged in yet — badge just keeps showing the pending count.
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button variant="ghost" size="sm" className="gap-1.5 px-2 h-9 sm:h-10" onClick={handleSync} disabled={syncing}>
      {pending > 0 ? <CloudOff className="w-4 h-4 text-amber-500" /> : <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />}
      {pending > 0 && (
        <Badge variant="secondary" className="text-xs px-1.5">
          {pending}
        </Badge>
      )}
    </Button>
  );
}
