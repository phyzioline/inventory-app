import axios from 'axios';
import { getDeviceId, isDesktop } from '@/lib/desktopSync';

// Create axios instance with default config
export const apiClient = axios.create({
    baseURL: '/api/inventory',
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
    },
    withCredentials: true, // Important for session cookies
    withXSRFToken: true, // Laravel 11+ CSRF handling
    // Without this, a hung/slow backend request leaves the UI stuck on a
    // loading spinner forever instead of surfacing an error state. File
    // uploads opt out explicitly via `api.upload`'s own timeoutMs.
    timeout: 30000,
});

// Response interceptor: detect non-JSON responses (e.g. HTML login redirect)
apiClient.interceptors.response.use(
    (response) => {
        // If we got HTML back instead of JSON, the auth session expired
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html') && typeof response.data === 'string') {
            console.warn('[API] Received HTML response instead of JSON - session may have expired');
            return Promise.reject(new Error('Session expired - received HTML instead of JSON'));
        }
        return response;
    },
    (error) => {
        if (error.response?.status === 401 || error.response?.status === 419) {
            console.warn('[API] Authentication error:', error.response.status);
            // Avoid redirect loops on the login page itself.
            const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
            if (!hash.includes('/login')) {
                window.location.hash = '#/login';
            }
        }
        return Promise.reject(error);
    }
);

// Initialize CSRF protection
export const initializeCsrf = async () => {
    try {
        await axios.get('/sanctum/csrf-cookie', { baseURL: '/', withCredentials: true });
    } catch {
        // Sanctum CSRF cookie endpoint may not exist - that's OK with web middleware
    }
};

// Safe array helper - ensures API responses that should be arrays ARE arrays
const ensureArray = (data: any): any[] => {
    if (Array.isArray(data)) return data;
    if (data === null || data === undefined) return [];
    // Laravel sometimes wraps in { data: [...] } for paginated responses
    if (data && Array.isArray(data.data)) return data.data;
    console.warn('[API] Expected array but got:', typeof data);
    return [];
};

// API wrapper object
export const api = {
    // Generic request methods
    get: async <T = any>(endpoint: string, config = {}): Promise<T> => {
        const response = await apiClient.get(endpoint, config);
        return response.data;
    },

    // GET that always returns an array (safe for .map/.reduce/.filter)
    getArray: async (endpoint: string, config = {}): Promise<any[]> => {
        try {
            const response = await apiClient.get(endpoint, config);
            return ensureArray(response.data);
        } catch (error) {
            console.warn(`[API] getArray('${endpoint}') failed:`, error);
            return [];
        }
    },

    post: async (endpoint: string, data = {}, config = {}) => {
        const response = await apiClient.post(endpoint, data, config);
        return response.data;
    },

    upload: async (endpoint: string, formData: FormData, config: { timeoutMs?: number } = {}) => {
        // Axios automatically detects FormData and sets the correct Content-Type with boundary
        const response = await apiClient.post(endpoint, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
            timeout: config.timeoutMs ?? 600_000,
        });
        return response.data;
    },

    put: async (endpoint: string, data = {}, config = {}) => {
        const response = await apiClient.put(endpoint, data, config);
        return response.data;
    },

    delete: async (endpoint: string, config = {}) => {
        const response = await apiClient.delete(endpoint, config);
        return response.data;
    },

    // Auth specific methods
    login: async (credentials: any) => {
        // Desktop shell: ask the backend to also mint a Sanctum token (see
        // InventoryAuthController::login) so the Tauri app can sync while offline.
        const response = isDesktop()
            ? await apiClient.post(
                '/auth/login',
                { ...credentials, device_id: getDeviceId() },
                { headers: { 'X-Client': 'tauri' } },
            )
            : await apiClient.post('/auth/login', credentials);
        return response.data;
    },

    register: async (data: { name: string; email: string; password: string }) => {
        const response = await apiClient.post('/auth/register', data);
        return response.data;
    },

    forgotPassword: async (email: string) => {
        const response = await apiClient.post('/auth/forgot-password', { email });
        return response.data;
    },

    resetPassword: async (data: { token: string; email: string; password: string; password_confirmation: string }) => {
        const response = await apiClient.post('/auth/reset-password', data);
        return response.data;
    },

    logout: async () => {
        const response = await apiClient.post('/auth/logout');
        return response.data;
    },

    // User info
    me: async () => {
        const response = await apiClient.get('/auth/me');
        return response.data;
    },

    // Session initialization
    initializeCsrf
};

export default api;
