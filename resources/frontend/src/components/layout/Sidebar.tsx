import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  Package,
  Barcode,
  Warehouse,
  ShoppingCart,
  Receipt,
  RotateCcw,
  Users,
  UserCircle,
  Wallet,
  CreditCard,
  BarChart3,
  Settings,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ArrowLeftRight,
  FileUp,
  Globe,
  Layers,
  Tag,
  Store,
  MapPin,
  Boxes,
  FileCheck,
  Landmark,
  PiggyBank,
  TrendingUp,
  DollarSign,
  Scale,
  CircleDollarSign,
  Percent,
  RefreshCw,
  Truck,
  Calculator,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavChild {
  key: string;
  path?: string;
  isHeader?: boolean;
}

interface NavItem {
  key: string;
  icon: React.ElementType;
  path?: string;
  children?: NavChild[];
  dividerBefore?: boolean;
  sectionTitleKey?: string;
}

const navItems: NavItem[] = [
  // ── 1. Dashboard ──
  { key: 'nav.operationDashboard', icon: LayoutDashboard, path: '/' },

  // ── 2. Products (المنتجات) ──
  {
    key: 'nav.products',
    icon: Layers,
    children: [
      { key: 'nav.allProducts', path: '/master-products' },
    ],
  },

  // ── 3. Purchases (المشتريات) ──
  {
    key: 'nav.purchases',
    icon: Truck,
    children: [
      { key: 'nav.purchaseOrders', path: '/purchases' },
      { key: 'nav.purchaseReturns', path: '/purchases/returns' },
      { key: 'nav.smartImport', path: '/purchases/smart-import' },
      { key: 'nav.sulfa', path: '/finance/sulfa' },
      { key: 'nav.suppliers', path: '/suppliers' },
    ],
  },

  // ── 4. Inventory (إدارة المخزون) ──
  {
    key: 'nav.inventoryManagement',
    icon: Globe,
    children: [
      { key: 'nav.transfers', path: '/inventory/transfers' },
      { key: 'nav.inventoryAdjustments', path: '/inventory/adjustments' },
    ],
  },

  // ── 5. Orders (الطلبات) ──
  {
    key: 'nav.orders',
    icon: ShoppingCart,
    children: [
      { key: 'nav.allOrders', path: '/orders' },
      { key: 'nav.quotations', path: '/quotations' },
    ],
  },
  { key: 'nav.suppliers', icon: Truck, path: '/suppliers' },
  { key: 'nav.customers', icon: Users, path: '/customers' },
  { key: 'nav.returns', icon: RotateCcw, path: '/returns' },

  // ── 6. Sales (المبيعات) ──
  { key: 'nav.salesInvoices', icon: Receipt, path: '/sales' },

  // ── 7. Finance (المالية) ──
  {
    key: 'nav.finance',
    icon: Landmark,
    children: [
      { key: 'nav.reconciliationHub', path: '/reconciliation' },
      { key: 'nav.bankAccounts', path: '/finance/bank-accounts' },
      { key: 'nav.capitalManagement', path: '/finance/capital' },
      { key: 'nav.receipts', path: '/finance/receipts' },
      { key: 'nav.payments', path: '/finance/payments' },
      { key: 'nav.expenses', path: '/expenses' },
    ],
  },

  // ── 8. Reports & Analytics (التقارير) ──
  {
    key: 'nav.reports',
    icon: BarChart3,
    dividerBefore: true,
    children: [
      // Inventory Group
      { key: 'nav.inventoryReports', isHeader: true },
      { key: 'nav.reportsOverview', path: '/reports' },
      { key: 'nav.transactions', path: '/transactions' },
      { key: 'nav.reportDeadStock', path: '/reports?type=dead-stock' },
      { key: 'nav.reportMarginAlerts', path: '/reports?type=margin-alerts' },
      { key: 'nav.reportReturnRates', path: '/reports?type=return-rates' },

      // Profit Engine Group (محرك الأرباح)
      { key: 'nav.profitEngine', isHeader: true },
      { key: 'nav.profitByPeriod', path: '/profit/by-period' },
      { key: 'nav.roi', path: '/profit/roi' },
    ],
  },
  { key: 'nav.settings', icon: Settings, path: '/settings' },
];

interface SidebarProps {
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({
  isMobile = false,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const { t, dir } = useLanguage();
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  useEffect(() => {
    // Keep mobile sidebar fully expanded for reliable tap targets.
    if (isMobile && collapsed) {
      setCollapsed(false);
    }
  }, [isMobile, collapsed]);

  const toggleExpanded = (key: string) => {
    setExpandedItems(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const isActive = (item: NavItem): boolean => {
    if (item.path) {
      return location.pathname === item.path || location.pathname.startsWith(item.path + '/');
    }
    if (item.children) {
      return item.children.some(child => location.pathname === child.path || location.pathname.startsWith(child.path + '/'));
    }
    return false;
  };

  const CollapseIcon = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const ExpandIcon = dir === 'rtl' ? ChevronLeft : ChevronRight;
  const handleNavClick = () => {
    if (isMobile) onMobileClose?.();
  };

  return (
    <motion.aside
      initial={{ width: 260 }}
      animate={{ width: collapsed ? 72 : 260 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className={cn(
        'h-screen bg-sidebar border-r border-sidebar-border flex flex-col',
        isMobile
          ? cn(
              'fixed inset-y-0 z-50 w-[260px] transition-transform duration-300 ease-in-out',
              dir === 'rtl' ? 'right-0' : 'left-0',
              mobileOpen ? 'translate-x-0' : dir === 'rtl' ? 'translate-x-full' : '-translate-x-full',
              !mobileOpen && 'pointer-events-none'
            )
          : 'relative'
      )}
      style={{ background: 'var(--gradient-sidebar)' }}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border">
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2"
            >
              <div className="w-10 h-10 flex items-center justify-center">
                <img src="/web/assets/images/LOGO PHYSIOLINE SVG 1.svg" alt="Phyzioline" className="w-full h-auto" />
              </div>
              <span className="font-bold text-xl tracking-tight text-sidebar-foreground">Phyzioline</span>
            </motion.div>
          )}
        </AnimatePresence>
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors"
          >
            {collapsed ? (
              <ExpandIcon className="w-4 h-4 text-sidebar-foreground/70" />
            ) : (
              <CollapseIcon className="w-4 h-4 text-sidebar-foreground/70" />
            )}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-4 px-2">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.key}>
              {/* Section Title */}
              {item.sectionTitleKey && !collapsed && (
                <div className="mt-6 mb-2 px-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40">
                    {t(item.sectionTitleKey)}
                  </span>
                </div>
              )}

              {/* Section divider */}
              {item.dividerBefore && !collapsed && (
                <div className="my-3 mx-2 border-t border-sidebar-border/50" />
              )}
              {item.dividerBefore && collapsed && (
                <div className="my-2 mx-3 border-t border-sidebar-border/50" />
              )}

              {item.path ? (
                <NavLink
                  to={item.path}
                  onClick={handleNavClick}
                  className={({ isActive }) =>
                    cn('nav-item', isActive && 'active')
                  }
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <AnimatePresence>
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: 'auto' }}
                        exit={{ opacity: 0, width: 0 }}
                        className="truncate"
                      >
                        {t(item.key)}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </NavLink>
              ) : (
                <>
                  <button
                    onClick={() => toggleExpanded(item.key)}
                    className={cn(
                      'nav-item w-full justify-between',
                      isActive(item) && 'active'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-5 h-5 flex-shrink-0" />
                      <AnimatePresence>
                        {!collapsed && (
                          <motion.span
                            initial={{ opacity: 0, width: 0 }}
                            animate={{ opacity: 1, width: 'auto' }}
                            exit={{ opacity: 0, width: 0 }}
                            className="truncate"
                          >
                            {t(item.key)}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    {!collapsed && (
                      <ChevronDown
                        className={cn(
                          'w-4 h-4 transition-transform',
                          expandedItems.includes(item.key) && 'rotate-180'
                        )}
                      />
                    )}
                  </button>
                  <AnimatePresence>
                    {!collapsed && expandedItems.includes(item.key) && item.children && (
                      <motion.ul
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden ml-4 mt-1 space-y-1"
                      >
                        {item.children.map((child) => (
                          <li key={child.key}>
                            {child.isHeader ? (
                              <div className="px-3 py-2 mt-2 text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/40 border-t border-sidebar-border/20 first:mt-0 first:border-0">
                                {t(child.key)}
                              </div>
                            ) : (
                              <NavLink
                                to={child.path!}
                                onClick={handleNavClick}
                                className={({ isActive }) => {
                                  // If path has search params, ensure they match exactly
                                  const hasQuery = child.path?.includes('?');
                                  const isQueryMatch = hasQuery
                                    ? location.search === child.path?.substring(child.path.indexOf('?'))
                                    : location.search === '' || location.search === '?type=sales';
                                  return cn('nav-item text-sm', isActive && isQueryMatch && 'active');
                                }}
                              >
                                <span className="w-5" />
                                {t(child.key)}
                              </NavLink>
                            )}
                          </li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border">
        <div className={cn('flex items-center gap-3 mb-2', collapsed && 'justify-center')}>
          <div className="w-8 h-8 rounded-full bg-sidebar-foreground/20 flex items-center justify-center">
            <UserCircle className="w-5 h-5 text-sidebar-foreground" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-w-0"
              >
                <p className="text-sm font-medium truncate text-sidebar-foreground">{t('auth.user')}</p>
                <p className="text-xs text-sidebar-foreground/60 truncate">{user?.email}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          onClick={() => {
            signOut();
            handleNavClick();
          }}
          className={cn(
            'flex items-center gap-2 w-full p-2 rounded-lg hover:bg-sidebar-accent hover:text-red-300 transition-colors text-sidebar-foreground/70',
            collapsed && 'justify-center'
          )}
          title={t('auth.signOut')}
        >
          <LogOut className="w-5 h-5" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="text-sm font-medium"
              >
                {t('auth.signOut')}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}
