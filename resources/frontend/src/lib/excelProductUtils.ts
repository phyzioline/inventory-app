import * as XLSX from 'xlsx';
import { Product } from './supabase-services';

export interface ProductImportData {
  name: string;
  category_name?: string;
  selling_price?: number;
  last_purchase_price?: number;
  asins?: string[];
}

export interface ProductExportData {
  SKU: string;
  Name: string;
  Category: string;
  'Selling Price': number | string;
  'Avg Cost': number | string;
  'Lowest Price': number | string;
  'Highest Price': number | string;
}

export function parseProductsFromExcel(file: File): Promise<ProductImportData[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        const products: ProductImportData[] = jsonData.map((row: any) => ({
          name: row['Name'] || row['name'] || row['Product Name'] || '',
          category_name: row['Category'] || row['category'] || undefined,
          selling_price: parseFloat(row['Selling Price'] || row['selling_price'] || row['Price'] || 0) || undefined,
          last_purchase_price: parseFloat(row['Cost'] || row['cost'] || row['Purchase Price'] || 0) || undefined,
          asins: row['ASIN'] || row['ASINs'] 
            ? String(row['ASIN'] || row['ASINs']).split(',').map(a => a.trim()).filter(a => a.length === 10)
            : undefined,
        })).filter(p => p.name);
        
        resolve(products);
      } catch (error) {
        reject(new Error('Failed to parse Excel file'));
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

export function exportProductsToExcel(products: Product[], filename: string = 'products') {
  const data: ProductExportData[] = products.map(p => ({
    SKU: p.sku || '',
    Name: p.name,
    Category: p.category?.name || '',
    'Selling Price': p.selling_price ?? '-',
    'Avg Cost': p.avg_purchase_price ?? '-',
    'Lowest Price': p.lowest_price ?? '-',
    'Highest Price': p.highest_price ?? '-',
  }));
  
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
  
  // Auto-size columns
  const colWidths = [
    { wch: 12 }, // SKU
    { wch: 30 }, // Name
    { wch: 15 }, // Category
    { wch: 14 }, // Selling Price
    { wch: 12 }, // Avg Cost
    { wch: 12 }, // Lowest
    { wch: 12 }, // Highest
  ];
  worksheet['!cols'] = colWidths;
  
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}

export function downloadImportTemplate() {
  const templateData = [
    { Name: 'Example Product 1', Category: 'Electronics', 'Selling Price': 150, Cost: 100, ASIN: 'B0XXXXXXXXX' },
    { Name: 'Example Product 2', Category: 'Accessories', 'Selling Price': 50, Cost: 30, ASIN: '' },
  ];
  
  const worksheet = XLSX.utils.json_to_sheet(templateData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
  
  worksheet['!cols'] = [
    { wch: 25 }, // Name
    { wch: 15 }, // Category
    { wch: 14 }, // Selling Price
    { wch: 10 }, // Cost
    { wch: 12 }, // ASIN
  ];
  
  XLSX.writeFile(workbook, 'product-import-template.xlsx');
}

export function validateImportData(products: ProductImportData[], existingAsins: string[]): {
  valid: ProductImportData[];
  errors: { row: number; message: string }[];
} {
  const valid: ProductImportData[] = [];
  const errors: { row: number; message: string }[] = [];
  const seenAsins = new Set<string>(existingAsins);
  
  products.forEach((product, index) => {
    const rowNum = index + 2; // Excel row (1-indexed + header)
    
    if (!product.name || product.name.trim().length < 2) {
      errors.push({ row: rowNum, message: 'Product name is required (min 2 characters)' });
      return;
    }
    
    // Check for duplicate ASINs
    if (product.asins) {
      for (const asin of product.asins) {
        if (seenAsins.has(asin)) {
          errors.push({ row: rowNum, message: `Duplicate ASIN: ${asin}` });
          return;
        }
        seenAsins.add(asin);
      }
    }
    
    valid.push(product);
  });
  
  return { valid, errors };
}
