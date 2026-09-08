import { useAuth } from '@/contexts/AuthContext';
import { canAbility, canAnyAbility } from '@/lib/abilities';
import { useLanguage } from '@/contexts/LanguageContext';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

type Props = {
  children: React.ReactNode;
  /** Require this ability (or any of these if array). */
  ability: string | string[];
};

/** Blocks SPA routes when the signed-in user lacks the required ability. */
export default function AbilityRoute({ children, ability }: Props) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const allowed = Array.isArray(ability)
    ? canAnyAbility(user, ability)
    : canAbility(user, ability);

  if (!allowed) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">
            {isAr ? 'غير مصرح' : 'Access denied'}
          </h1>
          <p className="text-sm text-muted-foreground max-w-md">
            {isAr
              ? 'حسابك لا يملك صلاحية عرض هذه الصفحة.'
              : 'Your role does not include access to this page.'}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/">{isAr ? 'العودة للوحة العمليات' : 'Back to dashboard'}</Link>
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
