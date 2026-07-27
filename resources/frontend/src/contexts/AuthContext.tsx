import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '@/lib/api';

export interface User {
    id: number;
    name: string;
    email: string;
    company_name?: string | null;
    phone?: string | null;
    currency?: string | null;
    preferred_locale?: string | null;
    is_super_admin?: boolean;
}

interface AuthContextType {
    user: User | null;
    session: any | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<{ error: any | null }>;
    signUp: (email: string, password: string, fullName: string) => Promise<{ error: any | null }>;
    signOut: () => Promise<void>;
    refreshUser: () => Promise<User | null>;
}

function unwrapUser(payload: any): User | null {
    if (!payload) return null;
    if (payload.user && typeof payload.user === 'object') return payload.user as User;
    if (payload.id && (payload.email || payload.name)) return payload as User;
    return null;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    session: null,
    loading: true,
    signIn: async () => ({ error: null }),
    signUp: async () => ({ error: null }),
    signOut: async () => { },
    refreshUser: async () => null,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    const refreshUser = useCallback(async () => {
        try {
            const payload = await api.me();
            const next = unwrapUser(payload);
            setUser(next);
            return next;
        } catch {
            setUser(null);
            return null;
        }
    }, []);

    useEffect(() => {
        (async () => {
            try {
                await refreshUser();
            } finally {
                setLoading(false);
            }
        })();
    }, [refreshUser]);

    const signIn = async (email: string, password: string) => {
        try {
            await api.initializeCsrf();
            const payload = await api.login({ email, password });
            setUser(unwrapUser(payload));
            window.location.hash = '#/';
            window.location.reload();
            return { error: null };
        } catch (error: any) {
            const errorMessage = error.response?.data?.message || error.message || 'Login failed';
            return { error: { message: errorMessage } };
        }
    };

    const signUp = async (email: string, password: string, fullName: string) => {
        try {
            await api.initializeCsrf();
            const payload = await api.register({ name: fullName, email, password });
            setUser(unwrapUser(payload));
            window.location.hash = '#/';
            window.location.reload();
            return { error: null };
        } catch (error: any) {
            const msg = error.response?.data?.message
                || error.response?.data?.errors?.email?.[0]
                || error.message
                || 'Registration failed';
            return { error: { message: msg } };
        }
    };

    const signOut = async () => {
        try {
            await api.logout();
            setUser(null);
            window.location.reload();
        } catch (error) {
            console.error('Logout error:', error);
            setUser(null);
        }
    };

    return (
        <AuthContext.Provider value={{
            user,
            session: null,
            loading,
            signIn,
            signUp,
            signOut,
            refreshUser,
        }}>
            {children}
        </AuthContext.Provider>
    );
};
