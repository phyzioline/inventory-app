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

/**
 * Reverb sits behind nginx on a sub-path (e.g. /reverb) rather than the
 * domain root, since the standalone app's public HTTPS port is shared with
 * the rest of the site. Empty string is fine when Reverb *is* served from
 * the root (e.g. local dev with `artisan reverb:start`).
 */
function reverbPath(): string {
    return import.meta.env.VITE_REVERB_PATH ?? '';
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
        wsPath: reverbPath(),
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
