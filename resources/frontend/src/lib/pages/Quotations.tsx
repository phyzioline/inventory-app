import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Plus,
    Search,
    FileText,
    ArrowRight,
    Users,
    Loader2,
    Printer,
    Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuotations, useConvertQuotation } from '@/hooks/useQuotations';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { buildQuotationPrintLabels, getDefaultPrintBranding, printQuotationProfessional } from '@/lib/printUtils';

export default function Quotations() {
    const navigate = useNavigate();
    const { t, dir } = useLanguage();
    const rtl = dir === 'rtl';
    const { data: quotations, isLoading } = useQuotations();
    const { mutate: convertToOrder, isPending: isConverting } = useConvertQuotation();
    const [searchTerm, setSearchTerm] = useState('');

    const filteredQuotations = Array.isArray(quotations)
        ? quotations.filter((q) => {
              const term = searchTerm.toLowerCase();
              const ref = (q.reference_number ?? '').toLowerCase();
              const name = (q.customer_name ?? '').toLowerCase();
              return name.includes(term) || ref.includes(term);
          })
        : [];

    const handleConvert = (id: string) => {
        convertToOrder(id);
    };

    const handlePrintQuotation = async (id: string) => {
        try {
            const quotation = await api.get(`quotations/${id}`);
            const ok = printQuotationProfessional({
                rtl,
                branding: getDefaultPrintBranding(),
                quotation,
                labels: buildQuotationPrintLabels(t),
            });
            if (!ok) {
                toast.error(rtl ? 'تعذر الطباعة — اسمح بالنوافذ المنبثقة.' : 'Print blocked — allow popups for this site.');
            }
        } catch {
            toast.error('Failed to print quotation');
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6 text-foreground">
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end">
                <div>
                    <h1 className="text-2xl font-bold text-foreground mb-2">{t('nav.quotations')}</h1>
                    <p className="text-muted-foreground">{t('quotations.subtitle')}</p>
                </div>
                <Button
                    className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 shrink-0"
                    onClick={() => navigate('/quotations/new')}
                >
                    <Plus className="w-4 h-4" />
                    {t('quotations.newButton')}
                </Button>
            </div>

            <div className="flex gap-4 items-center">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground rtl:left-auto rtl:right-3" />
                    <Input
                        placeholder={t('quotations.searchPlaceholder')}
                        className="pl-10 rtl:pl-3 rtl:pr-10 bg-background border-border"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                {isLoading ? (
                    <div className="py-20 flex flex-col items-center gap-4">
                        <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                        <p className="text-muted-foreground">{t('quotations.loading')}</p>
                    </div>
                ) : filteredQuotations.length === 0 ? (
                    <div className="py-20 text-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto border border-border">
                            <FileText className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="text-lg font-medium text-foreground">{t('quotations.emptyTitle')}</h3>
                            <p className="text-muted-foreground">{t('quotations.emptyHint')}</p>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-start border-collapse">
                            <thead>
                                <tr className="bg-muted/50 border-b border-border text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                                    <th className="px-6 py-4">{t('quotations.col.ref')}</th>
                                    <th className="px-6 py-4">{t('quotations.col.date')}</th>
                                    <th className="px-6 py-4">{t('quotations.col.customer')}</th>
                                    <th className="px-6 py-4">{t('quotations.col.total')}</th>
                                    <th className="px-6 py-4">{t('quotations.col.status')}</th>
                                    <th className="px-6 py-4 text-end">{t('quotations.col.actions')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {filteredQuotations.map((q) => (
                                    <tr key={q.id} className="hover:bg-muted/40 transition-colors group">
                                        <td className="px-6 py-4 text-sm font-mono text-emerald-600 dark:text-emerald-400">#{q.reference_number}</td>
                                        <td className="px-6 py-4 text-sm text-muted-foreground">
                                            {q.quotation_date ? new Date(q.quotation_date).toLocaleDateString(rtl ? 'ar-EG' : 'en-US') : '—'}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 border border-border">
                                                    <Users size={14} className="text-muted-foreground" />
                                                </div>
                                                <div>
                                                    <div className="text-sm font-medium text-foreground">{q.customer_name || 'Walk-in'}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                                            {Number(q.total_amount ?? 0).toLocaleString(rtl ? 'ar-EG' : 'en-US')} EGP
                                        </td>
                                        <td className="px-6 py-4 text-sm">
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    'capitalize text-[10px] font-bold px-2 py-0.5 rounded',
                                                    q.status === 'converted'
                                                        ? 'border-emerald-600 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400'
                                                        : q.status === 'sent'
                                                          ? 'border-blue-600 text-blue-700 bg-blue-500/10 dark:text-blue-400'
                                                          : 'border-amber-600 text-amber-800 bg-amber-500/10 dark:text-amber-400'
                                                )}
                                            >
                                                {q.status}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-4 text-end">
                                            <div className="flex items-center justify-end gap-2 flex-wrap">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="gap-1 text-xs border-border"
                                                    title={t('quotations.printHelp')}
                                                    onClick={() => handlePrintQuotation(q.id)}
                                                >
                                                    <Printer size={12} />
                                                    {t('quotations.print')}
                                                </Button>
                                                {q.status !== 'converted' && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="gap-1 text-xs border-amber-600/40 bg-amber-500/10 text-amber-800 hover:bg-amber-600 hover:text-white dark:text-amber-400"
                                                        title={t('quotations.edit')}
                                                        onClick={() => navigate(`/quotations/${q.id}/edit`)}
                                                    >
                                                        <Pencil size={12} />
                                                        {t('quotations.edit')}
                                                    </Button>
                                                )}
                                                {q.status !== 'converted' && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="border-emerald-600/40 bg-emerald-600/10 text-emerald-800 hover:bg-emerald-600 hover:text-white dark:text-emerald-400 transition-all gap-1 text-xs"
                                                        onClick={() => handleConvert(q.id)}
                                                        disabled={isConverting}
                                                    >
                                                        {isConverting ? (
                                                            <Loader2 size={12} className="animate-spin" />
                                                        ) : (
                                                            <ArrowRight size={12} />
                                                        )}
                                                        {t('quotations.convert')}
                                                    </Button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
