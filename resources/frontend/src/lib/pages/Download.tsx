import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download as DownloadIcon,
  Monitor,
  Smartphone,
  Apple,
  Globe,
  CheckCircle2,
  ArrowLeft,
  Star,
} from "lucide-react";

interface DesktopVersionResponse {
  version?: string;
  windows_url?: string | null;
  macos_url?: string | null;
}

const isRealUrl = (url?: string | null): url is string =>
  !!url && url !== "#coming-soon";

const Download = () => {
  const navigate = useNavigate();
  const [desktop, setDesktop] = useState<DesktopVersionResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/inventory/desktop/version", {
      headers: { Accept: "application/json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setDesktop(data);
      })
      .catch(() => {
        // Endpoint unreachable — cards fall back to the "coming soon" state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const windowsReady = isRealUrl(desktop?.windows_url);
  const macosReady = isRealUrl(desktop?.macos_url);

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/login")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              حمّل تطبيق فيزيولاين لإدارة المخازن
            </h1>
            <p className="text-muted-foreground">
              اشتغل من المتصفح، أو ثبّت نسخة سطح المكتب، أو أضفه لشاشتك الرئيسية — اختار اللي يناسبك
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6 items-stretch">
          {/* Web App */}
          <Card className="flex flex-col">
            <CardHeader>
              <Globe className="h-8 w-8 text-primary mb-2" />
              <CardTitle>تطبيق المتصفح</CardTitle>
              <CardDescription>
                من غير أي تثبيت. افتح الموقع من أي متصفح وابدأ الشغل فورًا.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 justify-end gap-2">
              <ul className="text-sm text-muted-foreground space-y-1 mb-4">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" /> دايمًا آخر تحديث
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" /> يشتغل على أي جهاز
                </li>
              </ul>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">فتح تطبيق المتصفح</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Desktop App */}
          <Card className="flex flex-col border-primary/50 shadow-lg shadow-primary/5 relative">
            <Badge className="absolute -top-3 right-1/2 translate-x-1/2 gap-1">
              <Star className="h-3 w-3" /> الأنسب للمخازن
            </Badge>
            <CardHeader>
              <Monitor className="h-8 w-8 text-primary mb-2" />
              <CardTitle>تطبيق سطح المكتب</CardTitle>
              <CardDescription>
                برنامج مستقل لويندوز وماك. تحديثات تلقائية — قريبًا العمل بدون إنترنت.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 justify-end gap-2">
              <ul className="text-sm text-muted-foreground space-y-1 mb-4">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" /> إشعارات سطح المكتب
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" /> تحديث تلقائي وصامت
                </li>
              </ul>
              {windowsReady ? (
                <Button asChild className="w-full">
                  <a href={desktop!.windows_url!}>
                    <Monitor className="ml-2 h-4 w-4" /> تحميل لويندوز
                  </a>
                </Button>
              ) : (
                <Button className="w-full" disabled>
                  <Monitor className="ml-2 h-4 w-4" /> تحميل لويندوز — قريبًا
                </Button>
              )}
              {macosReady ? (
                <Button asChild variant="outline" className="w-full">
                  <a href={desktop!.macos_url!}>
                    <Apple className="ml-2 h-4 w-4" /> تحميل لماك
                  </a>
                </Button>
              ) : (
                <Button variant="outline" className="w-full" disabled>
                  <Apple className="ml-2 h-4 w-4" /> تحميل لماك — قريبًا
                </Button>
              )}
              {desktop?.version && (
                <p className="text-xs text-center text-muted-foreground">
                  الإصدار v{desktop.version}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Add to Home Screen */}
          <Card className="flex flex-col">
            <CardHeader>
              <Smartphone className="h-8 w-8 text-primary mb-2" />
              <CardTitle>إضافة للشاشة الرئيسية</CardTitle>
              <CardDescription>
                ثبّته على الموبايل أو التابلت من المتصفح مباشرة — من غير متجر تطبيقات.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 justify-end gap-2">
              <ul className="text-sm text-muted-foreground space-y-1 mb-4">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" /> يشتغل على iOS و Android
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" /> شكل واستخدام زي تطبيق أصلي
                </li>
              </ul>
              <Button asChild variant="outline" className="w-full">
                <Link to="/install">
                  <DownloadIcon className="ml-2 h-4 w-4" /> خطوات التثبيت
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Download;
