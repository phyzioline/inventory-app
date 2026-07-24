import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { ArrowLeft, KeyRound, Loader2, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/LanguageContext';
import api from '@/lib/api';
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

const forgotPasswordSchema = z.object({
    email: z.string().email('Please enter a valid email address'),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
    const { t } = useLanguage();
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [submittedEmail, setSubmittedEmail] = useState('');

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<ForgotPasswordFormData>({
        resolver: zodResolver(forgotPasswordSchema),
    });

    const onSubmit = async (data: ForgotPasswordFormData) => {
        setIsLoading(true);
        try {
            await api.forgotPassword(data.email);
            setSubmittedEmail(data.email);
            setIsSubmitted(true);
        } catch (error: any) {
            const msg = error.response?.data?.message || error.message || 'An error occurred. Please try again.';
            toast.error(msg);
        } finally {
            setIsLoading(false);
        }
    };

    if (isSubmitted) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background/95 to-primary/10">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-md"
                >
                    <div className="flex justify-center mb-8">
                        <div className="p-3 rounded-xl bg-green-500/20 backdrop-blur-xl border border-green-500/20">
                            <CheckCircle2 className="w-8 h-8 text-green-500" />
                        </div>
                    </div>

                    <Card className="glass-card border-primary/10 shadow-2xl shadow-primary/5">
                        <CardHeader className="text-center space-y-1">
                            <CardTitle className="text-2xl">Check Your Email</CardTitle>
                            <CardDescription>
                                We've sent password reset instructions to:
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-center font-medium text-foreground">
                                {submittedEmail}
                            </p>
                            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                <p className="text-sm text-muted-foreground">
                                    If an account exists with this email, you'll receive a password reset link shortly.
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    The link will expire in 1 hour for security reasons.
                                </p>
                            </div>
                            <div className="text-center">
                                <p className="text-sm text-muted-foreground mb-2">
                                    Didn't receive the email?
                                </p>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setIsSubmitted(false);
                                        setSubmittedEmail('');
                                    }}
                                >
                                    Try Again
                                </Button>
                            </div>
                        </CardContent>
                        <CardFooter className="flex justify-center">
                            <Link
                                to="/login"
                                className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                Back to Login
                            </Link>
                        </CardFooter>
                    </Card>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background/95 to-primary/10">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-md"
            >
                <div className="flex justify-center mb-8">
                    <div className="p-3 rounded-xl bg-primary/20 backdrop-blur-xl border border-primary/20">
                        <KeyRound className="w-8 h-8 text-primary" />
                    </div>
                </div>

                <Card className="glass-card border-primary/10 shadow-2xl shadow-primary/5">
                    <CardHeader className="text-center space-y-1">
                        <CardTitle className="text-2xl">
                            {t('forgot.title') || 'Forgot Password'}
                        </CardTitle>
                        <CardDescription>
                            {t('forgot.emailDesc') || 'Enter your email address and we\'ll send you a link to reset your password.'}
                        </CardDescription>
                    </CardHeader>

                    <CardContent>
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">
                                    {t('forgot.emailLabel') || 'Email Address'}
                                </Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder={t('auth.emailPlaceholder') || 'you@example.com'}
                                        className="pl-9"
                                        {...register('email')}
                                        disabled={isLoading}
                                    />
                                </div>
                                {errors.email && (
                                    <span className="text-xs text-destructive flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        {errors.email.message}
                                    </span>
                                )}
                            </div>
                            <Button type="submit" className="w-full" disabled={isLoading}>
                                {isLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    t('forgot.sendOtp') || 'Send Reset Link'
                                )}
                            </Button>
                        </form>
                    </CardContent>

                    <CardFooter className="flex justify-center">
                        <Link
                            to="/login"
                            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            {t('forgot.backToLogin') || 'Back to Login'}
                        </Link>
                    </CardFooter>
                </Card>
            </motion.div>
        </div>
    );
}
