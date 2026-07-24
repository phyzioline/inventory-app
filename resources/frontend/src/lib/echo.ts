import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { initializeCsrf } from '@/lib/api';

declare global {
    interface Window {
        Pusher: typeof Pusher;
        Echo?: Echo;
    }
}

function reverbKey(): string {
    return import.meta.env.VITE_REVERB_APP_KEY ?? '';
}

export function isInventoryRealtimeEnabled(): boolean {
    return reverbKey().length > 0;
}

export async function getInventoryEcho(): Promise<Echo | null> {
    if (!isInventoryRealtimeEnabled()) {
        return null;
    }

    if (window.Echo) {
        return window.Echo;
    }

    await initializeCsrf();

    window.Pusher = Pusher;
    window.Echo = new Echo({
        broadcaster: 'reverb',
        key: reverbKey(),
        wsHost: import.meta.env.VITE_REVERB_HOST ?? window.location.hostname,
        wsPort: Number(import.meta.env.VITE_REVERB_PORT ?? 80),
        wssPort: Number(import.meta.env.VITE_REVERB_PORT ?? 443),
        forceTLS: (import.meta.env.VITE_REVERB_SCHEME ?? 'https') === 'https',
        enabledTransports: ['ws', 'wss'],
        authEndpoint: '/broadcasting/auth',
        auth: {
            withCredentials: true,
        },
    });

    return window.Echo;
}

export function disconnectInventoryEcho(): void {
    if (window.Echo) {
        window.Echo.disconnect();
        window.Echo = undefined;
    }
}
