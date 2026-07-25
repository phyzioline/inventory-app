import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

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

export default function Subscription() {
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
      toast.error(error.response?.data?.message || 'Could not start checkout.');
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.post('/subscription/cancel'),
    onSuccess: () => {
      toast.success('Reverted to the Free plan.');
      queryClient.invalidateQueries({ queryKey: ['subscription-current'] });
    },
  });

  if (plansLoading || currentLoading) {
    return (
      <div className="h-[50vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Subscription</h1>

      {current && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Current Plan: {current.plan?.name}
              <Badge variant={current.status === 'active' ? 'default' : 'secondary'}>{current.status}</Badge>
            </CardTitle>
            {current.ends_at && <CardDescription>Renews/ends: {new Date(current.ends_at).toLocaleDateString()}</CardDescription>}
          </CardHeader>
          {current.plan?.plan_code !== 'free' && (
            <CardContent>
              <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                {cancel.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel and revert to Free'}
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant={billingCycle === 'monthly' ? 'default' : 'outline'} onClick={() => setBillingCycle('monthly')}>Monthly</Button>
        <Button size="sm" variant={billingCycle === 'yearly' ? 'default' : 'outline'} onClick={() => setBillingCycle('yearly')}>Yearly</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plans?.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <CardDescription>
                {billingCycle === 'monthly' ? `${plan.price_monthly} EGP / month` : `${plan.price_yearly} EGP / year`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="text-sm text-muted-foreground space-y-1">
                {plan.limits && Object.entries(plan.limits).map(([key, value]) => (
                  <li key={key}>{key.replace('_', ' ')}: {value === null ? 'Unlimited' : value}</li>
                ))}
              </ul>
              {plan.plan_code !== current?.plan?.plan_code && plan.plan_code !== 'free' && (
                <Button className="w-full" onClick={() => upgrade.mutate(plan.plan_code)} disabled={upgrade.isPending}>
                  {upgrade.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Upgrade to ${plan.name}`}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
