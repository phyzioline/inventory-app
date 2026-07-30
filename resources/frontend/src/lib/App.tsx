import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { HashRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminProtectedRoute from "@/components/AdminProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import { InventoryRealtimeBridge } from "@/components/InventoryRealtimeBridge";

// Auth Pages (lazy — keeps initial bundle small)
const Login = lazy(() => import("./pages/Login"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Install = lazy(() => import("./pages/Install"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Dashboard
const Dashboard = lazy(() => import("./pages/Dashboard"));

// Catalog
const MasterProducts = lazy(() => import("./pages/MasterProducts"));
const MasterProductDetail = lazy(() => import("./pages/MasterProductDetail"));
const Products = lazy(() => import("./pages/Products"));

// Channels
const Channels = lazy(() => import("./pages/Channels"));
const ASINManagement = lazy(() => import("./pages/ASINManagement"));
const AmazonFBA = lazy(() => import("./pages/AmazonFBA"));
const AmazonFBM = lazy(() => import("./pages/AmazonFBM"));
const AmazonOrders = lazy(() => import("./pages/AmazonOrders"));
const ChannelDetail = lazy(() => import("./pages/ChannelDetail"));

// Inventory
const Warehouses = lazy(() => import("./pages/Warehouses"));
const StoreDetails = lazy(() => import("./pages/StoreDetails"));
const Transfers = lazy(() => import("./pages/Transfers"));
const Returns = lazy(() => import("./pages/Returns"));
const ReturnAnalytics = lazy(() => import("./pages/ReturnAnalytics"));
const BatchTracking = lazy(() => import("./pages/BatchTracking"));
const InventoryAdjustments = lazy(() => import("./pages/InventoryAdjustments"));
const CycleCounts = lazy(() => import("./pages/CycleCounts"));
const LowStockAlerts = lazy(() => import("./pages/LowStockAlerts"));
const InventoryTransactions = lazy(() => import("./pages/InventoryTransactions"));

// Orders
const Orders = lazy(() => import("./pages/Orders"));
const SalesInvoices = lazy(() => import("./pages/SalesInvoices"));
const Quotations = lazy(() => import("./pages/Quotations"));
const QuotationEditorPage = lazy(() => import("./pages/QuotationEditorPage"));
const OrderProfitView = lazy(() => import("./pages/OrderProfitView"));

// Purchases
const PurchaseInvoices = lazy(() => import("./pages/PurchaseInvoices"));
const SmartPurchaseImport = lazy(() => import("./pages/SmartPurchaseImport"));
const SupplierCostTracking = lazy(() => import("./pages/SupplierCostTracking"));
const PurchaseReturns = lazy(() => import("./pages/PurchaseReturns"));

// Imports
const AmazonImport = lazy(() => import("./pages/AmazonImport"));
const ImportProducts = lazy(() => import("./pages/ImportProducts"));
const ProductImport = lazy(() => import("./pages/ProductImport"));
const DraftProductsReview = lazy(() => import("./pages/DraftProductsReview"));

// Reconciliation
const Reconciliation = lazy(() => import("./pages/Reconciliation"));

// Finance
const BankAccounts = lazy(() => import("./pages/BankAccounts"));
const Receipts = lazy(() => import("./pages/Receipts"));
const Payments = lazy(() => import("./pages/Payments"));
const Expenses = lazy(() => import("./pages/Expenses"));
const CapitalManagement = lazy(() => import("./pages/CapitalManagement"));
const TreasurySulfa = lazy(() => import("./pages/TreasurySulfa"));

// Profit Engine
const ProfitEngine = lazy(() => import("./pages/ProfitEngine"));

// Reports & Settings
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const CustomersSuppliers = lazy(() => import("./pages/CustomersSuppliers"));
const Subscription = lazy(() => import("./pages/Subscription"));

// Admin (super-admin only)
const AdminOverview = lazy(() => import("./pages/admin/AdminOverview"));
const AdminSubscriptions = lazy(() => import("./pages/admin/AdminSubscriptions"));
const AdminErrorLog = lazy(() => import("./pages/admin/AdminErrorLog"));

function RouteFallback() {
  return (
    <div className="h-[50vh] flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

const RedirectToMasterProduct = () => {
  const { id } = useParams();
  return <Navigate to={`/master-products/${id}`} replace />;
};

const RedirectLegacyMasterProductPath = () => {
  const { id } = useParams();
  return <Navigate to={id ? `/master-products/${id}` : '/master-products'} replace />;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
      staleTime: 3 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    },
  },
});

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <HashRouter>
            <AuthProvider>
              <InventoryRealtimeBridge />
              <Suspense fallback={<RouteFallback />}>
              <Routes>
                {/* Public Routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/install" element={<Install />} />

                {/* Protected Routes */}
                <Route element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }>
                  {/* Dashboard */}
                  <Route path="/" element={<Dashboard />} />

                  {/* ── Catalog ────────────────────────────── */}
                  <Route path="/master-products" element={<MasterProducts />} />
                  <Route path="/master-products/:id" element={<MasterProductDetail />} />
                  <Route path="/master_products" element={<Navigate to="/master-products" replace />} />
                  <Route path="/master_products/:id" element={<RedirectToMasterProduct />} />
                  <Route path="/master/products" element={<Navigate to="/master-products" replace />} />
                  <Route path="/master/products/:id" element={<RedirectLegacyMasterProductPath />} />
                  <Route path="/products" element={<Products />} />
                  <Route path="/customers-suppliers" element={<CustomersSuppliers />} />
                  <Route path="/customers" element={<Navigate to="/customers-suppliers" replace />} />
                  <Route path="/suppliers" element={<Navigate to="/customers-suppliers" replace />} />

                  {/* ── Channels ───────────────────────────── */}
                  <Route path="/channels" element={<Channels />} />
                  <Route path="/channels/amazon/asins" element={<ASINManagement />} />
                  <Route path="/channels/amazon/fba" element={<AmazonFBA />} />
                  <Route path="/channels/amazon/fbm" element={<AmazonFBM />} />
                  <Route path="/channels/amazon/orders" element={<AmazonOrders />} />
                  <Route path="/channels/amazon/payments" element={<Navigate to="/reconciliation" replace />} />
                  <Route path="/channels/:slug/*" element={<ChannelDetail />} />
                  {/* Keep old /asin route → redirects to same page */}
                  <Route path="/asin" element={<ASINManagement />} />

                  {/* ── Inventory ──────────────────────────── */}
                  <Route path="/warehouses" element={<Warehouses />} />
                  <Route path="/stores/:storeId" element={<StoreDetails />} />
                  <Route path="/stores/:storeId/import" element={<ImportProducts />} />
                  <Route path="/inventory/transfers" element={<Transfers />} />
                  <Route path="/inventory/batch-tracking" element={<BatchTracking />} />
                  <Route path="/inventory/adjustments" element={<InventoryAdjustments />} />
                  <Route path="/inventory/cycle-counts" element={<CycleCounts />} />
                  <Route path="/inventory/low-stock" element={<LowStockAlerts />} />
                  <Route path="/returns" element={<Returns />} />
                  <Route path="/returns/analytics" element={<ReturnAnalytics />} />
                  <Route path="/transactions" element={<InventoryTransactions />} />

                  {/* ── Orders ─────────────────────────────── */}
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/sales" element={<SalesInvoices />} />
                  <Route path="/quotations/new" element={<QuotationEditorPage />} />
                  <Route path="/quotations/:id/edit" element={<QuotationEditorPage />} />
                  <Route path="/quotations" element={<Quotations />} />
                  <Route path="/orders/profit" element={<OrderProfitView />} />

                  {/* ── Purchases ──────────────────────────── */}
                  <Route path="/purchases" element={<PurchaseInvoices />} />
                  <Route path="/purchases/smart-import" element={<SmartPurchaseImport />} />
                  <Route path="/purchases/cost-tracking" element={<SupplierCostTracking />} />
                  <Route path="/purchases/returns" element={<PurchaseReturns />} />

                  {/* ── Imports ────────────────────────────── */}
                  <Route path="/import/amazon" element={<AmazonImport />} />
                  <Route path="/import/products" element={<ProductImport />} />
                  <Route path="/import/products/drafts" element={<DraftProductsReview />} />

                  {/* ── Reconciliation ─────────────────────── */}
                  <Route path="/reconciliation" element={<Reconciliation />} />
                  <Route path="/reconciliation/:platform" element={<Reconciliation />} />

                  {/* ── Finance ────────────────────────────── */}
                  <Route path="/finance/bank-accounts" element={<BankAccounts />} />
                  <Route path="/finance/receipts" element={<Receipts />} />
                  <Route path="/finance/payments" element={<Payments />} />
                  <Route path="/expenses" element={<Expenses />} />
                  <Route path="/finance/capital" element={<CapitalManagement />} />
                  <Route path="/finance/sulfa" element={<TreasurySulfa />} />

                  {/* ── Profit Engine ──────────────────────── */}
                  <Route path="/profit/by-period" element={<ProfitEngine />} />
                  <Route path="/profit/by-sku" element={<ProfitEngine />} />
                  <Route path="/profit/by-product" element={<ProfitEngine />} />
                  <Route path="/profit/by-channel" element={<ProfitEngine />} />
                  <Route path="/profit/capital-cycle" element={<Navigate to="/profit/roi" replace />} />
                  <Route path="/profit/roi" element={<ProfitEngine />} />

                  {/* ── Reports & Settings ─────────────────── */}
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/settings/subscription" element={<Subscription />} />
                </Route>

                {/* ── Admin (super-admin only, separate guard from tenant routes) ── */}
                <Route path="/admin" element={
                  <AdminProtectedRoute>
                    <AdminOverview />
                  </AdminProtectedRoute>
                } />
                <Route path="/admin/subscriptions" element={
                  <AdminProtectedRoute>
                    <AdminSubscriptions />
                  </AdminProtectedRoute>
                } />
                <Route path="/admin/error-log" element={
                  <AdminProtectedRoute>
                    <AdminErrorLog />
                  </AdminProtectedRoute>
                } />

                {/* 404 */}
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
            </AuthProvider>
          </HashRouter>
        </TooltipProvider>
      </LanguageProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
