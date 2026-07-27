import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Plan {
  id: number;
  plan_code: string;
  name: string;
  price_monthly: string;
  price_yearly: string;
  limits: Record<string, number | null> | null;
}

interface CurrentSubscription {
  id: number;
  status: string;
  billing_cycle: string | null;
  ends_at: string | null;
  plan: Plan;
}

const limitLabel = (key: string, isAr: boolean) => {
  const map: Record<string, { ar: string; en: string }> = {
    channels: { ar: 'القنوات', en: 'Channels' },
    products: { ar: 'المنتجات', en: 'Products' },
    users: { ar: 'المستخدمون', en: 'Users' },
    orders: { ar: 'الطلبات', en: 'Orders' },
    monthly_orders: { ar: 'طلبات شهرياً', en: 'Orders / month' },
    warehouses: { ar: 'المخازن', en: 'Warehouses' },
  };
  return map[key]?.[isAr ? 'ar' : 'en'] || key.replaceAll('_', ' ');
};

export default function Subscription() {
  const { t, language, dir } = useLanguage();
  const isAr = language === 'ar';
  const BackIcon = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const queryClient = useQueryClient();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const { data: plans, isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ['subscription-plans'],
    queryFn: () => api.get('/subscription/plans'),
  });

  const { data: current, isLoading: currentLoading } = useQuery<CurrentSubscription | null>({
    queryKey: ['subscription-current'],
    queryFn: () => api.get('/subscription/current'),
  });

  const upgrade = useMutation({
    mutationFn: (planCode: string) =>
      api.post('/subscription/upgrade', { plan_code: planCode, billing_cycle: billingCycle }),
    onSuccess: (data: { checkout_url: string }) => {
      window.location.href = data.checkout_url;
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || t('subscription.checkoutError'));
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.post('/subscription/cancel'),
    onSuccess: () => {
      toast.success(t('subscription.cancelled'));
      queryClient.invalidateQueries({ queryKey: ['subscription-current'] });
    },
  });

  if (plansLoading || currentLoading) {
    return (
      <div className="h-[50vh] flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ms-2">
            <Link to="/settings">
              <BackIcon className="w-4 h-4 me-1" />
              {t('settings.title')}
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">{t('subscription.title')}</h1>
          <p className="text-muted-foreground">{t('subscription.subtitle')}</p>
        </div>
      </div>

      {current?.plan && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {t('subscription.currentPlan')}: {current.plan.name}
              <Badge variant={current.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                {current.status}
              </Badge>
            </CardTitle>
            {current.ends_at && (
              <CardDescription>
                {t('subscription.renews')}: {new Date(current.ends_at).toLocaleDateString(isAr ? 'ar-EG' : 'en-GB')}
              </CardDescription>
            )}
          </CardHeader>
          {current.plan.plan_code !== 'free' && (
            <CardContent>
              <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                {cancel.isPending ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
                {t('subscription.cancelToFree')}
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant={billingCycle === 'monthly' ? 'default' : 'outline'} onClick={() => setBillingCycle('monthly')}>
          {t('subscription.monthly')}
        </Button>
        <Button size="sm" variant={billingCycle === 'yearly' ? 'default' : 'outline'} onClick={() => setBillingCycle('yearly')}>
          {t('subscription.yearly')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {(plans || []).map((plan) => {
          const price = billingCycle === 'monthly' ? plan.price_monthly : plan.price_yearly;
          const unit = billingCycle === 'monthly' ? t('subscription.perMonth') : t('subscription.perYear');
          const isCurrent = plan.plan_code === current?.plan?.plan_code;

          return (
            <Card key={plan.id} className={isCurrent ? 'border-primary/60 shadow-sm' : 'glass-card'}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>{plan.name}</span>
                  {isCurrent && <Badge>{isAr ? 'الحالية' : 'Current'}</Badge>}
                </CardTitle>
                <CardDescription className="text-base font-semibold text-foreground">
                  {price} {unit}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="text-sm text-muted-foreground space-y-1.5">
                  {plan.limits && Object.entries(plan.limits).map(([key, value]) => (
                    <li key={key} className="flex justify-between gap-3">
                      <span>{limitLabel(key, isAr)}</span>
                      <span className="font-medium text-foreground">
                        {value === null ? t('subscription.unlimited') : value}
                      </span>
                    </li>
                  ))}
                </ul>
                {!isCurrent && plan.plan_code !== 'free' && (
                  <Button className="w-full" onClick={() => upgrade.mutate(plan.plan_code)} disabled={upgrade.isPending}>
                    {upgrade.isPending ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : null}
                    {t('subscription.upgradeTo')} {plan.name}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
