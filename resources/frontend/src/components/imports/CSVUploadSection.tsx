import React, { useCallback, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Upload, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import * as XLSX from 'xlsx';

interface CSVUploadSectionProps {
  onUpload: (rows: Record<string, unknown>[], fileInfo: { fileName: string; fileSize: number }) => void;
  isLoading?: boolean;
  batchId?: string | null;
}

export function CSVUploadSection({ onUpload, isLoading, batchId }: CSVUploadSectionProps) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [fileSize, setFileSize] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setFileName(file.name);
    setFileSize(file.size);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

      if (jsonData.length === 0) {
        setError(t('csvUpload.emptyFile'));
        return;
      }

      // Get column headers
      const headers = Object.keys(jsonData[0] || {});
      setColumns(headers);

      // Store all rows
      setAllRows(jsonData);

      // Preview first 20 rows
      setPreview(jsonData.slice(0, 20));
    } catch (err) {
      setError(`${t('csvUpload.parseError')}: ${(err as Error).message}`);
    }

    // Reset input
    e.target.value = '';
  }, []);

  const handleImport = useCallback(() => {
    if (allRows.length === 0) return;
    onUpload(allRows, { fileName, fileSize });
  }, [allRows, fileName, fileSize, onUpload]);

  const handleClear = useCallback(() => {
    setPreview([]);
    setColumns([]);
    setAllRows([]);
    setFileName('');
    setFileSize(0);
    setError(null);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          {t('csvUpload.title')}
        </CardTitle>
        <CardDescription>
          {t('csvUpload.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {batchId && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{t('csvUpload.batchId')}</Badge>
            <code className="bg-muted px-2 py-1 rounded text-xs">{batchId}</code>
          </div>
        )}

        <div className="flex items-center gap-4">
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
              disabled={isLoading}
            />
            <div className="flex items-center gap-2 px-4 py-2 border border-dashed rounded-lg hover:bg-muted transition-colors">
              <Upload className="h-4 w-4" />
              <span>{fileName || t('csvUpload.chooseFile')}</span>
            </div>
          </label>

          {allRows.length > 0 && (
            <>
              <Button onClick={handleImport} disabled={isLoading}>
                {isLoading ? t('csvUpload.importing') : `${t('common.import')} ${allRows.length}`}
              </Button>
              <Button variant="outline" onClick={handleClear} disabled={isLoading}>
                {t('csvUpload.clear')}
              </Button>
            </>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {preview.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">
                Preview (first 20 of {allRows.length} rows)
              </h4>
              <Badge variant="secondary">{columns.length} columns</Badge>
            </div>
            
            <div className="border rounded-lg overflow-auto max-h-[400px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    {columns.slice(0, 8).map((col) => (
                      <TableHead key={col} className="min-w-[120px] text-xs">
                        {col}
                      </TableHead>
                    ))}
                    {columns.length > 8 && (
                      <TableHead className="text-xs text-muted-foreground">
                        +{columns.length - 8} more
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                      {columns.slice(0, 8).map((col) => (
                        <TableCell key={col} className="text-xs truncate max-w-[200px]">
                          {String(row[col] ?? '')}
                        </TableCell>
                      ))}
                      {columns.length > 8 && (
                        <TableCell className="text-xs text-muted-foreground">...</TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
