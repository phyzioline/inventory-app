import { useEffect, useState } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
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
  Contact,
  Calculator,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { canAbility, canAnyAbility } from '@/lib/abilities';

interface NavChild {
  key: string;
  path?: string;
  isHeader?: boolean;
  ability?: string;
  anyAbility?: string[];
}

interface NavItem {
  key: string;
  icon: React.ElementType;
  path?: string;
  children?: NavChild[];
  dividerBefore?: boolean;
  sectionTitleKey?: string;
  ability?: string;
  anyAbility?: string[];
}

const navItems: NavItem[] = [
  // ── 1. Dashboard ──
  { key: 'nav.operationDashboard', icon: LayoutDashboard, path: '/' },

  // ── 2. Products (المنتجات) ──
  {
    key: 'nav.products',
    icon: Layers,
    ability: 'stock.read',
    children: [
      { key: 'nav.allProducts', path: '/master-products', ability: 'stock.read' },
      { key: 'nav.lowStock', path: '/inventory/low-stock', ability: 'stock.read' },
    ],
  },

  // ── 3. Purchases (المشتريات) ──
  {
    key: 'nav.purchases',
    icon: Truck,
    anyAbility: ['purchases.write', 'purchases.receive'],
    children: [
      { key: 'nav.purchaseOrders', path: '/purchases', ability: 'purchases.write' },
      { key: 'nav.purchaseReturns', path: '/purchases/returns', ability: 'purchases.write' },
      { key: 'nav.smartImport', path: '/purchases/smart-import', ability: 'purchases.write' },
    ],
  },

  // ── 4. Inventory (إدارة المخزون) ──
  {
    key: 'nav.inventoryManagement',
    icon: Globe,
    anyAbility: ['stock.write', 'transfers.write', 'adjustments.write'],
    children: [
      { key: 'nav.transfers', path: '/inventory/transfers', ability: 'transfers.write' },
      { key: 'nav.inventoryAdjustments', path: '/inventory/adjustments', ability: 'adjustments.write' },
      { key: 'nav.cycleCounts', path: '/inventory/cycle-counts', ability: 'adjustments.write' },
    ],
  },

  // ── 5. Orders (الطلبات) ──
  {
    key: 'nav.orders',
    icon: ShoppingCart,
    ability: 'orders.read',
    children: [
      { key: 'nav.allOrders', path: '/orders', ability: 'orders.read' },
      { key: 'nav.quotations', path: '/quotations', ability: 'orders.read' },
    ],
  },
  { key: 'nav.customersSuppliers', icon: Contact, path: '/customers-suppliers', anyAbility: ['orders.read', 'stock.read'] },
  { key: 'nav.returns', icon: RotateCcw, path: '/returns', anyAbility: ['returns.write', 'stock.read'] },

  // ── 6. Sales (المبيعات) ──
  { key: 'nav.salesInvoices', icon: Receipt, path: '/sales', anyAbility: ['sales.write', 'orders.read'] },

  // ── 7. Finance (المالية) ──
  {
    key: 'nav.finance',
    icon: Landmark,
    ability: 'finance.read',
    children: [
      { key: 'nav.reconciliationHub', path: '/reconciliation', ability: 'finance.read' },
      { key: 'nav.bankAccounts', path: '/finance/bank-accounts', ability: 'finance.read' },
      { key: 'nav.capitalManagement', path: '/finance/capital', ability: 'finance.read' },
      { key: 'nav.sulfa', path: '/finance/sulfa', ability: 'finance.read' },
      { key: 'nav.receipts', path: '/finance/receipts', ability: 'finance.read' },
      { key: 'nav.payments', path: '/finance/payments', ability: 'finance.read' },
      { key: 'nav.expenses', path: '/expenses', ability: 'finance.read' },
    ],
  },

  // ── 8. Reports & Analytics (التقارير) ──
  {
    key: 'nav.reports',
    icon: BarChart3,
    dividerBefore: true,
    ability: 'reports.read',
    children: [
      // Inventory Group
      { key: 'nav.inventoryReports', isHeader: true },
      { key: 'nav.reportsOverview', path: '/reports', ability: 'reports.read' },
      { key: 'nav.transactions', path: '/transactions', ability: 'reports.read' },
      { key: 'nav.reportDeadStock', path: '/reports?type=dead-stock', ability: 'reports.read' },
      { key: 'nav.reportMarginAlerts', path: '/reports?type=margin-alerts', ability: 'reports.read' },
      { key: 'nav.reportReturnRates', path: '/reports?type=return-rates', ability: 'reports.read' },

      // Profit Engine Group (محرك الأرباح)
      { key: 'nav.profitEngine', isHeader: true },
      { key: 'nav.profitByPeriod', path: '/profit/by-period', ability: 'reports.read' },
      { key: 'nav.roi', path: '/profit/roi', ability: 'reports.read' },
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

  useEffect(() => {
    const autoCollapseRoutes = ['/inventory/transfers', '/customers-suppliers', '/returns'];
    if (!isMobile && autoCollapseRoutes.some((path) => location.pathname.startsWith(path))) {
      setCollapsed(true);
    }
  }, [location.pathname, isMobile]);

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

  const itemAllowed = (item: { ability?: string; anyAbility?: string[] }): boolean => {
    if (item.ability) return canAbility(user, item.ability);
    if (item.anyAbility?.length) return canAnyAbility(user, item.anyAbility);
    return true;
  };

  const visibleNavItems = navItems
    .map((item) => {
      if (!itemAllowed(item)) return null;
      if (!item.children) return item;
      const children = item.children.filter((child) => {
        if (child.isHeader) return true;
        return itemAllowed(child);
      });
      // Drop section headers that have no following visible path children
      const pruned: NavChild[] = [];
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (c.isHeader) {
          const hasFollowing = children.slice(i + 1).some((n) => !n.isHeader);
          if (hasFollowing) pruned.push(c);
        } else {
          pruned.push(c);
        }
      }
      if (pruned.filter((c) => !c.isHeader).length === 0) return null;
      return { ...item, children: pruned };
    })
    .filter((item): item is NavItem => item !== null);

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
          {visibleNavItems.map((item) => (
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
      <div className="p-4 border-t border-sidebar-border space-y-2">
        <Link
          to="/settings"
          onClick={handleNavClick}
          className={cn(
            'flex items-center gap-3 rounded-lg p-2 hover:bg-sidebar-accent transition-colors',
            collapsed && 'justify-center',
            location.pathname.startsWith('/settings') && 'bg-sidebar-accent'
          )}
          title={t('settings.tabAccount')}
        >
          <div className="w-8 h-8 rounded-full bg-sidebar-foreground/20 flex items-center justify-center flex-shrink-0">
            <UserCircle className="w-5 h-5 text-sidebar-foreground" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 min-w-0 text-start"
              >
                <p className="text-sm font-medium truncate text-sidebar-foreground">
                  {user?.name || t('auth.user')}
                </p>
                <p className="text-xs text-sidebar-foreground/60 truncate" dir="ltr">
                  {user?.email || '—'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </Link>

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
