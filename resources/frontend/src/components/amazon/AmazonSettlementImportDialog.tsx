import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useImportSettlement } from '@/hooks/useAmazonSettlements';
import { useLanguage } from '@/contexts/LanguageContext';
import api from '@/lib/api';
import { Upload, FileCode, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export default function AmazonSettlementImportDialog({ open, onOpenChange }: Props) {
    const { language, t } = useLanguage();
    const isAr = language === 'ar';
    const [file, setFile] = useState<File | null>(null);
    const [channelId, setChannelId] = useState<string>('');
    const importMutation = useImportSettlement();

    const { data: channels = [] } = useQuery({
        queryKey: ['channels-for-settlement-import'],
        queryFn: () => api.getArray('/channels'),
        enabled: open,
    });

    useEffect(() => {
        if (!open || channelId || !Array.isArray(channels) || channels.length === 0) return;
        setChannelId(String(channels[0].id));
    }, [open, channels, channelId]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
        }
    };

    const handleImport = async () => {
        if (!file) return;
        if (!channelId) return;
        await importMutation.mutateAsync({ file, channelId: Number(channelId) });
    };

    const handleClose = () => {
        setFile(null);
        setChannelId('');
        importMutation.reset();
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileCode className="w-5 h-5" />
                        {t('amazon.settlement.importTitle')}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {!importMutation.isSuccess ? (
                        <>
                            <Alert>
                                <AlertDescription>
                                    {t('amazon.settlement.instructions')}
                                    <code className="block mt-2 text-xs bg-muted p-2 rounded">
                                        SettlementReport XML — Payments → Settlement Reports
                                    </code>
                                </AlertDescription>
                            </Alert>

                            <div className="space-y-2">
                                <Label>{t('amazon.settlement.channel')}</Label>
                                <Select value={channelId} onValueChange={setChannelId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('amazon.settlement.selectChannel')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(channels || []).map((ch: any) => (
                                            <SelectItem key={ch.id} value={String(ch.id)}>
                                                {ch.name || ch.slug || `Channel ${ch.id}`}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary transition-colors">
                                <input
                                    type="file"
                                    accept=".xml"
                                    onChange={handleFileChange}
                                    className="hidden"
                                    id="settlement-file-input"
                                />
                                <label htmlFor="settlement-file-input" className="cursor-pointer">
                                    <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                                    <p className="text-sm font-medium">
                                        {file ? file.name : t('amazon.settlement.chooseFile')}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {t('amazon.settlement.supportsFormats')}
                                    </p>
                                </label>
                            </div>

                            {importMutation.isError && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="w-4 h-4" />
                                    <AlertDescription>
                                        {t('amazon.settlement.importError')}
                                    </AlertDescription>
                                </Alert>
                            )}
                        </>
                    ) : (
                        <div className="space-y-4">
                            <Alert>
                                <CheckCircle className="w-4 h-4 text-green-500" />
                                <AlertDescription>
                                    <strong>{t('amazon.settlement.importSuccess')}</strong>
                                    <div className="mt-2 space-y-1 text-sm">
                                        <div>{t('amazon.settlement.settlementId')}: <strong>{importMutation.data?.settlement.settlementId}</strong></div>
                                        <div>{t('amazon.settlement.totalAmount')}: <strong>{importMutation.data?.settlement.totalAmount.toLocaleString()} {importMutation.data?.settlement.currency}</strong></div>
                                        <div>{t('amazon.settlement.transactions')}: <strong>{importMutation.data?.settlement.transactions.length}</strong></div>
                                        <div>{t('amazon.settlement.period')}: {new Date(importMutation.data?.settlement.startDate || '').toLocaleDateString()} → {new Date(importMutation.data?.settlement.endDate || '').toLocaleDateString()}</div>
                                    </div>
                                </AlertDescription>
                            </Alert>

                            {importMutation.data?.errors && importMutation.data.errors.length > 0 && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="w-4 h-4" />
                                    <AlertDescription>
                                        <strong>{t('amazon.settlement.someErrors')}:</strong>
                                        <div className="mt-2 max-h-32 overflow-y-auto text-xs space-y-1">
                                            {importMutation.data.errors.map((err, i) => (
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
                    {!importMutation.isSuccess ? (
                        <>
                            <Button variant="outline" onClick={handleClose}>
                                {t('common.cancel')}
                            </Button>
                            <Button onClick={handleImport} disabled={!file || !channelId || importMutation.isPending}>
                                {importMutation.isPending && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
                                {t('amazon.settlement.importBtn')}
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
