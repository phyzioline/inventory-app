# 🏢 Phyzioline Inventory & Accounting System

A comprehensive, professional-grade inventory and sales management system built with **React**, **Vite**, **TypeScript**, **Supabase**, and **shadcn/ui**.

## ✨ Features

### 📦 **Store Management** (Pages, Not Modals)
- ✅ **Dedicated store pages** at `/stores/:storeId`
- ✅ Dynamic data loading from Supabase
- ✅ Store details, inventory, and statistics
- ✅ Searchable and filterable product inventory
- ✅ Real-time stock level monitoring

### 📊 **Excel Import/Export**
- ✅ **Import products** from Excel (.xlsx) files
- ✅ Built-in validation for duplicates, missing values, and formats
- ✅ Download Excel template for easy importing
- ✅ **Export invoices & reports** to Excel
  - Sales invoices
  - Purchase invoices
  - Returns
  - Store inventory

### 💼 **Invoice Management**
- ✅ **Sales invoices** with customer tracking
- ✅ **Purchase invoices** with supplier tracking
- ✅ **Returns management** (sales & purchase returns)
- ✅ Status tracking (draft, pending, paid, cancelled)
- ✅ Excel export with date ranges and filters

### 🗄️ **Backend with Supabase**
- ✅ Complete PostgreSQL database schema
- ✅ Row-level security (RLS) policies
- ✅ Foreign keys and relationships
- ✅ Automated triggers and functions
- ✅ Auth-ready structure

### 🌍 **Multi-Language Support**
- ✅ RTL support for Arabic
- ✅ English/Arabic language switching
- ✅ Scalable navigation for future stores

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **Supabase account** (free tier available)
- Modern web browser

### Installation

1. **Clone the repository**
   ```bash
   cd "c:\Users\Gaming pc\OneDrive\Desktop\inventory 2\phyzioline-inventory-accounting-main"
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Supabase**
   
   a. Create a new project at [supabase.com](https://supabase.com)
   
   b. Run the database schema:
      - Open the SQL Editor in your Supabase dashboard
      - Copy the contents of `supabase/schema.sql`
      - Execute the SQL script

4. **Configure environment variables**
   ```bash
   # Copy the example env file
   cp .env.example .env
   ```

   Edit `.env` and add your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   
   Navigate to: `http://localhost:8080`

---

## 📁 Project Structure

```
phyzioline-inventory-accounting-main/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── ui/             # shadcn/ui components
│   │   ├── layout/         # Layout components (Sidebar, Header)
│   │   └── dashboard/      # Dashboard-specific components
│   ├── contexts/           # React contexts (Language, etc.)
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utility libraries
│   │   ├── supabase.ts    # Supabase client & types
│   │   ├── api.ts         # API service layer
│   │   ├── excelUtils.ts  # Excel import/export utilities
│   │   └── utils.ts       # General utilities
│   ├── pages/              # Page components
│   │   ├── Dashboard.tsx
│   │   ├── Warehouses.tsx
│   │   ├── StoreDetails.tsx       # ⭐ Store detail page
│   │   ├── ImportProducts.tsx     # ⭐ Excel import page
│   │   ├── SalesInvoices.tsx      # ⭐ Sales invoices
│   │   ├── PurchaseInvoices.tsx   # ⭐ Purchase invoices
│   │   ├── Returns.tsx            # ⭐ Returns management
│   │   └── Products.tsx
│   ├── App.tsx             # Main app with routing
│   ├── main.tsx            # Entry point
│   └── index.css           # Global styles
├── supabase/
│   └── schema.sql          # Database schema
├── public/                 # Static assets
├── package.json
├── vite.config.ts
└── README.md
```

---

## 🗃️ Database Schema

### Tables

1. **stores** - Warehouse/store locations
2. **products** - Product catalog
3. **store_products** - Inventory (products in stores)
4. **customers** - Customer information
5. **suppliers** - Supplier information
6. **sales_invoices** - Sales transactions
7. **sales_invoice_items** - Line items for sales
8. **purchase_invoices** - Purchase transactions
9. **purchase_invoice_items** - Line items for purchases
10. **returns** - Return transactions
11. **return_items** - Line items for returns
12. **stock_movements** - Audit trail for all stock changes

### Key Features

- ✅ **Foreign keys** for data integrity
- ✅ **Indexes** for performance
- ✅ **Triggers** for automatic timestamp updates
- ✅ **Computed columns** for available quantity, line totals
- ✅ **Row-level security** policies
- ✅ **Check constraints** for data validation

---

## 📥 Excel Import

### Product Import

1. Navigate to any store page (`/stores/:storeId`)
2. Click **"Import Products"**
3. Download the Excel template
4. Fill in your product data:
   - Product Name (required)
   - SKU (required)
   - ASIN
   - Cost Price (required)
   - Selling Price (required)
   - Quantity (required)
   - Category, Description, etc.
5. Upload the file
6. Review validation results
7. Import valid rows

### Validation Features

- ✅ Duplicate SKU detection
- ✅ Missing required fields
- ✅ Invalid numeric values
- ✅ Price validation (selling vs cost)
- ✅ Detailed error reporting by row

---

## 📤 Excel Export

### Available Exports

1. **Store Inventory**
   - Product list with quantities and values
   - Location in store
   - Last stock check date

2. **Sales Invoices**
   - Invoice details
   - Customer information
   - Payment status and amounts

3. **Purchase Invoices**
   - Invoice details
   - Supplier information
   - Payment status and amounts

4. **Returns**
   - Return details
   - Customer/Supplier
   - Refund amounts and status

### How to Export

1. Navigate to the relevant page (Sales, Purchases, Returns, or Store Details)
2. Apply any filters (date range, status, store)
3. Click **"Export"** button
4. Excel file downloads automatically

---

## 🎯 Key Pages & Routes

| Route | Description |
|-------|-------------|
| `/` | Dashboard with overview stats |
| `/warehouses` | List of all stores/warehouses |
| `/stores/:storeId` | **Store detail page** with inventory |
| `/stores/:storeId/import` | **Excel import page** for products |
| `/sales` | **Sales invoices** listing |
| `/purchases` | **Purchase invoices** listing |
| `/returns` | **Returns management** |
| `/products` | Product catalog |
| `/customers` | Customer management (coming soon) |
| `/suppliers` | Supplier management (coming soon) |

---

## 🔧 API Services

All API calls are centralized in `src/lib/api.ts`:

### Store Service
```typescript
import { storeService } from '@/lib/api';

// Get all stores
const stores = await storeService.getAllStores();

// Get store by ID
const store = await storeService.getStoreById(storeId);

// Get stores by type
const salesStores = await storeService.getStoresByType('sales');
```

### Product Service
```typescript
import { productService } from '@/lib/api';

// Get all products
const products = await productService.getAllProducts();

// Bulk create (Excel import)
const created = await productService.bulkCreateProducts(products);
```

### Inventory Service
```typescript
import { inventoryService } from '@/lib/api';

// Get store inventory
const inventory = await inventoryService.getStoreInventory(storeId);

// Add product to store
await inventoryService.addProductToStore(storeId, productId, quantity);

// Transfer stock
await inventoryService.transferStock(fromStoreId, toStoreId, productId, qty);
```

### Invoice Services
```typescript
import { salesInvoiceService, purchaseInvoiceService } from '@/lib/api';

// Get sales invoices
const sales = await salesInvoiceService.getAllSalesInvoices(storeId);

// Get purchase invoices
const purchases = await purchaseInvoiceService.getAllPurchaseInvoices(storeId);
```

---

## 🛠️ Technology Stack

- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite
- **UI Framework**: shadcn/ui + Radix UI
- **Styling**: Tailwind CSS
- **Backend**: Supabase (PostgreSQL)
- **State Management**: TanStack Query (React Query)
- **Routing**: React Router v6
- **Excel**: XLSX + FileSaver
- **Icons**: Lucide React
- **Animations**: Framer Motion
- **Forms**: React Hook Form + Zod

---

## 📦 Dependencies

```json
{
  "dependencies": {
    "@supabase/supabase-js": "Latest",
    "xlsx": "Latest",
    "file-saver": "Latest",
    "@tanstack/react-query": "Latest",
    "react-router-dom": "Latest",
    "framer-motion": "Latest",
    "lucide-react": "Latest"
  }
}
```

---

## 🔐 Security

### Row-Level Security (RLS)

All tables have RLS enabled with policies:
- ✅ Authenticated users can read all data
- ✅ Authenticated users can insert/update/delete
- ✅ Ready for role-based access control

### Environment Variables

Never commit `.env` to version control:
```bash
# Add to .gitignore
.env
.env.local
```

---

## 🚀 Deployment

### Build for Production

```bash
npm run build
```

This creates optimized files in the `dist/` directory.

### Deploy to Vercel

```bash
npm install -g vercel
vercel
```

### Deploy to Netlify

```bash
npm install -g netlify-cli
netlify deploy --prod
```

### Environment Variables

Set these in your deployment platform:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## 🎨 Customization

### Colors & Themes

Edit `src/index.css` to customize the color scheme:

```css
:root {
  --primary: 173 80% 40%;      /* Teal */
  --secondary: 222 47% 12%;    /* Dark blue-gray */
  --success: 142 76% 36%;      /* Green */
  --warning: 38 92% 50%;       /* Orange */
  --destructive: 0 72% 51%;    /* Red */
}
```

### Add New Language

1. Update `src/contexts/LanguageContext.tsx`
2. Add translations to the translations object
3. Add language selector in the UI

---

## 📝 Next Steps

### Upcoming Features

- [ ] Customer & Supplier management pages
- [ ] Receipt & Payment tracking
- [ ] Advanced reports & analytics
- [ ] Dashboard charts & graphs
- [ ] User authentication
- [ ] Role-based permissions
- [ ] Email notifications
- [ ] PDF invoice generation
- [ ] Barcode scanning
- [ ] Mobile app

---

## 🐛 Troubleshooting

### Common Issues

**Issue**: Blank page on load
**Solution**: Check browser console for errors. Ensure `.env` is configured.

**Issue**: Supabase connection errors
**Solution**: Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are correct.

**Issue**: Excel import fails
**Solution**: Ensure file format matches template. Check validation errors.

**Issue**: Development server not starting
**Solution**: Run `npm install` again. Check Node version (requires 18+).

---

## 📄 License

This project is proprietary software developed for Phyzioline.

---

## 👥 Support

For questions or support:
- Create an issue in the repository
- Contact: your-support-email@phyzioline.com

---

## 🙏 Acknowledgments

- **shadcn/ui** for the beautiful component library
- **Supabase** for the backend infrastructure
- **Vite** for lightning-fast builds
- **Tailwind CSS** for utility-first styling

---

**Built with ❤️ by the Phyzioline Team**
