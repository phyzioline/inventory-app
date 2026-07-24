import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useImportAmazonOrders, ImportSummary } from '@/hooks/useAmazonOrders';
import { Upload, FileSpreadsheet, Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export default function AmazonOrderImportDialog({ open, onOpenChange }: Props) {
    const { t } = useLanguage();
    const [file, setFile] = useState<File | null>(null);
    const [summary, setSummary] = useState<ImportSummary | null>(null);
    const importMutation = useImportAmazonOrders();

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setSummary(null);
        }
    };

    const handleImport = async () => {
        if (!file) return;

        try {
            const result = await importMutation.mutateAsync(file);
            setSummary(result);
        } catch (error) {
            console.error('Import failed:', error);
        }
    };

    const handleClose = () => {
        setFile(null);
        setSummary(null);
        importMutation.reset();
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="w-5 h-5" />
                        {t('amazon.orders.importTitle')}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {!summary ? (
                        <>
                            <Alert>
                                <AlertDescription>
                                    {t('amazon.orders.instructions')}
                                </AlertDescription>
                            </Alert>

                            <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors">
                                <input
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    onChange={handleFileChange}
                                    className="hidden"
                                    id="order-file-input"
                                />
                                <label htmlFor="order-file-input" className="cursor-pointer">
                                    <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                                    <p className="text-sm font-medium">
                                        {file ? file.name : t('amazon.orders.chooseFile')}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {t('amazon.orders.supportsFormats')}
                                    </p>
                                </label>
                            </div>

                            {importMutation.isError && (
                                <Alert variant="destructive">
                                    <XCircle className="w-4 h-4" />
                                    <AlertDescription>
                                        {t('amazon.orders.importError')}
                                    </AlertDescription>
                                </Alert>
                            )}
                        </>
                    ) : (
                        <div className="space-y-4">
                            <Alert>
                                <CheckCircle className="w-4 h-4 text-green-500" />
                                <AlertDescription>
                                    <strong>{t('amazon.orders.importSuccess')}</strong>
                                    <div className="mt-2 space-y-1 text-sm">
                                        <div>{t('amazon.orders.totalOrders')}: <strong>{summary.total}</strong></div>
                                        <div>{t('amazon.orders.newOrders')}: <strong className="text-green-600">{summary.new}</strong></div>
                                        <div>{t('amazon.orders.updatedOrders')}: <strong className="text-blue-600">{summary.updated}</strong></div>
                                        {summary.skipped > 0 && (
                                            <div>{t('amazon.orders.skipped')}: <strong className="text-yellow-600">{summary.skipped}</strong></div>
                                        )}
                                    </div>
                                </AlertDescription>
                            </Alert>

                            {summary.errors.length > 0 && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="w-4 h-4" />
                                    <AlertDescription>
                                        <strong>{t('amazon.orders.errors')}:</strong>
                                        <div className="mt-2 max-h-32 overflow-y-auto text-xs space-y-1">
                                            {summary.errors.map((err, i) => (
                                                <div key={i}>• {err}</div>
                                            ))}
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    {!summary ? (
                        <>
                            <Button variant="outline" onClick={handleClose}>
                                {t('common.cancel')}
                            </Button>
                            <Button onClick={handleImport} disabled={!file || importMutation.isPending}>
                                {importMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                                {t('amazon.orders.importBtn')}
                            </Button>
                        </>
                    ) : (
                        <Button onClick={handleClose}>
                            {t('common.done')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
