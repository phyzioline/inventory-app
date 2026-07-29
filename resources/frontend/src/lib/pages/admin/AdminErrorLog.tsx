import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronLeft, ChevronRight, AlertTriangle, Search, RefreshCw } from 'lucide-react';
import { format, subDays } from 'date-fns';

interface ErrorEntry {
  timestamp: string;
  environment: string;
  level: string;
  message: string;
  user_id: number | null;
  stack: string;
}

interface ErrorLogResponse {
  data: ErrorEntry[];
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

export default function AdminErrorLog() {
  const [search, setSearch]       = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage]           = useState(1);
  const [since, setSince]         = useState(format(subDays(new Date(), 1), 'yyyy-MM-dd'));
  const [until, setUntil]         = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expanded, setExpanded]   = useState<number | null>(null);

  const params = new URLSearchParams({
    since,
    until,
    page: String(page),
    per_page: '50',
    ...(search ? { search } : {}),
  });

  const { data, isLoading, error, refetch, isFetching } = useQuery<ErrorLogResponse>({
    queryKey: ['admin-error-log', since, until, search, page],
    queryFn: () => api.get(`/admin/error-log?${params}`),
  });

  function handleSearch() {
    setSearch(searchInput);
    setPage(1);
  }

  function handleDateChange() {
    setPage(1);
    refetch();
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <h1 className="text-2xl font-bold">Error Center</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Input
                type="date"
                value={since}
                onChange={(e) => { setSince(e.target.value); handleDateChange(); }}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Input
                type="date"
                value={until}
                onChange={(e) => { setUntil(e.target.value); handleDateChange(); }}
                className="w-40"
              />
            </div>
            <div className="flex gap-2 flex-1 min-w-[240px]">
              <Input
                placeholder="Search errors..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1"
              />
              <Button onClick={handleSearch} size="icon" variant="secondary">
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <div className="h-40 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="p-4 text-destructive">Failed to load error log.</div>
      ) : !data || data.total === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground py-12">
            No errors found in the selected period.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {data.total} error{data.total !== 1 ? 's' : ''} found
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {data.data.map((entry, i) => (
                <div key={i} className="p-4 hover:bg-muted/30 transition-colors">
                  <div
                    className="flex items-start gap-3 cursor-pointer"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                  >
                    <Badge variant="destructive" className="mt-0.5 shrink-0 text-xs">
                      {entry.level}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap mb-1">
                        <span className="text-xs text-muted-foreground font-mono">
                          {entry.timestamp}
                        </span>
                        {entry.user_id && (
                          <Badge variant="outline" className="text-xs">
                            User #{entry.user_id}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium break-words line-clamp-2">
                        {entry.message}
                      </p>
                    </div>
                  </div>
                  {expanded === i && entry.stack && (
                    <pre className="mt-3 p-3 bg-muted rounded text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                      {entry.stack}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {data && data.last_page > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline" size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data.current_page} of {data.last_page}
          </span>
          <Button
            variant="outline" size="sm"
            onClick={() => setPage(p => Math.min(data.last_page, p + 1))}
            disabled={page === data.last_page}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
