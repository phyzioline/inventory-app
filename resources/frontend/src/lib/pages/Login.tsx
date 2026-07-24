import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2, Lock, Mail, Box, User as UserIcon, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';

// Login schema - less strict for login
const loginSchema = z.object({
    email: z.string().email('Please enter a valid email address'),
    password: z.string().min(1, 'Password is required'),
});

// Signup schema - strict password requirements
const signupSchema = z.object({
    full_name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Please enter a valid email address'),
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
});

type LoginFormData = z.infer<typeof loginSchema>;
type SignupFormData = z.infer<typeof signupSchema>;

export default function Login() {
    const { t } = useLanguage();
    const { signIn, signUp, user, loading } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [isSignUp, setIsSignUp] = useState(false);
    const navigate = useNavigate();

    // Redirect if already logged in
    useEffect(() => {
        if (!loading && user) {
            navigate('/');
        }
    }, [user, loading, navigate]);

    const loginForm = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
    });

    const signupForm = useForm<SignupFormData>({
        resolver: zodResolver(signupSchema),
    });

    const password = signupForm.watch('password', '');

    // Password strength indicator for signup
    const getPasswordStrength = (pwd: string): { strength: number; label: string; color: string } => {
        let strength = 0;
        if (pwd.length >= 8) strength++;
        if (/[A-Z]/.test(pwd)) strength++;
        if (/[a-z]/.test(pwd)) strength++;
        if (/[0-9]/.test(pwd)) strength++;
        if (/[^A-Za-z0-9]/.test(pwd)) strength++;

        if (strength <= 2) return { strength, label: 'Weak', color: 'bg-destructive' };
        if (strength <= 3) return { strength, label: 'Medium', color: 'bg-yellow-500' };
        return { strength, label: 'Strong', color: 'bg-green-500' };
    };

    const passwordStrength = getPasswordStrength(password);

    const onLoginSubmit = async (data: LoginFormData) => {
        setIsLoading(true);
        try {
            const { error } = await signIn(data.email, data.password);
            if (error) {
                toast.error(error.message || 'Invalid email or password');
            } else {
                toast.success(t('auth.loginSuccess') || 'Welcome back!');
                navigate('/', { replace: true });
            }
        } catch (error: any) {
            toast.error(error.message || 'An error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const onSignupSubmit = async (data: SignupFormData) => {
        setIsLoading(true);
        try {
            const { error } = await signUp(data.email, data.password, data.full_name);
            if (error) {
                if (error.message.includes('already registered')) {
                    toast.error('This email is already registered. Please sign in instead.');
                } else {
                    toast.error(error.message || 'Failed to create account');
                }
            } else {
                toast.success(t('auth.signupSuccess') || 'Account created successfully!');
                navigate('/', { replace: true });
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to create account');
        } finally {
            setIsLoading(false);
        }
    };

    const toggleMode = () => {
        setIsSignUp(!isSignUp);
        loginForm.reset();
        signupForm.reset();
    };

    // Show loading while checking auth state
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background/95 to-primary/10">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background/95 to-primary/10">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="w-full max-w-md"
            >
                <div className="flex justify-center mb-8">
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-primary/20 backdrop-blur-xl border border-primary/20">
                            <Box className="w-8 h-8 text-primary" />
                        </div>
                        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/60">
                            Phyzioline
                        </h1>
                    </div>
                </div>

                <Card className="glass-card border-primary/10 shadow-2xl shadow-primary/5">
                    <CardHeader className="space-y-1 text-center">
                        <CardTitle className="text-2xl">
                            {isSignUp ? t('auth.createAccount') || 'Create Account' : t('auth.welcome') || 'Welcome Back'}
                        </CardTitle>
                        <CardDescription>
                            {isSignUp
                                ? t('auth.signupSubtitle') || 'Enter your details to create your account'
                                : t('auth.loginSubtitle') || 'Enter your credentials to access your account'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isSignUp ? (
                            <form onSubmit={signupForm.handleSubmit(onSignupSubmit)} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="full_name">{t('auth.fullName') || 'Full Name'}</Label>
                                    <div className="relative">
                                        <UserIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="full_name"
                                            placeholder="John Doe"
                                            className="pl-9 bg-background/50"
                                            {...signupForm.register('full_name')}
                                            disabled={isLoading}
                                        />
                                    </div>
                                    {signupForm.formState.errors.full_name && (
                                        <span className="text-xs text-destructive flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {signupForm.formState.errors.full_name.message}
                                        </span>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email">{t('auth.email') || 'Email'}</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder={t('auth.emailPlaceholder') || 'you@example.com'}
                                            className="pl-9 bg-background/50"
                                            {...signupForm.register('email')}
                                            disabled={isLoading}
                                        />
                                    </div>
                                    {signupForm.formState.errors.email && (
                                        <span className="text-xs text-destructive flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {signupForm.formState.errors.email.message}
                                        </span>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">{t('auth.password') || 'Password'}</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="password"
                                            type={showPassword ? 'text' : 'password'}
                                            className="pl-9 pr-9 bg-background/50"
                                            {...signupForm.register('password')}
                                            disabled={isLoading}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {signupForm.formState.errors.password && (
                                        <span className="text-xs text-destructive flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {signupForm.formState.errors.password.message}
                                        </span>
                                    )}
                                    {password && (
                                        <div className="space-y-1">
                                            <div className="flex gap-1">
                                                {[1, 2, 3, 4, 5].map((level) => (
                                                    <div
                                                        key={level}
                                                        className={`h-1 flex-1 rounded-full transition-colors ${level <= passwordStrength.strength
                                                                ? passwordStrength.color
                                                                : 'bg-muted'
                                                            }`}
                                                    />
                                                ))}
                                            </div>
                                            <p className={`text-xs ${passwordStrength.strength <= 2 ? 'text-destructive' :
                                                    passwordStrength.strength <= 3 ? 'text-yellow-500' : 'text-green-500'
                                                }`}>
                                                Password strength: {passwordStrength.label}
                                            </p>
                                        </div>
                                    )}
                                </div>
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {t('auth.create') || 'Create Account'}
                                </Button>
                            </form>
                        ) : (
                            <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email">{t('auth.email') || 'Email'}</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder={t('auth.emailPlaceholder') || 'you@example.com'}
                                            className="pl-9 bg-background/50"
                                            {...loginForm.register('email')}
                                            disabled={isLoading}
                                        />
                                    </div>
                                    {loginForm.formState.errors.email && (
                                        <span className="text-xs text-destructive flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {loginForm.formState.errors.email.message}
                                        </span>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">{t('auth.password') || 'Password'}</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            id="password"
                                            type={showPassword ? 'text' : 'password'}
                                            className="pl-9 pr-9 bg-background/50"
                                            {...loginForm.register('password')}
                                            disabled={isLoading}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {loginForm.formState.errors.password && (
                                        <span className="text-xs text-destructive flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" />
                                            {loginForm.formState.errors.password.message}
                                        </span>
                                    )}
                                </div>
                                <div className="flex justify-end">
                                    <Link
                                        to="/forgot-password"
                                        className="text-sm font-medium text-primary hover:underline underline-offset-4"
                                    >
                                        {t('auth.forgotPassword') || 'Forgot password?'}
                                    </Link>
                                </div>
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {t('auth.signIn') || 'Sign In'}
                                </Button>
                            </form>
                        )}
                    </CardContent>
                    <CardFooter className="flex flex-col gap-4">
                        <div className="text-sm text-center text-muted-foreground">
                            {isSignUp ? (t('auth.haveAccount') || 'Already have an account?') + ' ' : (t('auth.noAccount') || "Don't have an account?") + ' '}
                            <button
                                type="button"
                                onClick={toggleMode}
                                className="text-primary hover:underline underline-offset-4"
                            >
                                {isSignUp ? t('auth.signIn') || 'Sign In' : t('auth.signUp') || 'Sign Up'}
                            </button>
                        </div>
                    </CardFooter>
                </Card>
            </motion.div>
        </div>
    );
}
