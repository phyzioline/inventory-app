import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string | undefined, currency: string = 'EGP') {
  const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (numericAmount === undefined || isNaN(numericAmount)) return '-';

  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: currency,
  }).format(numericAmount);
}

/**
 * Western digits + en-US grouping (e.g. 7,100). Use for money/qty in Arabic invoice UIs
 * so amounts stay easy to read next to Arabic labels.
 */
export function formatLatinNumber(
  value: number | string | undefined | null,
  options?: Intl.NumberFormatOptions
): string {
  const raw = typeof value === 'string' ? Number.parseFloat(value) : Number(value ?? 0);
  const n = Number.isFinite(raw) ? raw : 0;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...options,
  });
}

export function formatDate(date: string | Date | undefined, formatStr: string = 'MMM dd, yyyy') {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';

  // Using native formatter to avoid date-fns dependency if not strictly needed, 
  // but let's stick to simple strings or Intl for basic stuff if we want to minimize deps.
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Returns a URL suitable for img src that works with external images (Amazon, etc).
 * Uses proxy for external URLs to bypass CORS / hotlink blocking.
 */
export function getProductImageSrc(url: string | null | undefined): string {
  if (!url || !url.trim()) return '';
  let u = url.trim();
  // Relative URLs or same-origin - use as-is
  if (u.startsWith('/') || u.startsWith('data:')) return u;

  // Normalize common pasted URLs without protocol.
  if (!u.startsWith('http://') && !u.startsWith('https://') && u.startsWith('www.')) {
    u = `https://${u}`;
  }

  if (u.startsWith('http://') || u.startsWith('https://')) {
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.toLowerCase();
      const isDirectImage =
        /\.(avif|webp|png|jpe?g|gif|bmp|svg)$/i.test(path) ||
        path.includes('/images/i/');

      // Direct image URLs should be loaded directly first (especially Amazon CDN image links).
      if (isDirectImage) {
        return u;
      }

      // Proxy only hosts that often block hotlinking.
      const shouldProxy =
        host.includes('amazon.') ||
        host.includes('media-amazon.') ||
        host.includes('ssl-images-amazon.') ||
        host.includes('noon.');

      return shouldProxy
        ? `/api/inventory/image-proxy?url=${encodeURIComponent(u)}`
        : u;
    } catch {
      return u;
    }
  }
  return u;
}
export function formatProductLabel(product: any) {
  if (!product) return '';
  const id = String(product.id || '').padStart(3, '0');
  // Handle different property names from Laravel vs Supabase interfaces
  const name = product.internal_name || product.product_name || product.name || 'Unnamed';
  return `${name} - PHYZ${id}`;
}
