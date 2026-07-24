import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

// =====================================================
// EXCEL IMPORT UTILITIES
// =====================================================

export interface ProductImportRow {
    'Product Name': string;
    'SKU': string;
    'ASIN': string;
    'Barcode'?: string;
    'Category'?: string;
    'Unit'?: string;
    'Cost Price': number;
    'Selling Price': number;
    'Quantity': number;
    'Min Stock Level'?: number;
    'Description'?: string;
    'Supplier Name'?: string;
    'Notes'?: string;
    'Image URL'?: string;
}

export interface ImportValidationError {
    row: number;
    field: string;
    value: any;
    error: string;
}

export interface ImportResult {
    success: boolean;
    data: ProductImportRow[];
    errors: ImportValidationError[];
    totalRows: number;
    validRows: number;
    invalidRows: number;
}

/**
 * Read and parse Excel file for product import
 */
export const parseProductExcelFile = (file: File): Promise<ImportResult> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];

                // Convert to JSON with header row
                const jsonData: ProductImportRow[] = XLSX.utils.sheet_to_json(worksheet);

                // Validate the data
                const validationResult = validateProductImportData(jsonData);
                resolve(validationResult);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => {
            reject(new Error('Failed to read file'));
        };

        reader.readAsBinaryString(file);
    });
};

/**
 * Validate imported product data
 */
const validateProductImportData = (data: ProductImportRow[]): ImportResult => {
    const errors: ImportValidationError[] = [];
    const requiredFields: (keyof ProductImportRow)[] = [
        'Product Name',
        'SKU',
        'Cost Price',
        'Selling Price',
        'Quantity'
    ];

    data.forEach((row, index) => {
        const rowNumber = index + 2; // +2 because Excel rows start at 1 and row 1 is header

        // Check required fields
        requiredFields.forEach((field) => {
            if (!row[field] || row[field] === '') {
                errors.push({
                    row: rowNumber,
                    field,
                    value: row[field],
                    error: `${field} is required`
                });
            }
        });

        // Validate numeric fields
        const numericFields: (keyof ProductImportRow)[] = ['Cost Price', 'Selling Price', 'Quantity'];
        numericFields.forEach((field) => {
            const value = row[field];
            if (value !== undefined && value !== null && value !== '') {
                const numValue = Number(value);
                if (isNaN(numValue) || numValue < 0) {
                    errors.push({
                        row: rowNumber,
                        field,
                        value,
                        error: `${field} must be a positive number`
                    });
                }
            }
        });

        // Validate SKU format (alphanumeric, dashes, underscores)
        if (row.SKU && !/^[a-zA-Z0-9-_]+$/.test(row.SKU)) {
            errors.push({
                row: rowNumber,
                field: 'SKU',
                value: row.SKU,
                error: 'SKU can only contain letters, numbers, dashes, and underscores'
            });
        }

        // Validate selling price is not less than cost price
        if (row['Selling Price'] && row['Cost Price'] && row['Selling Price'] < row['Cost Price']) {
            errors.push({
                row: rowNumber,
                field: 'Selling Price',
                value: row['Selling Price'],
                error: 'Selling price should not be less than cost price (check for loss)'
            });
        }
    });

    // Check for duplicate SKUs
    const skuMap = new Map<string, number[]>();
    data.forEach((row, index) => {
        if (row.SKU) {
            const sku = row.SKU.toUpperCase();
            if (!skuMap.has(sku)) {
                skuMap.set(sku, []);
            }
            skuMap.get(sku)!.push(index + 2);
        }
    });

    skuMap.forEach((rows, sku) => {
        if (rows.length > 1) {
            rows.forEach((rowNum) => {
                errors.push({
                    row: rowNum,
                    field: 'SKU',
                    value: sku,
                    error: `Duplicate SKU found in rows: ${rows.join(', ')}`
                });
            });
        }
    });

    const validRows = data.length - new Set(errors.map(e => e.row)).size;

    return {
        success: errors.length === 0,
        data,
        errors,
        totalRows: data.length,
        validRows,
        invalidRows: data.length - validRows
    };
};

/**
 * Download Excel template for product import (Master Products)
 */
export const downloadProductImportTemplate = () => {
    const headers = [
        'اسم المنتج الأساسي*',
        'SKU*',
        'اسم المورد',
        'ملاحظات',
        'التصنيف',
        'الوصف',
        'سعر الشراء',
        'الباركود',
        'حد أدنى للمخزون',
        'رابط الصورة'
    ];

    const exampleRow = {
        'اسم المنتج الأساسي*': 'مثال: مجموعة هاند جريب',
        'SKU*': 'SHOP-HG-001',
        'اسم المورد': 'مورد عام',
        'ملاحظات': 'اختياري',
        'التصنيف': 'أجهزة رياضية',
        'الوصف': 'وصف مختصر (اختياري)',
        'سعر الشراء': 120,
        'الباركود': '123456789',
        'حد أدنى للمخزون': 5,
        'رابط الصورة': 'https://example.com/image.jpg'
    };

    downloadCSVTemplate(headers, [exampleRow], 'master_products_template.csv');
};

/**
 * Download Excel template for Channel Mapping
 */
export const downloadChannelMappingTemplate = () => {
    const headers = [
        'Product Name*',
        'SKU*',
        'Channel SKU',
        'Marketplace',
        'Image URL'
    ];

    const exampleRow = {
        'Product Name*': 'Example Product',
        'SKU*': 'INTERNAL-SKU-01',
        'Channel SKU': 'AMZ-SKU-01',
        'Marketplace': 'Amazon AE',
        'Image URL': 'https://example.com/image.jpg'
    };

    downloadCSVTemplate(headers, [exampleRow], 'Channel_Mapping.csv');
};

/**
 * Download Excel template for Opening Stock
 */
export const downloadOpeningStockTemplate = () => {
    const headers = [
        'Product Name*',
        'SKU*',
        'Warehouse*',
        'Quantity*',
        'Image URL'
    ];

    const exampleRow = {
        'Product Name*': 'Example Product',
        'SKU*': 'PROD-001',
        'Warehouse*': 'Main Warehouse',
        'Quantity*': 50,
        'Image URL': 'https://example.com/image.jpg'
    };

    downloadCSVTemplate(headers, [exampleRow], 'Opening_Stock.csv');
};

/**
 * Helper to generate and download CSV
 */
const downloadCSVTemplate = (headers: string[], data: any[], filename: string) => {
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(h => {
            const val = row[h] || '';
            return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
        }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, filename);
};

// =====================================================
// EXCEL EXPORT UTILITIES
// =====================================================

/**
 * Export Sales Invoices to Excel
 */
export const exportSalesInvoicesToExcel = (invoices: any[], filename: string = 'sales_invoices.xlsx') => {
    const exportData = invoices.map((invoice) => ({
        'Invoice Number': invoice.invoice_number,
        'Date': new Date(invoice.invoice_date).toLocaleDateString(),
        'Customer': invoice.customer?.name || 'Walk-in Customer',
        'Store': invoice.store?.name || '',
        'Status': invoice.status.toUpperCase(),
        'Subtotal': invoice.subtotal,
        'Tax': invoice.tax_amount,
        'Discount': invoice.discount_amount,
        'Total': invoice.total_amount,
        'Paid': invoice.paid_amount,
        'Balance': invoice.total_amount - invoice.paid_amount,
        'Payment Method': invoice.payment_method || '',
        'Notes': invoice.notes || ''
    }));

    createAndDownloadExcel(exportData, 'Sales Invoices', filename);
};

/**
 * Export Sales Invoice Details (with items) to Excel
 */
export const exportSalesInvoiceDetailsToExcel = (invoice: any, filename?: string) => {
    const items = invoice.items || [];

    const exportData = items.map((item: any) => ({
        'Product': item.product?.name || '',
        'SKU': item.product?.sku || '',
        'Quantity': item.quantity,
        'Unit Price': item.unit_price,
        'Discount %': item.discount_percentage,
        'Tax %': item.tax_percentage,
        'Line Total': item.line_total
    }));

    // Add summary rows
    exportData.push({} as any); // Empty row
    exportData.push({
        'Product': 'SUBTOTAL',
        'Line Total': invoice.subtotal
    } as any);
    exportData.push({
        'Product': 'TAX',
        'Line Total': invoice.tax_amount
    } as any);
    exportData.push({
        'Product': 'DISCOUNT',
        'Line Total': -invoice.discount_amount
    } as any);
    exportData.push({
        'Product': 'TOTAL',
        'Line Total': invoice.total_amount
    } as any);

    const defaultFilename = `sales_invoice_${invoice.invoice_number}.xlsx`;
    createAndDownloadExcel(exportData, `Invoice ${invoice.invoice_number}`, filename || defaultFilename);
};

/**
 * Export Purchase Invoices to Excel
 */
export const exportPurchaseInvoicesToExcel = (invoices: any[], filename: string = 'purchase_invoices.xlsx') => {
    const exportData = invoices.map((invoice) => ({
        'Invoice Number': invoice.invoice_number,
        'Date': new Date(invoice.invoice_date).toLocaleDateString(),
        'Supplier': invoice.supplier?.name || 'Unknown',
        'Store': invoice.store?.name || '',
        'Status': invoice.status.toUpperCase(),
        'Subtotal': invoice.subtotal,
        'Tax': invoice.tax_amount,
        'Discount': invoice.discount_amount,
        'Total': invoice.total_amount,
        'Paid': invoice.paid_amount,
        'Balance': invoice.total_amount - invoice.paid_amount,
        'Payment Method': invoice.payment_method || '',
        'Notes': invoice.notes || ''
    }));

    createAndDownloadExcel(exportData, 'Purchase Invoices', filename);
};

/**
 * Export Returns to Excel
 */
export const exportReturnsToExcel = (returns: any[], filename: string = 'returns.xlsx') => {
    const exportData = returns.map((returnDoc) => ({
        'Return Number': returnDoc.return_number,
        'Type': returnDoc.return_type === 'sales_return' ? 'Sales Return' : 'Purchase Return',
        'Date': new Date(returnDoc.return_date).toLocaleDateString(),
        'Customer/Supplier': returnDoc.customer?.name || returnDoc.supplier?.name || '',
        'Store': returnDoc.store?.name || '',
        'Status': returnDoc.status.toUpperCase(),
        'Total': returnDoc.total_amount,
        'Refund': returnDoc.refund_amount,
        'Reason': returnDoc.reason || '',
        'Notes': returnDoc.notes || ''
    }));

    createAndDownloadExcel(exportData, 'Returns', filename);
};

/**
 * Export Store Inventory to Excel
 */
export const exportStoreInventoryToExcel = (storeProducts: any[], storeName: string) => {
    const exportData = storeProducts.map((sp) => ({
        'Product Name': sp.product?.name || '',
        'SKU': sp.product?.sku || '',
        'ASIN': sp.product?.asin || '',
        'Category': sp.product?.category || '',
        'Quantity': sp.quantity,
        'Reserved': sp.reserved_quantity,
        'Available': sp.available_quantity,
        'Cost Price': sp.product?.cost_price || 0,
        'Selling Price': sp.product?.selling_price || 0,
        'Total Value': (sp.quantity * (sp.product?.cost_price || 0)).toFixed(2),
        'Location': sp.location_in_store || '',
        'Last Check': sp.last_stock_check ? new Date(sp.last_stock_check).toLocaleDateString() : ''
    }));

    const filename = `inventory_${storeName.replace(/\s+/g, '_').toLowerCase()}.xlsx`;
    createAndDownloadExcel(exportData, `${storeName} Inventory`, filename);
};

/**
 * Export Products List to Excel
 */
export const exportProductsToExcel = (products: any[], filename: string = 'products.xlsx') => {
    const exportData = products.map((product) => ({
        'Product Name': product.name,
        'SKU': product.sku || '',
        'ASIN': product.asin || '',
        'Barcode': product.barcode || '',
        'Category': product.category || '',
        'Unit': product.unit,
        'Cost Price': product.cost_price,
        'Selling Price': product.selling_price,
        'Min Stock': product.min_stock_level,
        'Status': product.is_active ? 'Active' : 'Inactive',
        'Description': product.description || ''
    }));

    createAndDownloadExcel(exportData, 'Products', filename);
};

/**
 * Generic export to Excel function
 */
export const exportToExcel = (data: any[], filename: string, sheetName: string = 'Data') => {
    createAndDownloadExcel(data, sheetName, `${filename}.xlsx`);
};

/**
 * Generic function to create and download Excel file
 */
const createAndDownloadExcel = (data: any[], sheetName: string, filename: string) => {
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Auto-size columns
    const maxWidth = 50;
    const colWidths: { wch: number }[] = [];

    if (data.length > 0) {
        Object.keys(data[0]).forEach((key) => {
            const maxLength = Math.max(
                key.length,
                ...data.map((row) => {
                    const value = row[key];
                    return value ? String(value).length : 0;
                })
            );
            colWidths.push({ wch: Math.min(maxLength + 2, maxWidth) });
        });
        worksheet['!cols'] = colWidths;
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, filename);
};
