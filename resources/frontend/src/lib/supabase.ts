// Database Types (Domain Models)
export interface Store {
  id: string;
  name: string;
  type: 'sales' | 'raw' | 'final';
  description?: string;
  address?: string;
  phone?: string;
  manager_name?: string;
  capacity_percentage: number;
  total_value: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  sku?: string;
  asin?: string;
  barcode?: string;
  description?: string;
  category?: string;
  unit: string;
  cost_price: number;
  selling_price: number;
  min_stock_level: number;
  max_stock_level: number;
  reorder_point: number;
  image_url?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoreProduct {
  id: string;
  store_id: string;
  product_id: string;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  location_in_store?: string;
  last_stock_check?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  product?: Product;
  store?: Store;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  tax_id?: string;
  company_name?: string;
  credit_limit: number;
  current_balance: number;
  customer_type: string;
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  tax_id?: string;
  company_name?: string;
  payment_terms?: string;
  current_balance: number;
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SalesInvoice {
  id: string;
  invoice_number: string;
  store_id: string;
  customer_id?: string;
  invoice_date: string;
  due_date?: string;
  status: 'draft' | 'pending' | 'paid' | 'partially_paid' | 'cancelled';
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  paid_amount: number;
  payment_method?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  customer?: Customer;
  store?: Store;
  items?: SalesInvoiceItem[];
}

export interface SalesInvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percentage: number;
  tax_percentage: number;
  line_total: number;
  notes?: string;
  created_at: string;
  // Joined fields
  product?: Product;
}

export interface PurchaseInvoice {
  id: string;
  invoice_number: string;
  store_id: string;
  supplier_id?: string;
  invoice_date: string;
  due_date?: string;
  status: 'draft' | 'pending' | 'paid' | 'partially_paid' | 'cancelled';
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  paid_amount: number;
  payment_method?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  supplier?: Supplier;
  store?: Store;
  items?: PurchaseInvoiceItem[];
}

export interface PurchaseInvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percentage: number;
  tax_percentage: number;
  line_total: number;
  notes?: string;
  created_at: string;
  // Joined fields
  product?: Product;
}

export interface Return {
  id: string;
  return_number: string;
  return_type: 'sales_return' | 'purchase_return';
  store_id: string;
  related_invoice_id?: string;
  customer_id?: string;
  supplier_id?: string;
  return_date: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  refund_amount: number;
  refund_method?: string;
  reason?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  customer?: Customer;
  supplier?: Supplier;
  store?: Store;
  items?: ReturnItem[];
}

export interface ReturnItem {
  id: string;
  return_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  condition: string;
  notes?: string;
  created_at: string;
  // Joined fields
  product?: Product;
}

export interface StockMovement {
  id: string;
  product_id: string;
  from_store_id?: string;
  to_store_id?: string;
  movement_type: 'purchase' | 'sale' | 'transfer' | 'adjustment' | 'return' | 'initial';
  quantity: number;
  reference_id?: string;
  reference_number?: string;
  notes?: string;
  movement_date: string;
  created_at: string;
  // Joined fields
  product?: Product;
  from_store?: Store;
  to_store?: Store;
}
