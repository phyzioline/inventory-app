import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CreditCard, KeyRound, Loader2, Save, Shield, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAuth, type User } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

function unwrapUser(payload: any): User | null {
  if (!payload) return null;
  if (payload.user && typeof payload.user === 'object') return payload.user as User;
  if (payload.id && payload.email) return payload as User;
  return null;
}

export function SettingsAccountPanel() {
  const { t, language, setLanguage, dir } = useLanguage();
  const isAr = language === 'ar';
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['auth-profile'],
    queryFn: async () => unwrapUser(await api.me()),
  });

  const [form, setForm] = useState({
    name: '',
    company_name: '',
    email: '',
    phone: '',
    currency: 'EGP',
  });

  useEffect(() => {
    const src = profile || user;
    if (!src) return;
    setForm({
      name: src.name || '',
      company_name: src.company_name || '',
      email: src.email || '',
      phone: src.phone || '',
      currency: src.currency || 'EGP',
    });
  }, [profile, user]);

  const saveProfile = useMutation({
    mutationFn: (payload: typeof form) => api.put('/auth/profile', {
      ...payload,
      preferred_locale: language,
    }),
    onSuccess: async (res: any) => {
      toast.success(t('settings.profileUpdated'));
      queryClient.invalidateQueries({ queryKey: ['auth-profile'] });
      await refreshUser();
      const next = unwrapUser(res);
      if (next) {
        setForm({
          name: next.name || '',
          company_name: next.company_name || '',
          email: next.email || '',
          phone: next.phone || '',
          currency: next.currency || 'EGP',
        });
      }
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.message
        || error?.response?.data?.errors?.email?.[0]
        || t('settings.profileUpdateError');
      toast.error(msg);
    },
  });

  if (isLoading && !profile && !user) {
    return (
      <div className="h-40 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin me-2" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={dir}>
      <Card className="glass-card border-border/60">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <UserRound className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle>{t('settings.accountTitle')}</CardTitle>
              <CardDescription>{t('settings.accountDesc')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label htmlFor="settings-name">{t('settings.fullName')}</Label>
              <Input
                id="settings-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('settings.fullNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-company">{t('settings.companyName')}</Label>
              <Input
                id="settings-company"
                value={form.company_name}
                onChange={(e) => setForm((f) => ({ ...f, company_name: e.target.value }))}
                placeholder={t('settings.companyNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-email">{t('settings.email')}</Label>
              <Input
                id="settings-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder={t('settings.emailPlaceholder')}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-phone">{t('settings.phone')}</Label>
              <Input
                id="settings-phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder={t('settings.phonePlaceholder')}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings.currency')}</Label>
              <Select value={form.currency} onValueChange={(value) => setForm((f) => ({ ...f, currency: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EGP">{t('currency.egp')}</SelectItem>
                  <SelectItem value="USD">{t('currency.usd')}</SelectItem>
                  <SelectItem value="EUR">{t('currency.eur')}</SelectItem>
                  <SelectItem value="SAR">{t('currency.sar')}</SelectItem>
                  <SelectItem value="AED">{t('currency.aed')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('settings.language')}</Label>
              <Select
                value={language}
                onValueChange={(value: 'en' | 'ar') => {
                  setLanguage(value);
                  api.put('/auth/profile', { preferred_locale: value }).catch(() => undefined);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              {isAr ? 'يُحفظ الاسم والإيميل للعمل والفواتير والتنبيهات.' : 'Name and email are used for invoices, alerts, and account recovery.'}
            </p>
            <Button onClick={() => saveProfile.mutate(form)} disabled={saveProfile.isPending || !form.name.trim() || !form.email.trim()}>
              {saveProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : <Save className="w-4 h-4 me-2" />}
              {t('settings.saveChanges')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-border/60">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <CreditCard className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle>{t('settings.subscriptionQuickTitle')}</CardTitle>
                <CardDescription>{t('settings.subscriptionQuickDesc')}</CardDescription>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/settings/subscription">{t('settings.manageSubscription')}</Link>
            </Button>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}

export function SettingsSecurityPanel() {
  const { t, dir, language } = useLanguage();
  const isAr = language === 'ar';
  const [form, setForm] = useState({
    current_password: '',
    password: '',
    password_confirmation: '',
  });

  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', form),
    onSuccess: () => {
      toast.success(t('settings.passwordUpdated'));
      setForm({ current_password: '', password: '', password_confirmation: '' });
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.message
        || error?.response?.data?.errors?.current_password?.[0]
        || error?.response?.data?.errors?.password?.[0]
        || t('settings.passwordUpdateError');
      toast.error(msg);
    },
  });

  const canSubmit =
    form.current_password.length > 0
    && form.password.length >= 8
    && form.password === form.password_confirmation;

  return (
    <Card className="glass-card border-border/60" dir={dir}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t('settings.securityTitle')}</CardTitle>
            <CardDescription>{t('settings.securityDesc')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 max-w-xl">
        <div className="space-y-2">
          <Label htmlFor="current-password">{t('settings.currentPassword')}</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={form.current_password}
            onChange={(e) => setForm((f) => ({ ...f, current_password: e.target.value }))}
            dir="ltr"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password">{t('settings.newPassword')}</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            dir="ltr"
          />
          <p className="text-xs text-muted-foreground">{t('settings.passwordHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">{t('settings.confirmPassword')}</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={form.password_confirmation}
            onChange={(e) => setForm((f) => ({ ...f, password_confirmation: e.target.value }))}
            dir="ltr"
          />
          {form.password_confirmation && form.password !== form.password_confirmation && (
            <p className="text-xs text-destructive">{t('auth.passwordMatch')}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <KeyRound className="w-3.5 h-3.5" />
            <span>{isAr ? 'بعد التغيير ستبقى جلستك الحالية مفتوحة.' : 'Your current session stays signed in after the change.'}</span>
          </div>
          <Button onClick={() => changePassword.mutate()} disabled={!canSubmit || changePassword.isPending}>
            {changePassword.isPending ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
            {t('settings.updatePassword')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsSubscriptionSummary() {
  const { t, language } = useLanguage();
  const isAr = language === 'ar';

  const { data: current, isLoading } = useQuery({
    queryKey: ['subscription-current'],
    queryFn: () => api.get('/subscription/current'),
  });

  return (
    <Card className="glass-card border-border/60">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{t('subscription.title')}</CardTitle>
          <CardDescription>{t('subscription.subtitle')}</CardDescription>
        </div>
        <Button asChild>
          <Link to="/settings/subscription">{t('settings.manageSubscription')}</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : current?.plan ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={current.status === 'active' ? 'default' : 'secondary'}>
              {current.plan.name}
            </Badge>
            <span className="text-sm text-muted-foreground capitalize">{current.status}</span>
            {current.ends_at && (
              <span className="text-sm text-muted-foreground">
                {isAr ? 'ينتهي/يتجدد:' : 'Renews/ends:'}{' '}
                {new Date(current.ends_at).toLocaleDateString(isAr ? 'ar-EG' : 'en-GB')}
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('subscription.noPlan')}</p>
        )}
      </CardContent>
    </Card>
  );
}
