import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Users, Loader2, Trash2 } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

type StaffRow = {
  id: number;
  role: string;
  member: { id?: number; name?: string; email?: string } | null;
};

const ROLES = ['manager', 'warehouse', 'accountant', 'viewer'] as const;

export function SettingsStaffPanel() {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const canManage =
    user?.is_super_admin ||
    user?.role === 'owner' ||
    user?.role === 'manager' ||
    (user?.abilities || []).includes('*') ||
    (user?.abilities || []).includes('staff.manage');

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('viewer');

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['staff-memberships'],
    enabled: !!canManage,
    queryFn: async () => {
      const res = await axios.get('/api/inventory/staff');
      return (res.data?.data || []) as StaffRow[];
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      const res = await axios.post('/api/inventory/staff', { email, name, role });
      return res.data;
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['staff-memberships'] });
      void refreshUser();
      setEmail('');
      setName('');
      const temp = payload?.data?.temporary_password;
      if (temp) {
        toast.success(
          isAr
            ? `تمت الدعوة. كلمة المرور المؤقتة: ${temp}`
            : `Invited. Temporary password: ${temp}`,
          { duration: 20_000 }
        );
      } else {
        toast.success(isAr ? 'تمت إضافة الموظف' : 'Staff member added');
      }
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.message || (isAr ? 'فشل الدعوة' : 'Invite failed'));
    },
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role: next }: { id: number; role: string }) =>
      axios.put(`/api/inventory/staff/${id}`, { role: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-memberships'] });
      toast.success(isAr ? 'تم تحديث الدور' : 'Role updated');
    },
  });

  const revoke = useMutation({
    mutationFn: (id: number) => axios.delete(`/api/inventory/staff/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-memberships'] });
      toast.success(isAr ? 'تم إلغاء العضوية' : 'Membership revoked');
    },
  });

  if (!canManage) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            {isAr ? 'فريق العمل' : 'Staff'}
          </CardTitle>
          <CardDescription>
            {isAr ? 'عرض فقط — لا تملك صلاحية إدارة الموظفين.' : 'Read-only — you cannot manage staff.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          {isAr ? 'فريق العمل والصلاحيات' : 'Staff & roles'}
        </CardTitle>
        <CardDescription>
          {isAr
            ? 'ادعُ موظفين بأدوار محددة. بياناتهم تُعزل تحت حساب المالك.'
            : 'Invite staff with roles. Their data scope is the owner tenant.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-1">
            <Label>{isAr ? 'البريد' : 'Email'}</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </div>
          <div className="space-y-1.5">
            <Label>{isAr ? 'الاسم' : 'Name'}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{isAr ? 'الدور' : 'Role'}</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={!email || invite.isPending}
              onClick={() => invite.mutate()}
            >
              {invite.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : isAr ? 'دعوة' : 'Invite'}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{isAr ? 'الموظف' : 'Member'}</TableHead>
                <TableHead>{isAr ? 'الدور' : 'Role'}</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground text-center">
                    {isAr ? 'لا يوجد موظفون بعد' : 'No staff yet'}
                  </TableCell>
                </TableRow>
              ) : (
                staff.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.member?.name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{row.member?.email}</div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.role}
                        onValueChange={(next) => updateRole.mutate({ id: row.id, role: next })}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Badge variant="secondary" className="ms-2">
                        {row.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => revoke.mutate(row.id)}
                        aria-label="revoke"
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
