import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Package,
  ShoppingCart,
  ArrowRightLeft,
  ClipboardList,
  RotateCcw,
  BarChart3,
  Users,
  ChevronLeft,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type WorkflowStep = {
  step: number;
  title: string;
  description: string;
  path: string;
  label: string;
  icon: React.ElementType;
  accent: string;
};

export function ProductWorkflowGuide() {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  const steps: WorkflowStep[] = isAr
    ? [
        {
          step: 1,
          title: 'المنتج الأساسي',
          description: 'أنشئ المنتج الحقيقي مرة واحدة (الاسم، التكلفة، الحد الأدنى للمخزون).',
          path: '/master-products',
          label: 'المنتجات الأساسية',
          icon: Package,
          accent: 'border-t-teal-500 bg-teal-500/5',
        },
        {
          step: 2,
          title: 'ربط SKU لكل قناة',
          description: 'لكل قناة بيع (أمازون، نون، جوميا، المحل) أضف SKU خاص بها تحت نفس المنتج.',
          path: '/master-products',
          label: 'إدارة العروض والـ SKU',
          icon: Package,
          accent: 'border-t-sky-500 bg-sky-500/5',
        },
        {
          step: 3,
          title: 'استلام شراء',
          description: 'سجّل فاتورة شراء من المورد — المخزون يدخل المحل ويُسجّل التكلفة.',
          path: '/purchases',
          label: 'فواتير الشراء',
          icon: ShoppingCart,
          accent: 'border-t-emerald-500 bg-emerald-500/5',
        },
        {
          step: 4,
          title: 'تحويل للقنوات',
          description: 'انقل من المحل إلى FBA / نون / جوميا — كل قناة لها مسار تحويل خاص.',
          path: '/inventory/transfers',
          label: 'تحويلات المخزون',
          icon: ArrowRightLeft,
          accent: 'border-t-blue-500 bg-blue-500/5',
        },
        {
          step: 5,
          title: 'الطلبات والمبيعات',
          description: 'استورد أو أدخل الطلبات — النظام يخصم المخزون تلقائيًا من القناة المناسبة.',
          path: '/orders',
          label: 'الطلبات',
          icon: ClipboardList,
          accent: 'border-t-violet-500 bg-violet-500/5',
        },
        {
          step: 6,
          title: 'المرتجعات والتسويات',
          description: 'أي مرتجع أو فرق مخزون يُرجَع أو يُعدَّل هنا ليبقى الرصيد صحيحًا.',
          path: '/returns',
          label: 'المرتجعات',
          icon: RotateCcw,
          accent: 'border-t-amber-500 bg-amber-500/5',
        },
        {
          step: 7,
          title: 'الموردين والعملاء',
          description: 'تابع أرصدة الموردين والعملاء والتحصيل من مكان واحد.',
          path: '/customers-suppliers',
          label: 'العملاء والموردين',
          icon: Users,
          accent: 'border-t-orange-500 bg-orange-500/5',
        },
        {
          step: 8,
          title: 'التقارير والأرباح',
          description: 'راجع هامش الربح، حركة المخزون، والتقارير بعد ما الدورة تكتمل.',
          path: '/reports',
          label: 'التقارير',
          icon: BarChart3,
          accent: 'border-t-rose-500 bg-rose-500/5',
        },
      ]
    : [
        {
          step: 1,
          title: 'Master product',
          description: 'Create the real product once (name, cost, min stock).',
          path: '/master-products',
          label: 'Master products',
          icon: Package,
          accent: 'border-t-teal-500 bg-teal-500/5',
        },
        {
          step: 2,
          title: 'Channel SKUs',
          description: 'Add a SKU per sales channel (Amazon, Noon, Jumia, shop) under the same master product.',
          path: '/master-products',
          label: 'Offers & SKUs',
          icon: Package,
          accent: 'border-t-sky-500 bg-sky-500/5',
        },
        {
          step: 3,
          title: 'Purchase receipt',
          description: 'Record a supplier invoice — stock enters the shop and cost is logged.',
          path: '/purchases',
          label: 'Purchase invoices',
          icon: ShoppingCart,
          accent: 'border-t-emerald-500 bg-emerald-500/5',
        },
        {
          step: 4,
          title: 'Transfer to channels',
          description: 'Move stock from shop to FBA / Noon / Jumia — each channel has its own lane.',
          path: '/inventory/transfers',
          label: 'Stock transfers',
          icon: ArrowRightLeft,
          accent: 'border-t-blue-500 bg-blue-500/5',
        },
        {
          step: 5,
          title: 'Orders & sales',
          description: 'Import or enter orders — stock deducts automatically from the right channel.',
          path: '/orders',
          label: 'Orders',
          icon: ClipboardList,
          accent: 'border-t-violet-500 bg-violet-500/5',
        },
        {
          step: 6,
          title: 'Returns & adjustments',
          description: 'Process returns or stock corrections so balances stay accurate.',
          path: '/returns',
          label: 'Returns',
          icon: RotateCcw,
          accent: 'border-t-amber-500 bg-amber-500/5',
        },
        {
          step: 7,
          title: 'Customers & suppliers',
          description: 'Track payables, receivables, and collections in one place.',
          path: '/customers-suppliers',
          label: 'Customers & suppliers',
          icon: Users,
          accent: 'border-t-orange-500 bg-orange-500/5',
        },
        {
          step: 8,
          title: 'Reports & profit',
          description: 'Review margins, stock movement, and analytics after the cycle completes.',
          path: '/reports',
          label: 'Reports',
          icon: BarChart3,
          accent: 'border-t-rose-500 bg-rose-500/5',
        },
      ];

  const ArrowIcon = isAr ? ChevronLeft : ArrowLeft;

  return (
    <Card className="glass-card border-primary/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">
          {isAr ? 'كيف يشتغل النظام؟ — دورة المنتج' : 'How it works — product lifecycle'}
        </CardTitle>
        <CardDescription className="leading-relaxed">
          {isAr
            ? 'اتبع الخطوات بالترتيب: من تعريف المنتج → شراء → تحويل → بيع → تقارير. اضغط على أي خطوة للذهاب للصفحة.'
            : 'Follow the steps in order: define product → purchase → transfer → sell → reports. Click any step to open its page.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.step}
                className={cn(
                  'flex h-full flex-col rounded-xl border border-t-4 p-4 transition-shadow hover:shadow-md',
                  item.accent,
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {item.step}
                  </span>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="mb-1 text-sm font-semibold leading-snug">{item.title}</h3>
                <p className="mb-3 flex-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                <Button variant="outline" size="sm" className="h-8 w-full justify-between text-xs" asChild>
                  <Link to={item.path}>
                    {item.label}
                    <ArrowIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
          {isAr
            ? '💡 نصيحة: أي حركة مخزون (شراء، تحويل، بيع، مرتجع) تظهر في تتبع المنتج من صفحة المنتجات الأساسية.'
            : '💡 Tip: every stock movement (purchase, transfer, sale, return) appears in product tracking from Master Products.'}
        </p>
      </CardContent>
    </Card>
  );
}
