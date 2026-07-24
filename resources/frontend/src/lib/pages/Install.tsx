import { useState, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Monitor, Smartphone, Apple, Chrome, Globe, CheckCircle2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const Install = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState<"windows" | "mac" | "linux" | "ios" | "android" | "unknown">("unknown");

  useEffect(() => {
    // Detect platform
    const userAgent = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(userAgent)) {
      setPlatform("ios");
    } else if (/android/.test(userAgent)) {
      setPlatform("android");
    } else if (/mac/.test(userAgent)) {
      setPlatform("mac");
    } else if (/win/.test(userAgent)) {
      setPlatform("windows");
    } else if (/linux/.test(userAgent)) {
      setPlatform("linux");
    }

    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    }
  };

  const translations = {
    title: "تثبيت التطبيق",
    subtitle: "قم بتثبيت Phyzioline ERP كتطبيق سطح المكتب للوصول السريع والعمل بدون اتصال",
    alreadyInstalled: "التطبيق مثبت بالفعل!",
    alreadyInstalledDesc: "يمكنك فتح التطبيق من سطح المكتب أو قائمة التطبيقات",
    installNow: "تثبيت الآن",
    installAvailable: "التثبيت متاح",
    installAvailableDesc: "انقر على الزر أدناه لتثبيت التطبيق على جهازك",
    manualInstall: "التثبيت اليدوي",
    windowsTitle: "Windows",
    windowsDesc: "استخدم Chrome أو Edge",
    windowsSteps: [
      "افتح التطبيق في Chrome أو Edge",
      "انقر على أيقونة التثبيت في شريط العنوان",
      "أو اختر القائمة ← تثبيت التطبيق"
    ],
    macTitle: "macOS",
    macDesc: "استخدم Chrome أو Safari",
    macSteps: [
      "افتح التطبيق في Chrome",
      "انقر على أيقونة التثبيت في شريط العنوان",
      "أو اختر القائمة ← تثبيت Phyzioline ERP"
    ],
    linuxTitle: "Linux",
    linuxDesc: "استخدم Chrome أو Chromium",
    linuxSteps: [
      "افتح التطبيق في Chrome أو Chromium",
      "انقر على أيقونة التثبيت في شريط العنوان",
      "أو اختر القائمة ← تثبيت التطبيق"
    ],
    iosTitle: "iOS (iPhone/iPad)",
    iosDesc: "استخدم Safari",
    iosSteps: [
      "افتح التطبيق في Safari",
      "انقر على زر المشاركة",
      "اختر 'إضافة إلى الشاشة الرئيسية'"
    ],
    androidTitle: "Android",
    androidDesc: "استخدم Chrome",
    androidSteps: [
      "افتح التطبيق في Chrome",
      "انقر على القائمة (ثلاث نقاط)",
      "اختر 'تثبيت التطبيق' أو 'إضافة إلى الشاشة الرئيسية'"
    ],
    features: "مميزات التطبيق المثبت",
    feature1: "وصول سريع من سطح المكتب",
    feature2: "العمل بدون اتصال بالإنترنت",
    feature3: "تحديثات تلقائية",
    feature4: "تجربة أصلية بدون متصفح",
    backToApp: "العودة للتطبيق"
  };

  const getPlatformInstructions = () => {
    switch (platform) {
      case "windows":
        return { title: translations.windowsTitle, desc: translations.windowsDesc, steps: translations.windowsSteps, icon: Monitor };
      case "mac":
        return { title: translations.macTitle, desc: translations.macDesc, steps: translations.macSteps, icon: Apple };
      case "linux":
        return { title: translations.linuxTitle, desc: translations.linuxDesc, steps: translations.linuxSteps, icon: Monitor };
      case "ios":
        return { title: translations.iosTitle, desc: translations.iosDesc, steps: translations.iosSteps, icon: Smartphone };
      case "android":
        return { title: translations.androidTitle, desc: translations.androidDesc, steps: translations.androidSteps, icon: Smartphone };
      default:
        return { title: translations.windowsTitle, desc: translations.windowsDesc, steps: translations.windowsSteps, icon: Globe };
    }
  };

  const currentPlatform = getPlatformInstructions();
  const PlatformIcon = currentPlatform.icon;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-foreground">{translations.title}</h1>
            <p className="text-muted-foreground">{translations.subtitle}</p>
          </div>
        </div>

        {/* Already Installed */}
        {isInstalled && (
          <Card className="border-green-500/50 bg-green-500/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-6 w-6" />
                {translations.alreadyInstalled}
              </CardTitle>
              <CardDescription>{translations.alreadyInstalledDesc}</CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* Install Button (if available) */}
        {deferredPrompt && !isInstalled && (
          <Card className="border-primary/50 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-6 w-6 text-primary" />
                {translations.installAvailable}
              </CardTitle>
              <CardDescription>{translations.installAvailableDesc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleInstall} size="lg" className="w-full md:w-auto">
                <Download className="ml-2 h-5 w-5" />
                {translations.installNow}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Manual Installation Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlatformIcon className="h-6 w-6" />
              {translations.manualInstall} - {currentPlatform.title}
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              <Chrome className="h-4 w-4" />
              {currentPlatform.desc}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {currentPlatform.steps.map((step, index) => (
                <li key={index} className="flex items-start gap-3">
                  <Badge variant="outline" className="mt-0.5 min-w-[28px] justify-center">
                    {index + 1}
                  </Badge>
                  <span className="text-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* All Platforms */}
        <div className="grid md:grid-cols-2 gap-4">
          {[
            { title: translations.windowsTitle, desc: translations.windowsDesc, steps: translations.windowsSteps, icon: Monitor },
            { title: translations.macTitle, desc: translations.macDesc, steps: translations.macSteps, icon: Apple },
            { title: translations.iosTitle, desc: translations.iosDesc, steps: translations.iosSteps, icon: Smartphone },
            { title: translations.androidTitle, desc: translations.androidDesc, steps: translations.androidSteps, icon: Smartphone }
          ].map((platformInfo, idx) => {
            const Icon = platformInfo.icon;
            return (
              <Card key={idx} className="bg-card/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Icon className="h-5 w-5" />
                    {platformInfo.title}
                  </CardTitle>
                  <CardDescription className="text-sm">{platformInfo.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-1 text-sm text-muted-foreground">
                    {platformInfo.steps.map((step, stepIdx) => (
                      <li key={stepIdx}>{stepIdx + 1}. {step}</li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Features */}
        <Card>
          <CardHeader>
            <CardTitle>{translations.features}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                translations.feature1,
                translations.feature2,
                translations.feature3,
                translations.feature4
              ].map((feature, idx) => (
                <div key={idx} className="flex items-center gap-2 text-foreground">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Back Button */}
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={() => navigate("/")}>
            <ArrowLeft className="ml-2 h-4 w-4" />
            {translations.backToApp}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Install;
