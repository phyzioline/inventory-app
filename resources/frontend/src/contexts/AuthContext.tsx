import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '@/lib/api';

// Define User type based on Laravel API response
export interface User {
    id: number;
    name: string;
    email: string;
    is_super_admin?: boolean;
}

interface AuthContextType {
    user: User | null;
    session: any | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<{ error: any | null }>;
    signUp: (email: string, password: string, fullName: string) => Promise<{ error: any | null }>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    session: null,
    loading: true,
    signIn: async () => ({ error: null }),
    signUp: async () => ({ error: null }),
    signOut: async () => { },
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    const checkUser = async () => {
        try {
            const userData = await api.me();
            setUser(userData);
        } catch (error) {
            setUser(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        checkUser();
    }, []);

    const signIn = async (email: string, password: string) => {
        try {
            await api.initializeCsrf();
            const userData = await api.login({ email, password });
            setUser(userData);
            // Use reload to ensure session is fully picked up and any SPA state is cleared
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
            const userData = await api.register({ name: fullName, email, password });
            setUser(userData);
            // Use reload to ensure session is fully picked up and any SPA state is cleared
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
            console.error("Logout error:", error);
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
            signOut
        }}>
            {children}
        </AuthContext.Provider>
    );
};
