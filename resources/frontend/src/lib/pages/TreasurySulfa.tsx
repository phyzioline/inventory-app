import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '@/contexts/LanguageContext';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { HandCoins, Loader2, Plus, Wallet } from 'lucide-react';

type SulfaSummary = {
  treasury_account_id: number;
  ledger_balance: number;
  sulfa_borrow_total: number;
  sulfa_repay_total: number;
  sulfa_outstanding_principal: number;
  open_sulfas_count: number;
};

type SulfaRow = {
  id: number;
  lender_name: string;
  principal_amount: string | number;
  amount_paid: string | number;
  status: string;
  borrowed_on: string;
  due_on: string | null;
  notes: string | null;
};

export default function TreasurySulfa() {
  const { dir, language } = useLanguage();
  const isAr = language === 'ar';
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [repayOpen, setRepayOpen] = useState<SulfaRow | null>(null);
  const [form, setForm] = useState({
    lender_name: '',
    principal_amount: '',
    borrowed_on: new Date().toISOString().slice(0, 10),
    due_on: '',
    notes: '',
  });
  const [repayForm, setRepayForm] = useState({
    amount: '',
    paid_on: new Date().toISOString().slice(0, 10),
    memo: '',
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['sulfa-summary'],
    queryFn: () => api.get<SulfaSummary>('finance/sulfas/summary'),
  });

  const { data: pageData, isLoading: listLoading } = useQuery({
    queryKey: ['sulfas', page],
    queryFn: () => api.get<{ data: SulfaRow[]; last_page?: number; current_page?: number }>('finance/sulfas', {
      params: { page, per_page: 50 },
    }),
  });

  const rows = useMemo(() => (Array.isArray(pageData?.data) ? pageData!.data : []), [pageData]);
  const lastPage = (pageData as { last_page?: number })?.last_page ?? 1;

  const createMut = useMutation({
    mutationFn: () =>
      api.post('finance/sulfas', {
        lender_name: form.lender_name,
        principal_amount: parseFloat(form.principal_amount),
        borrowed_on: form.borrowed_on,
        due_on: form.due_on || null,
        notes: form.notes || null,
      }),
    onSuccess: () => {
      toast.success(isAr ? 'تم تسجيل السُلفة وإضافة المبلغ للخزنة' : 'Sulfa recorded and treasury credited');
      qc.invalidateQueries({ queryKey: ['sulfas'] });
      qc.invalidateQueries({ queryKey: ['sulfa-summary'] });
      qc.invalidateQueries({ queryKey: ['treasury-panels'] });
      qc.invalidateQueries({ queryKey: ['finance-cash-flow-overview'] });
      qc.invalidateQueries({ queryKey: ['finance-cash-flow-stats'] });
      setCreateOpen(false);
      setForm({
        lender_name: '',
        principal_amount: '',
        borrowed_on: new Date().toISOString().slice(0, 10),
        due_on: '',
        notes: '',
      });
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.message || (isAr ? 'تعذر الحفظ' : 'Save failed'));
    },
  });

  const repayMut = useMutation({
    mutationFn: () =>
      api.post(`finance/sulfas/${repayOpen!.id}/repay`, {
        amount: parseFloat(repayForm.amount),
        paid_on: repayForm.paid_on,
        memo: repayForm.memo || null,
      }),
    onSuccess: () => {
      toast.success(isAr ? 'تم تسجيل السداد' : 'Repayment recorded');
      qc.invalidateQueries({ queryKey: ['sulfas'] });
      qc.invalidateQueries({ queryKey: ['sulfa-summary'] });
      qc.invalidateQueries({ queryKey: ['treasury-panels'] });
      qc.invalidateQueries({ queryKey: ['finance-cash-flow-overview'] });
      qc.invalidateQueries({ queryKey: ['finance-cash-flow-stats'] });
      setRepayOpen(null);
      setRepayForm({ amount: '', paid_on: new Date().toISOString().slice(0, 10), memo: '' });
    },
    onError: (e: any) => {
      toast.error(e.response?.data?.message || (isAr ? 'تعذر السداد' : 'Repayment failed'));
    },
  });

  const availableHint =
    summary != null
      ? Math.max(0, (summary.ledger_balance ?? 0) - (summary.sulfa_outstanding_principal ?? 0))
      : 0;

  return (
    <div className="space-y-6" dir={dir}>
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <HandCoins className="w-7 h-7 text-primary" />
          {isAr ? 'السُلفة' : 'Sulfa (short-term borrowing)'}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {isAr
            ? 'كل سُلفة تُسجّل كحركة وارد للخزنة، والسداد يُخرج منها. الرصيد الظاهر هنا من سجل الخزنة الجديد (منفصل مؤقتًا عن ملخص التدفق النقدي القديم).'
            : 'Each sulfa credits the treasury ledger; repayments debit it. Balance here is from the new ledger (until merged with legacy cash-flow).'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{isAr ? 'رصيد سجل الخزنة' : 'Ledger balance'}</p>
            <p className="text-2xl font-bold tabular-nums">
              {summaryLoading ? '—' : (summary?.ledger_balance ?? 0).toLocaleString()} EGP
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{isAr ? 'إجمالي ما استُلف' : 'Total borrowed'}</p>
            <p className="text-2xl font-bold tabular-nums text-emerald-600">
              {(summary?.sulfa_borrow_total ?? 0).toLocaleString()} EGP
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">{isAr ? 'المتبقي للسداد' : 'Outstanding principal'}</p>
            <p className="text-2xl font-bold tabular-nums text-amber-600">
              {(summary?.sulfa_outstanding_principal ?? 0).toLocaleString()} EGP
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card border-primary/20">
          <CardContent className="pt-6 flex items-center gap-3">
            <Wallet className="w-8 h-8 text-primary shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">{isAr ? 'متاح تقريبي (رصيد − ديون سُلف مفتوحة)' : 'Approx. available (balance − open sulfa)'}</p>
              <p className="text-xl font-bold tabular-nums">{availableHint.toLocaleString()} EGP</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>{isAr ? 'سجل السُلف' : 'Sulfa records'}</CardTitle>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" />
            {isAr ? 'سُلفة جديدة' : 'New sulfa'}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {listLoading ? (
            <div className="flex justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isAr ? 'الشخص' : 'Lender'}</TableHead>
                  <TableHead className="text-right">{isAr ? 'المبلغ' : 'Principal'}</TableHead>
                  <TableHead className="text-right">{isAr ? 'المسدد' : 'Paid'}</TableHead>
                  <TableHead className="text-right">{isAr ? 'المتبقي' : 'Remaining'}</TableHead>
                  <TableHead>{isAr ? 'الاستحقاق' : 'Due'}</TableHead>
                  <TableHead>{isAr ? 'الحالة' : 'Status'}</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      {isAr ? 'لا توجد سُلف مسجّلة' : 'No sulfa records'}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const p = Number(r.principal_amount);
                    const paid = Number(r.amount_paid);
                    const rem = Math.max(0, p - paid);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.lender_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{paid.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{rem.toLocaleString()}</TableCell>
                        <TableCell>{r.due_on || '—'}</TableCell>
                        <TableCell>
                          <Badge variant={r.status === 'open' ? 'secondary' : 'outline'}>{r.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {r.status === 'open' && rem > 0 ? (
                            <Button size="sm" variant="outline" onClick={() => {
                              setRepayOpen(r);
                              setRepayForm({
                                amount: String(rem),
                                paid_on: new Date().toISOString().slice(0, 10),
                                memo: '',
                              });
                            }}>
                              {isAr ? 'سداد' : 'Repay'}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
          {lastPage > 1 ? (
            <div className="flex justify-end gap-2 p-4 border-t">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                {isAr ? 'السابق' : 'Prev'}
              </Button>
              <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
                {isAr ? 'التالي' : 'Next'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? 'سُلفة جديدة' : 'New sulfa'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{isAr ? 'اسم الشخص / الجهة' : 'Lender name'}</Label>
              <Input value={form.lender_name} onChange={(e) => setForm({ ...form, lender_name: e.target.value })} />
            </div>
            <div>
              <Label>{isAr ? 'المبلغ' : 'Amount'}</Label>
              <Input type="number" value={form.principal_amount} onChange={(e) => setForm({ ...form, principal_amount: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{isAr ? 'تاريخ الاستلام' : 'Borrowed on'}</Label>
                <Input type="date" value={form.borrowed_on} onChange={(e) => setForm({ ...form, borrowed_on: e.target.value })} />
              </div>
              <div>
                <Label>{isAr ? 'استحقاق (اختياري)' : 'Due (optional)'}</Label>
                <Input type="date" value={form.due_on} onChange={(e) => setForm({ ...form, due_on: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>{isAr ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
            <Button
              disabled={!form.lender_name || !form.principal_amount || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (isAr ? 'حفظ' : 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(repayOpen)} onOpenChange={(o) => !o && setRepayOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isAr ? 'سداد سُلفة' : 'Repay sulfa'}</DialogTitle>
          </DialogHeader>
          {repayOpen ? (
            <>
              <p className="text-sm text-muted-foreground">{repayOpen.lender_name}</p>
              <div className="space-y-3 pt-2">
                <div>
                  <Label>{isAr ? 'المبلغ' : 'Amount'}</Label>
                  <Input type="number" value={repayForm.amount} onChange={(e) => setRepayForm({ ...repayForm, amount: e.target.value })} />
                </div>
                <div>
                  <Label>{isAr ? 'تاريخ السداد' : 'Paid on'}</Label>
                  <Input type="date" value={repayForm.paid_on} onChange={(e) => setRepayForm({ ...repayForm, paid_on: e.target.value })} />
                </div>
                <div>
                  <Label>{isAr ? 'ملاحظة' : 'Memo'}</Label>
                  <Input value={repayForm.memo} onChange={(e) => setRepayForm({ ...repayForm, memo: e.target.value })} />
                </div>
              </div>
              <DialogFooter className="pt-4">
                <Button variant="outline" onClick={() => setRepayOpen(null)}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                <Button disabled={!repayForm.amount || repayMut.isPending} onClick={() => repayMut.mutate()}>
                  {repayMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : (isAr ? 'تسجيل السداد' : 'Record')}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
