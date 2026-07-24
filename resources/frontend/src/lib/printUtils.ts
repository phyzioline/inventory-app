import { formatLatinNumber } from '@/lib/utils';
import {
  formatCustomerCollectionDescription,
  formatCustomerLedgerRowDescription,
  formatSupplierLedgerRowDescription,
  formatSupplierPaymentDescription,
} from '@/lib/statementLedgerLabels';

type PrintableRow = Array<string | number | null | undefined>;

type PrintSection = {
    title: string;
    columns: string[];
    rows: PrintableRow[];
};

export type CompanyBranding = {
    logoUrl?: string;
    companyName: string;
    tagline?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    primaryColor?: string;
};

/** Teal from brand logo — table headers, accents, total bar (replaces legacy blue). */
export const PHYZIOLINE_BRAND_PRIMARY = '#007179';

/** Default Phyzioline header/footer text for all print templates (can override per call). */
export const PHYZIOLINE_PRINT_DEFAULTS = {
    /** Short name in print footer; invoice letterhead uses logo only (no large title). */
    companyName: 'Phyzioline',
    tagline: 'PHYSICAL THERAPY SOFTWARE SOLUTION',
    /** Arabic address — line breaks handled in CSS */
    address:
        'فيزيولاين، بجوار هايبر ماركت العيلة، شارع 22، الشيخ زايد، الإسماعيلية 3، محافظة الإسماعيلية 42613',
    phone: '01022374414 · 01122562029',
    email: 'phyzioline@gmail.com',
    website: 'https://phyzioline.com',
} as const;

type BrandHeaderVariant = 'default' | 'purchaseCompact' | 'letterheadLogo';

type PrintPayload = {
    title: string;
    subtitle?: string;
    sections: PrintSection[];
    rtl?: boolean;
    /** When set, renders company header (logo + contacts) above the document title. */
    branding?: Partial<CompanyBranding>;
    /** Inline logo + company row; structured Address / Phone / Email below (sales & purchase). */
    headerVariant?: BrandHeaderVariant;
    /** Smaller margins & table cells (e.g. sales invoice). */
    compactLayout?: boolean;
};

const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/** Safe hex for inline print CSS (accent bars); falls back if branding is not #RRGGBB. */
function cssPrintAccentHex(input: string | undefined, fallback: string = PHYZIOLINE_BRAND_PRIMARY): string {
    const s = String(input || '').trim();
    return /^#[0-9A-Fa-f]{6}$/i.test(s) ? s : fallback;
}

const toCell = (value: string | number | null | undefined) => escapeHtml(String(value ?? '-'));

function formatMoney(n: number | string | undefined | null, _rtl: boolean): string {
    return formatLatinNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Print header lines: date only (no 00:00:00). */
function formatPrintDateOnly(value: unknown, rtl: boolean): string {
    if (value === null || value === undefined || value === '') {
        return '—';
    }
    const d = new Date(value as string);
    if (Number.isNaN(d.getTime())) {
        return escapeHtml(String(value));
    }
    return escapeHtml(d.toLocaleDateString(rtl ? 'ar-EG' : 'en-US'));
}

/** Shared styles for purchase + sales professional invoice prints. */
function getProfessionalInvoiceCompactCss(brandPrimary: string = PHYZIOLINE_BRAND_PRIMARY): string {
    const bar = cssPrintAccentHex(brandPrimary);
    return `
        body { font-size: 12px !important; margin: 12px 14px !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-brand--compact-header { margin-bottom: 10px !important; }
        .doc-brand--compact-header .brand-logo--compact { max-height: 42px !important; max-width: 170px !important; }
        .doc-brand--compact-header .company-name--centered { font-size: 1.12rem !important; }
        .doc-brand--letterhead-logo { margin-bottom: 6px !important; }
        .doc-brand--letterhead-logo .brand-logo-wrap { margin: 0 0 8px !important; }
        .doc-brand--letterhead-logo .brand-logo--letterhead { max-height: 108px !important; max-width: 340px !important; }
        .doc-brand--letterhead-logo .brand-rule--after-title.brand-rule--letterhead { margin: 12px auto 8px !important; max-width: 520px; height: 2px; background: linear-gradient(90deg, transparent 0%, rgba(0,113,121,0.2) 35%, rgba(0,113,121,0.35) 50%, rgba(0,113,121,0.2) 65%, transparent 100%); border: 0; }
        .doc-title--purchase { font-size: 1.22rem !important; margin: 8px 0 5px !important; }
        .meta-grid--compact { gap: 3px 14px !important; margin: 4px 0 8px !important; font-size: 11px !important; }
        .meta-extra-line { font-size: 11px; margin: -4px 0 8px; color: #4b5563; line-height: 1.4; }
        table.invoice-lines { margin-top: 6px !important; border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden; }
        table.invoice-lines th, table.invoice-lines td { padding: 3px 6px !important; font-size: 10.5px !important; line-height: 1.22; }
        table.invoice-lines th { padding: 6px 6px !important; font-size: 10px !important; border-color: rgba(255,255,255,0.22) !important; }
        .cell-sku-sub { font-size: 9px !important; margin-top: 1px; }
        .totals-box--purchase { padding: 8px 12px !important; margin-top: 8px !important; max-width: 360px !important; border-radius: 6px; border-color: #e2e8f0; }
        .totals-box--purchase > table:first-child td { padding: 2px 0 !important; font-size: 11px !important; }
        .totals-box--purchase > table:first-child tr.totals-grand-bar td { background: ${bar} !important; color: #fff !important; border: none !important; padding: 10px 8px !important; font-weight: 700 !important; font-size: 12px !important; }
        .totals-box--purchase > table:first-child tr.totals-grand-bar td.num { font-size: 1.05rem !important; }
        .totals-box--purchase .grand { font-size: 1rem !important; }
        table.account-summary-print { width: 100%; margin-top: 10px; padding-top: 8px; border-top: 1px dashed #d1d5db; border-collapse: collapse; }
        table.account-summary-print td { border: none; padding: 4px 0 !important; font-size: 11px; }
        .acct-hint { font-size: 9px; color: #9ca3af; font-weight: 400; }
        .acct-remaining td { padding-top: 6px !important; border-top: 1px solid #e5e7eb; }
        .signatures--purchase { margin-top: 18px !important; padding-top: 10px !important; font-size: 11px !important; }
    `;
}

export function getDefaultPrintBranding(overrides?: Partial<CompanyBranding>): CompanyBranding {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const logoPng = origin ? `${origin}/web/assets/images/phyzioline-logo.png` : undefined;
    const logoSvg = origin ? `${origin}/web/assets/images/LOGO PHYSIOLINE SVG 1.svg` : undefined;
    const fallbackLogo = logoPng || logoSvg;
    const base: CompanyBranding = {
        companyName: PHYZIOLINE_PRINT_DEFAULTS.companyName,
        tagline: PHYZIOLINE_PRINT_DEFAULTS.tagline,
        address: PHYZIOLINE_PRINT_DEFAULTS.address,
        phone: PHYZIOLINE_PRINT_DEFAULTS.phone,
        email: PHYZIOLINE_PRINT_DEFAULTS.email,
        website: PHYZIOLINE_PRINT_DEFAULTS.website,
        primaryColor: PHYZIOLINE_BRAND_PRIMARY,
        logoUrl: fallbackLogo,
    };
    const merged = { ...base, ...overrides };
    if (overrides && !('logoUrl' in overrides)) {
        merged.logoUrl = fallbackLogo;
    }
    return merged;
}

/** Closing strip: full contact block (address, phone, email, site) — single place to avoid duplicating the header. */
function buildPrintDocumentFooterHtml(branding: CompanyBranding, rtl: boolean): string {
    const direction = rtl ? 'rtl' : 'ltr';
    const primary = escapeHtml(branding.primaryColor || PHYZIOLINE_BRAND_PRIMARY);
    const name = branding.companyName?.trim();
    const addr = branding.address?.trim();
    const phone = branding.phone?.trim();
    const email = branding.email?.trim();
    const web = branding.website?.trim();
    const phoneLab = rtl ? 'الهاتف' : 'Phone';
    const emLab = rtl ? 'البريد' : 'Email';
    const webLab = rtl ? 'الموقع' : 'Website';
    const emWebFooterParts: string[] = [];
    if (email) {
        emWebFooterParts.push(`<span class="print-doc-footer__lbl">${escapeHtml(emLab)}</span> ${escapeHtml(email)}`);
    }
    if (web) {
        emWebFooterParts.push(`<span class="print-doc-footer__lbl">${escapeHtml(webLab)}</span> ${escapeHtml(web)}`);
    }
    const emWebFooter =
        emWebFooterParts.length > 0
            ? `<div class="print-doc-footer__row print-doc-footer__row--muted">${emWebFooterParts.join(
                  ` <span class="print-doc-footer__sep">·</span> `
              )}</div>`
            : '';

    return `
        <footer class="print-doc-footer" style="direction:${direction};">
            <div class="print-doc-footer__rule"></div>
            <div class="print-doc-footer__inner">
                ${name ? `<div class="print-doc-footer__company" style="color:${primary};">${escapeHtml(name)}</div>` : ''}
                ${addr ? `<div class="print-doc-footer__addr">${escapeHtml(addr)}</div>` : ''}
                ${phone ? `<div class="print-doc-footer__row"><span class="print-doc-footer__lbl">${escapeHtml(phoneLab)}</span> ${escapeHtml(phone)}</div>` : ''}
                ${emWebFooter}
            </div>
        </footer>
    `;
}

/**
 * Company letterhead: centered logo, company name, tagline, divider.
 * With `default`, address / phone / email follow in the header (reports).
 * With `letterheadLogo`, contact is omitted here — use {@link buildPrintDocumentFooterHtml} only (invoices).
 */
function buildBrandingHeaderHtml(
    branding: CompanyBranding,
    rtl: boolean,
    variant: BrandHeaderVariant = 'default'
): string {
    const primary = escapeHtml(branding.primaryColor || PHYZIOLINE_BRAND_PRIMARY);
    const direction = rtl ? 'rtl' : 'ltr';
    const compact = variant === 'purchaseCompact';
    const letterhead = variant === 'letterheadLogo';
    const logoSrc = branding.logoUrl ? escapeHtml(branding.logoUrl) : '';
    const logoClass = letterhead
        ? 'brand-logo brand-logo--centered brand-logo--letterhead'
        : compact
          ? 'brand-logo brand-logo--compact brand-logo--centered'
          : 'brand-logo brand-logo--centered';
    const logoBlock = branding.logoUrl
        ? `<div class="brand-logo-wrap"><img class="${logoClass}" src="${logoSrc}" alt="" crossorigin="anonymous" /></div>`
        : '';

    const taglineClass = letterhead ? 'brand-tagline-center brand-tagline--letterhead' : 'brand-tagline-center';
    const taglineHtml = branding.tagline?.trim()
        ? `<div class="${taglineClass}">${escapeHtml(branding.tagline.trim())}</div>`
        : '';

    const addrHtml = branding.address?.trim()
        ? `<div class="brand-line-addr">${escapeHtml(branding.address.trim())}</div>`
        : '';

    const phoneLab = rtl ? 'الهاتف' : 'Phone';
    const phoneHtml = branding.phone?.trim()
        ? `<div class="brand-line-phone"><span class="brand-lbl">${phoneLab}</span> ${escapeHtml(branding.phone.trim())}</div>`
        : '';

    const emLab = rtl ? 'البريد' : 'Email';
    const webLab = rtl ? 'الموقع' : 'Website';
    const emWebParts: string[] = [];
    if (branding.email?.trim()) {
        emWebParts.push(`<span class="brand-lbl">${emLab}</span> ${escapeHtml(branding.email.trim())}`);
    }
    if (branding.website?.trim()) {
        emWebParts.push(`<span class="brand-lbl">${webLab}</span> ${escapeHtml(branding.website.trim())}`);
    }
    const webMailHtml = emWebParts.length
        ? `<div class="brand-line-webmail">${emWebParts.join(` <span class="brand-sep">·</span> `)}</div>`
        : '';

    const headerVariantClass = compact ? ' doc-brand--compact-header' : letterhead ? ' doc-brand--letterhead-logo' : '';

    const contactStackHtml = letterhead
        ? ''
        : `<div class="brand-contact-stack">
                ${addrHtml}
                ${phoneHtml}
                ${webMailHtml}
            </div>`;

    // Letterhead: one rule under title; default/compact: contact + bottom rule
    const bottomRule =
        letterhead
            ? ''
            : `<div class="brand-rule brand-rule--tight"></div>`;

    const letterheadLogoOnly = letterhead && !!branding.logoUrl;
    const titleBlockHtml =
        letterheadLogoOnly
            ? ''
            : `<div class="brand-title-block">
                <div class="company-name company-name--centered" style="color:${primary};">${escapeHtml(branding.companyName)}</div>
                ${taglineHtml}
            </div>`;

    const ruleLetterheadClass = letterheadLogoOnly ? ' brand-rule--letterhead' : '';

    return `
        <header class="doc-brand doc-brand--centered${headerVariantClass}" style="direction:${direction};">
            ${logoBlock}
            ${titleBlockHtml}
            <div class="brand-rule brand-rule--after-title${ruleLetterheadClass}"></div>
            ${contactStackHtml}
            ${bottomRule}
        </header>
    `;
}

/** Parse [PAYMENT] line from batch notes (Laravel purchase invoices). */
function parseBatchPaymentFromNotes(batch: any): { paid: number; remaining: number } {
    const notes = String(batch?.notes || '');
    const line = notes.split(/\r?\n/).find((l) => l.trim().startsWith('[PAYMENT]')) || '';
    const paidM = line.match(/paid=([0-9]+(?:\.[0-9]+)?)/i);
    const remM = line.match(/remaining=([0-9]+(?:\.[0-9]+)?)/i);
    const grand = Number(batch?.grand_total ?? batch?.subtotal ?? batch?.total_amount ?? 0);
    let paid = paidM ? Number(paidM[1]) : Number(batch?.paid_amount ?? 0);
    let remaining = remM ? Number(remM[1]) : Number(batch?.remaining_amount ?? NaN);
    if (!Number.isFinite(remaining)) {
        remaining = Math.max(0, grand - (Number.isFinite(paid) ? paid : 0));
    }
    if (!Number.isFinite(paid)) {
        paid = Math.max(0, grand - remaining);
    }
    return { paid, remaining };
}

/** Rough opening balance: current vendor AP balance minus this invoice's remaining (if vendor loaded). */
function estimateSupplierPreviousBalance(batch: any, invoiceRemaining: number): number | null {
    const cur = batch?.vendor?.current_balance;
    if (cur === null || cur === undefined || cur === '') return null;
    const c = Number(cur);
    if (!Number.isFinite(c) || !Number.isFinite(invoiceRemaining)) return null;
    return c - invoiceRemaining;
}

const basePrintStyles = (direction: 'rtl' | 'ltr', align: string, primaryColor: string) => `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
    body { font-family: Cairo, 'IBM Plex Sans Arabic', Inter, 'Segoe UI', Tahoma, sans-serif; margin: 24px; direction: ${direction}; color: #111827; font-size: 14px; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
    .doc-brand { margin-bottom: 18px; }
    .doc-brand--centered { text-align: center; }
    .brand-logo-wrap { text-align: center; margin: 0 0 12px; }
    .brand-logo--centered { display: inline-block; margin-inline: auto; max-height: 56px; max-width: 220px; object-fit: contain; vertical-align: middle; }
    .brand-logo--letterhead { max-height: 88px; max-width: 280px; }
    .brand-title-block { text-align: center; margin-bottom: 2px; }
    .company-name--centered { font-size: 1.22rem; font-weight: 700; margin: 0; line-height: 1.2; text-align: center; }
    .brand-tagline-center { font-size: 11px; color: #64748b; margin-top: 6px; letter-spacing: 0.04em; text-align: center; max-width: 720px; margin-inline: auto; line-height: 1.45; }
    .brand-rule--after-title { width: 100%; max-width: 480px; height: 1px; background: #e5e7eb; margin: 14px auto 12px; border: 0; }
    .brand-contact-stack { max-width: 720px; margin: 0 auto; text-align: center; font-size: 11px; color: #4b5563; line-height: 1.6; }
    .brand-line-addr { margin-top: 4px; }
    .brand-line-phone { margin-top: 10px; font-size: 11.5px; }
    .brand-line-webmail { margin-top: 8px; font-size: 10.5px; color: #6b7280; }
    .brand-contact-stack .brand-lbl { font-weight: 600; color: #374151; margin-inline-end: 5px; }
    .brand-sep { color: #cbd5e1; font-weight: 400; margin: 0 4px; }
    .brand-rule { height: 1px; background: #e5e7eb; margin-top: 12px; }
    .brand-rule--tight { margin-top: 10px; margin-bottom: 2px; }
    .brand-row { display: flex; align-items: center; gap: 16px; }
    .brand-logo { max-height: 52px; max-width: 200px; object-fit: contain; }
    .company-name { font-weight: 700; font-size: 1.15rem; margin-bottom: 4px; }
    .tagline { color: #4b5563; font-size: 12px; margin-bottom: 4px; }
    .print-doc-footer { margin-top: 40px; padding-top: 6px; break-inside: avoid; page-break-inside: avoid; }
    .print-doc-footer__rule { width: 100%; max-width: 440px; height: 2px; margin: 0 auto 14px; border: 0; border-radius: 2px; background: linear-gradient(90deg, transparent 0%, #e2e8f0 12%, #94a3b8 50%, #e2e8f0 88%, transparent 100%); }
    .print-doc-footer__inner { text-align: center; padding: 0 12px; }
    .print-doc-footer__company { font-weight: 700; font-size: 14px; margin-bottom: 8px; letter-spacing: 0.02em; }
    .print-doc-footer__addr { font-size: 11.5px; color: #374151; line-height: 1.7; max-width: 680px; margin: 0 auto 10px; }
    .print-doc-footer__row { font-size: 11px; color: #4b5563; line-height: 1.65; margin-top: 4px; }
    .print-doc-footer__row--muted { color: #6b7280; font-size: 10.5px; margin-top: 6px; }
    .print-doc-footer__lbl { font-weight: 600; color: #374151; margin-inline-end: 6px; }
    .print-doc-footer__sep { color: #cbd5e1; margin: 0 6px; font-weight: 400; }
    .print-doc-footer__muted { font-size: 10px; color: #6b7280; line-height: 1.65; }
    h1 { margin: 0 0 6px; font-size: 22px; text-align: ${align}; font-weight: 700; }
    .doc-title-centered { text-align: center; font-size: 1.35rem; font-weight: 700; margin: 18px 0 8px; color: ${primaryColor}; }
    .subtitle { margin-bottom: 14px; color: #4b5563; text-align: ${align}; font-size: 12px; }
    .section { margin-top: 18px; }
    h2 { margin: 0 0 8px; font-size: 15px; text-align: ${align}; font-weight: 700; }
    table.data-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    table.data-table th, table.data-table td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: ${align}; font-size: 12px; vertical-align: top; }
    table.data-table th { background: ${primaryColor}; color: #fff; font-weight: 700; }
    table.data-table tbody tr.line-item-row td { background: #fafafa; font-size: 11px; }
    table.data-table .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
    table.data-table .line-desc { color: #374151; font-size: 11px; padding-inline-start: 20px; }
    table.data-table tr.sep td { border: none; height: 8px; background: transparent; padding: 0; }
    table.data-table tr.sep hr { margin: 0; border: none; border-top: 2px solid #e5e7eb; }
    table.data-table .muted { color: #9ca3af; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin: 12px 0 20px; font-size: 12px; }
    .meta-grid b { color: #374151; }
    .totals-box { margin-top: 20px; padding: 12px 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; max-width: 420px; margin-inline-start: auto; }
    .totals-box table { width: 100%; border: none; }
    .totals-box td { border: none; padding: 4px 0; font-size: 13px; }
    .totals-box .grand { font-weight: 700; font-size: 1.05rem; color: ${primaryColor}; }
    .signatures { display: flex; justify-content: space-between; gap: 24px; margin-top: 36px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; }
    .signatures div { flex: 1; text-align: center; }
    .footer-note { margin-top: 16px; font-size: 11px; color: #6b7280; text-align: center; }
    @media print {
        body { margin: 10mm; }
        .section { break-inside: avoid; }
    }
`;

/**
 * Opens a print dialog with raw HTML (popup, then iframe fallback).
 */
export function openPrintHtml(html: string): boolean {
    // Omit noopener so document.write works reliably across browsers; print window has no sensitive opener use.
    const popup = window.open('', '_blank', 'width=1100,height=820');
    if (popup) {
        popup.document.open();
        popup.document.write(html);
        popup.document.close();
        popup.focus();
        return true;
    }

    try {
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.setAttribute('aria-hidden', 'true');
        document.body.appendChild(iframe);

        const frameWindow = iframe.contentWindow;
        const frameDocument = iframe.contentDocument;
        if (!frameWindow || !frameDocument) {
            iframe.remove();
            return false;
        }

        frameDocument.open();
        frameDocument.write(html);
        frameDocument.close();

        // Do not call print() here: the written HTML already triggers print on window.onload.
        // Calling print() immediately caused a second dialog when onload fired (two print prompts).

        const cleanup = () => {
            setTimeout(() => iframe.remove(), 500);
        };

        frameWindow.onafterprint = cleanup;
        setTimeout(cleanup, 2000);
        return true;
    } catch {
        return false;
    }
}

export function printReport(payload: PrintPayload): boolean {
    const direction = payload.rtl ? 'rtl' : 'ltr';
    const align = payload.rtl ? 'right' : 'left';
    const brandingFull = payload.branding
        ? getDefaultPrintBranding(payload.branding)
        : getDefaultPrintBranding();
    const primaryColor = brandingFull.primaryColor ?? PHYZIOLINE_BRAND_PRIMARY;

    const sectionsHtml = payload.sections
        .map((section) => {
            const head = section.columns.map((col) => `<th>${escapeHtml(col)}</th>`).join('');
            const body = section.rows.length
                ? section.rows
                    .map((row, ridx) => {
                        const zebra = ridx % 2 === 1 ? ' class="zebra"' : '';
                        return `<tr${zebra}>${row.map((cell) => `<td>${toCell(cell)}</td>`).join('')}</tr>`;
                    })
                    .join('')
                : `<tr><td colspan="${section.columns.length}">${escapeHtml(
                    payload.rtl ? 'لا توجد بيانات' : 'No data'
                )}</td></tr>`;

            return `
                <section class="section">
                    <h2>${escapeHtml(section.title)}</h2>
                    <table class="data-table">
                        <thead><tr>${head}</tr></thead>
                        <tbody>${body}</tbody>
                    </table>
                </section>
            `;
        })
        .join('');

    const headerVariant: BrandHeaderVariant = payload.headerVariant ?? 'default';
    const headerBlock = buildBrandingHeaderHtml(brandingFull, !!payload.rtl, headerVariant);
    const footerBlock = buildPrintDocumentFooterHtml(brandingFull, !!payload.rtl);

    const compactExtraCss = payload.compactLayout
        ? `
        body { font-size: 12px !important; margin: 12px 14px !important; }
        h1 { font-size: 1.2rem !important; margin: 8px 0 4px !important; }
        .subtitle { font-size: 11px !important; margin-bottom: 10px !important; line-height: 1.4; }
        .section { margin-top: 12px !important; }
        h2 { font-size: 13px !important; margin-bottom: 6px !important; }
        table.data-table th, table.data-table td { padding: 4px 7px !important; font-size: 10.5px !important; line-height: 1.25; }
        table.data-table th { font-size: 10px !important; padding: 5px 7px !important; }
    `
        : '';

    const html = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(payload.title)}</title>
            <style>
                ${basePrintStyles(direction, align, primaryColor)}
                table.data-table tbody tr.zebra { background: #f3f4f6; }
                ${headerVariant === 'purchaseCompact' ? getProfessionalInvoiceCompactCss(primaryColor) : ''}
                ${compactExtraCss}
            </style>
        </head>
        <body>
            ${headerBlock}
            <h1>${escapeHtml(payload.title)}</h1>
            ${payload.subtitle ? `<div class="subtitle">${escapeHtml(payload.subtitle)}</div>` : ''}
            ${sectionsHtml}
            ${footerBlock}
            <script>
                window.onload = function () {
                    window.print();
                    window.onafterprint = function () { window.close(); };
                };
            </script>
        </body>
        </html>
    `;

    return openPrintHtml(html);
}

/** Labels for {@link printQuotationProfessional} (pass through {@link buildQuotationPrintLabels}). */
export type QuotationProfessionalPrintLabels = {
    title: string;
    referenceNo: string;
    date: string;
    customer: string;
    validUntil: string;
    status: string;
    hash: string;
    product: string;
    qty: string;
    unitPrice: string;
    lineTotal: string;
    subtotal: string;
    discount: string;
    tax: string;
    grandTotal: string;
    notes: string;
    receivedBy: string;
    secondSign: string;
    footerNote: string;
};

/** Build quotation print labels from app `t()` (same keys as sales invoice table where possible). */
export function buildQuotationPrintLabels(t: (key: string) => string): QuotationProfessionalPrintLabels {
    return {
        title: t('quotations.printTitle'),
        referenceNo: t('quotations.printReference'),
        date: t('common.date'),
        customer: t('sales.dialog.customer'),
        validUntil: t('quotations.printValidUntil'),
        status: t('quotations.printStatusLabel'),
        hash: '#',
        product: t('table.product'),
        qty: t('sales.qty'),
        unitPrice: t('purchases.dialog.unitPrice'),
        lineTotal: t('purchases.dialog.total'),
        subtotal: t('purchases.dialog.subtotal'),
        discount: t('quotations.printDiscount'),
        tax: t('purchases.dialog.tax'),
        grandTotal: t('purchases.dialog.grandTotal'),
        notes: t('quotations.printNotes'),
        receivedBy: t('quotations.printSigner1'),
        secondSign: t('quotations.printSigner2'),
        footerNote: t('quotations.printNotPaymentDoc'),
    };
}

/**
 * Price quotation print — same visual system as {@link printSalesInvoiceProfessional}
 * (compact brand header, meta grid, invoice line table, totals box, signatures).
 * Omits the sales “paid / remaining” account block; shows a quotation disclaimer instead.
 */
export function printQuotationProfessional(params: {
    rtl: boolean;
    branding?: Partial<CompanyBranding>;
    /** Quotation API record (or a minimal object for drafts). */
    quotation: any;
    /** When set, these lines are used instead of `quotation.items` (e.g. unsaved draft rows). */
    itemsOverride?: any[];
    metaExtraLine?: string;
    labels: QuotationProfessionalPrintLabels;
}): boolean {
    const { rtl, quotation, labels } = params;
    const b = getDefaultPrintBranding(params.branding);
    const direction = rtl ? 'rtl' : 'ltr';
    const align = rtl ? 'right' : 'left';

    const items = Array.isArray(params.itemsOverride)
        ? params.itemsOverride
        : Array.isArray(quotation?.items)
          ? quotation.items
          : [];

    const refNo = String(
        quotation?.reference_number ?? (quotation?.id != null ? `#${quotation.id}` : '—')
    );

    const fourthHasDate = quotation?.valid_until != null && String(quotation.valid_until).trim() !== '';
    const fourthLabel = fourthHasDate ? labels.validUntil : labels.status;
    const fourthValue = fourthHasDate
        ? formatPrintDateOnly(quotation.valid_until, rtl)
        : escapeHtml(String(quotation?.status ?? '—'));

    const rows: string[] = [];
    items.forEach((item: any, idx: number) => {
        const name =
            item?.product_name ||
            item?.name ||
            item?.master_product?.internal_name ||
            item?.masterProduct?.internal_name ||
            item?.sku?.offer?.masterProduct?.internal_name ||
            item?.sku?.offer?.master_product?.internal_name ||
            item?.sku?.name ||
            item?.raw_description ||
            '—';
        const sku =
            item?.sku?.sku ||
            item?.sku_code ||
            item?.sku?.code ||
            (typeof item?.sku === 'string' ? item.sku : null) ||
            '—';
        const qty = Number(item?.quantity ?? 0);
        const unit = Number(item?.unit_price ?? 0);
        const line = Number(item?.total_price ?? item?.total ?? qty * unit);
        const zebra = idx % 2 === 1 ? ' class="zebra"' : '';
        rows.push(`
            <tr${zebra}>
                <td class="num">${formatLatinNumber(idx + 1, { maximumFractionDigits: 0 })}</td>
                <td>${escapeHtml(String(name))}<div class="muted cell-sku-sub">SKU: ${escapeHtml(String(sku))}</div></td>
                <td class="num">${formatLatinNumber(qty, { maximumFractionDigits: 3 })}</td>
                <td class="num">${formatMoney(unit, rtl)}</td>
                <td class="num">${formatMoney(line, rtl)}</td>
            </tr>
        `);
    });

    let lineSum = 0;
    items.forEach((item: any) => {
        const qty = Number(item?.quantity ?? 0);
        const unit = Number(item?.unit_price ?? 0);
        lineSum += Number(item?.total_price ?? item?.total ?? qty * unit);
    });

    const subtotal = Number(quotation?.subtotal ?? lineSum);
    const discount = Number(quotation?.discount_amount ?? quotation?.discount ?? 0);
    const tax = Number(quotation?.tax_amount ?? quotation?.tax ?? 0);
    const grand = Number(quotation?.total_amount ?? quotation?.grand_total ?? lineSum);

    const metaExtra = params.metaExtraLine?.trim()
        ? `<div class="meta-extra-line" style="direction:${direction};text-align:${align};">${escapeHtml(params.metaExtraLine.trim())}</div>`
        : '';

    const metaHtml = `
        <div class="doc-title-centered doc-title--purchase">${escapeHtml(labels.title)}</div>
        <div class="meta-grid meta-grid--compact" style="direction:${direction}; text-align:${align};">
            <div><b>${escapeHtml(labels.referenceNo)}:</b> ${escapeHtml(refNo)}</div>
            <div><b>${escapeHtml(labels.date)}:</b> ${formatPrintDateOnly(quotation?.quotation_date || quotation?.created_at, rtl)}</div>
            <div><b>${escapeHtml(labels.customer)}:</b> ${escapeHtml(String(quotation?.customer_name ?? '—'))}</div>
            <div><b>${escapeHtml(fourthLabel)}:</b> ${fourthValue}</div>
        </div>
        ${metaExtra}
    `;

    const tableHtml = `
        <table class="data-table invoice-lines">
            <thead>
                <tr>
                    <th>${escapeHtml(labels.hash)}</th>
                    <th>${escapeHtml(labels.product)}</th>
                    <th>${escapeHtml(labels.qty)}</th>
                    <th>${escapeHtml(labels.unitPrice)}</th>
                    <th>${escapeHtml(labels.lineTotal)}</th>
                </tr>
            </thead>
            <tbody>
                ${rows.length ? rows.join('') : `<tr><td colspan="5">${escapeHtml(rtl ? 'لا توجد بنود' : 'No line items')}</td></tr>`}
            </tbody>
        </table>
    `;

    const totalsHtml = `
        <div class="totals-box totals-box--purchase" style="direction:${direction};">
            <table>
                <tr><td>${escapeHtml(labels.subtotal)}</td><td class="num" style="text-align:${align};">${formatMoney(subtotal, rtl)}</td></tr>
                <tr><td>${escapeHtml(labels.discount)}</td><td class="num" style="text-align:${align};">${formatMoney(discount, rtl)}</td></tr>
                <tr><td>${escapeHtml(labels.tax)}</td><td class="num" style="text-align:${align};">${formatMoney(tax, rtl)}</td></tr>
                <tr class="totals-grand-bar"><td class="grand">${escapeHtml(labels.grandTotal)}</td><td class="num grand" style="text-align:${align};">${formatMoney(grand, rtl)}</td></tr>
            </table>
            <div class="footer-note" style="margin-top:10px;text-align:${align};line-height:1.45;">${escapeHtml(labels.footerNote)}</div>
        </div>
    `;

    const notes = String(quotation?.notes || '').trim();
    const footHtml = `
        <div class="signatures signatures--purchase" style="direction:${direction};">
            <div>${escapeHtml(labels.receivedBy)}<br /><br />_____________</div>
            <div>${escapeHtml(labels.secondSign)}<br /><br />_____________</div>
        </div>
        ${notes ? `<div class="footer-note"><b>${escapeHtml(labels.notes)}:</b> ${escapeHtml(notes)}</div>` : ''}
    `;

    const html = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(labels.title)} — ${escapeHtml(refNo)}</title>
            <style>
                ${basePrintStyles(direction, align, b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)}
                table.data-table tbody tr.zebra { background: #f3f4f6; }
                ${getProfessionalInvoiceCompactCss(b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)}
            </style>
        </head>
        <body>
            ${buildBrandingHeaderHtml(b, rtl, 'letterheadLogo')}
            ${metaHtml}
            ${tableHtml}
            ${totalsHtml}
            ${footHtml}
            ${buildPrintDocumentFooterHtml(b, rtl)}
            <script>
                window.onload = function () {
                    window.print();
                    window.onafterprint = function () { window.close(); };
                };
            </script>
        </body>
        </html>
    `;

    return openPrintHtml(html);
}

export type SupplierStatementRow = {
    date?: string;
    description?: string;
    debit?: number;
    credit?: number;
    balance?: number;
    source?: string;
    source_id?: number;
};

export type SupplierStatementInvoice = {
    id: number;
    invoice_number?: string;
    date?: string;
    total?: number;
    paid?: number;
    remaining?: number;
    status?: string;
    items?: Array<{
        product_name?: string | null;
        sku_code?: string | null;
        quantity?: number;
        unit_price?: number;
        total_price?: number;
    }>;
};

export function printCustomerStatement(params: {
    rtl: boolean;
    branding?: Partial<CompanyBranding>;
    customerName: string;
    customerId?: string | number;
    dateFrom?: string;
    dateTo?: string;
    invoices: Array<{
        id: number | string;
        invoice_number?: string;
        date?: string;
        total?: number;
        paid?: number;
        remaining?: number;
        status?: string;
        items?: Array<{
            product_name?: string | null;
            sku_code?: string | null;
            quantity?: number;
            unit_price?: number;
            total_price?: number;
        }>;
    }>;
    receipts: Array<{
        id: number | string;
        date?: string;
        amount?: number;
        method?: string;
        reference?: string;
        notes?: string;
    }>;
    /** Pre-computed backend ledger — when provided, used directly (avoids double-counting). */
    ledger?: Array<{
        date?: string;
        description?: string;
        debit?: number;
        credit?: number;
        balance?: number;
        source?: string;
        source_id?: string | number;
    }>;
}): boolean {
    const { rtl, customerName, customerId, dateFrom, dateTo, invoices, receipts } = params;
    const b = getDefaultPrintBranding(params.branding);
    const direction = rtl ? 'rtl' : 'ltr';
    const align = rtl ? 'right' : 'left';
    const oAlign = rtl ? 'left' : 'right';
    const printDate =
        typeof window !== 'undefined'
            ? new Date().toLocaleString(rtl ? 'ar-EG' : 'en-US')
            : '';

    const L = {
        docTitle: rtl ? 'كشف حساب عميل' : 'Customer Account Statement',
        customer: rtl ? 'اسم العميل' : 'Customer',
        code: rtl ? 'رقم العميل' : 'Customer ref.',
        period: rtl ? 'الفترة' : 'Period',
        printed: rtl ? 'تاريخ الطباعة' : 'Printed at',
        all: rtl ? 'كل الفترات' : 'All dates',
        colSeq: rtl ? 'م' : '#',
        colDesc: rtl ? 'البيان' : 'Description',
        colDebit: rtl ? 'مدين' : 'Debit',
        colCredit: rtl ? 'دائن' : 'Credit',
        colBalance: rtl ? 'الرصيد' : 'Balance',
        colDate: rtl ? 'التاريخ' : 'Date',
        itemSeq: rtl ? 'م' : '#',
        itemName: rtl ? 'إسم الصنف' : 'Product',
        itemUnit: rtl ? 'النوع' : 'Unit',
        itemQty: rtl ? 'الكمية' : 'Qty',
        itemPrice: rtl ? 'السعر' : 'Price',
        itemDiscount: rtl ? 'الخصم' : 'Disc.',
        itemTotal: rtl ? 'الإجمالي' : 'Total',
        subtotalLabel: rtl ? 'إجمالي الفاتورة' : 'Invoice total',
        remainingLabel: rtl ? 'المتبقي' : 'Remaining',
        totalDebit: rtl ? 'إجمالي المدين' : 'Total debit',
        totalCredit: rtl ? 'إجمالي الدائن' : 'Total credit',
        finalBal: rtl ? 'الرصيد النهائي' : 'Closing balance',
    };

    // Build combined chronological ledger
    type Entry = {
        seq: number;
        date: string;
        description: string;
        debit: number;
        credit: number;
        balance: number;
        source: 'invoice' | 'payment' | 'receipt';
        items?: any[];
        invoiceTotal?: number;
        invoiceRemaining?: number;
    };

    // Invoice map for item lookup (used by both ledger paths)
    const invItemMap = new Map<string, (typeof invoices)[0]>();
    for (const inv of invoices) {
        invItemMap.set(String(inv.id), inv);
    }

    let totalDebit = 0;
    let totalCredit = 0;
    let entries: Entry[];

    if (Array.isArray(params.ledger) && params.ledger.length > 0) {
        // Use backend pre-computed ledger — already correct (no double-counting)
        let running = 0;
        entries = params.ledger.map((row: any, i: number) => {
            const debit = Number(row.debit ?? 0);
            const credit = Number(row.credit ?? 0);
            running += debit - credit;
            totalDebit += debit;
            totalCredit += credit;
            const src = String(row.source ?? '');
            const isInv = src === 'invoice';
            const invData = isInv ? invItemMap.get(String(row.source_id ?? '')) : undefined;
            return {
                seq: i + 1,
                date: String(row.date ?? ''),
                description: formatCustomerLedgerRowDescription(row, params.customerName ?? '', rtl),
                debit,
                credit,
                balance: Math.round(running * 100) / 100,
                source: (isInv ? 'invoice' : src === 'order_payment' ? 'payment' : 'receipt') as Entry['source'],
                items: invData?.items,
                invoiceTotal: invData?.total,
                invoiceRemaining: invData?.remaining,
            };
        });
    } else {
        // Fallback: build from invoices + receipts arrays
        const raw: Omit<Entry, 'seq' | 'balance'>[] = [];

        for (const inv of invoices) {
            raw.push({
                date: String(inv.date ?? ''),
                description: (rtl ? 'من فاتورة مبيعات رقم ' : 'Sales Invoice #') + String(inv.invoice_number ?? inv.id),
                debit: Number(inv.total ?? 0),
                credit: 0,
                source: 'invoice',
                items: Array.isArray(inv.items) ? inv.items : [],
                invoiceTotal: Number(inv.total ?? 0),
                invoiceRemaining: Number(inv.remaining ?? 0),
            });
            const paid = Number(inv.paid ?? 0);
            if (paid > 0.00001) {
                raw.push({
                    date: String(inv.date ?? ''),
                    description: formatCustomerCollectionDescription(
                        params.customerName ?? '',
                        inv.invoice_number ?? inv.id,
                        rtl
                    ),
                    debit: 0,
                    credit: paid,
                    source: 'payment',
                });
            }
        }

        for (const r of receipts) {
            raw.push({
                date: String(r.date ?? ''),
                description: formatCustomerCollectionDescription(params.customerName ?? '', r.reference, rtl),
                debit: 0,
                credit: Number(r.amount ?? 0),
                source: 'receipt',
            });
        }

        raw.sort((a, b) => {
            if (a.date < b.date) return -1;
            if (a.date > b.date) return 1;
            const order = { invoice: 0, payment: 1, receipt: 2 };
            return (order[a.source] ?? 3) - (order[b.source] ?? 3);
        });

        let running = 0;
        entries = raw.map((e, i) => {
            running += e.debit - e.credit;
            totalDebit += e.debit;
            totalCredit += e.credit;
            return { ...e, seq: i + 1, balance: Math.round(running * 100) / 100 };
        });
    }
    const closing = entries.length > 0 ? entries[entries.length - 1].balance : 0;

    const rowsHtml: string[] = [];
    for (const row of entries) {
        const isInv = row.source === 'invoice';
        const isPay = row.source === 'payment' || row.source === 'receipt';
        const mainBg = isInv
            ? ' style="background:#f0f4ff;"'
            : isPay ? ' style="background:#f0fff4;"' : '';

        if (isInv && Array.isArray(row.items) && row.items.length > 0) {
            const itemRowsInner = row.items.map((item: any, idx: number) => `
                <tr>
                    <td class="ni-num">${idx + 1}</td>
                    <td class="ni-name">${escapeHtml(String(item.product_name || item.sku_code || '—'))}</td>
                    <td class="ni-num">${escapeHtml(String(Number(item.quantity ?? 0).toLocaleString()))}</td>
                    <td class="ni-num">${formatMoney(item.unit_price, rtl)}</td>
                    <td class="ni-num">${formatMoney(item.total_price, rtl)}</td>
                </tr>
            `).join('');
            rowsHtml.push(`
                <tr class="items-nest-row">
                    <td colspan="6" style="padding:0 12px 0 12px; background:#f8fafc; border-bottom:none; border-top:1px solid #e2e8f0;">
                        <table class="nested-items-table" style="direction:${direction};">
                            <thead>
                                <tr>
                                    <th class="ni-num">${escapeHtml(L.itemSeq)}</th>
                                    <th class="ni-name">${escapeHtml(L.itemName)}</th>
                                    <th class="ni-num">${escapeHtml(L.itemQty)}</th>
                                    <th class="ni-num">${escapeHtml(L.itemPrice)}</th>
                                    <th class="ni-num">${escapeHtml(L.itemTotal)}</th>
                                </tr>
                            </thead>
                            <tbody>${itemRowsInner}</tbody>
                        </table>
                    </td>
                </tr>
                <tr class="inv-summary-row">
                    <td colspan="6" style="padding:6px 12px; background:#f8fafc; border-bottom:none;">
                        <div class="inv-summary-boxes" style="direction:${direction};">
                            <div class="inv-sum-box inv-sum-total">
                                <span class="isb-label">${escapeHtml(L.subtotalLabel)}</span>
                                <span class="isb-value">${formatMoney(row.invoiceTotal ?? 0, rtl)}</span>
                            </div>
                            <div class="inv-sum-box inv-sum-remaining">
                                <span class="isb-label">${escapeHtml(L.remainingLabel)}</span>
                                <span class="isb-value">${formatMoney(row.invoiceRemaining ?? 0, rtl)}</span>
                            </div>
                        </div>
                    </td>
                </tr>
            `);
        }

        rowsHtml.push(`
            <tr${mainBg} style="border-top:2px solid #c7d2fe;">
                <td class="num">${row.seq}</td>
                <td style="font-weight:${isInv ? '600' : 'normal'}; color:${isInv ? '#1d4ed8' : isPay ? '#15803d' : 'inherit'};">
                    ${escapeHtml(row.description)}
                </td>
                <td class="num">${row.debit > 0 ? formatMoney(row.debit, rtl) : '—'}</td>
                <td class="num">${row.credit > 0 ? formatMoney(row.credit, rtl) : '—'}</td>
                <td class="num" style="font-weight:600;">${formatMoney(row.balance, rtl)}</td>
                <td class="num" style="font-size:0.78em;">${escapeHtml(row.date)}</td>
            </tr>
        `);
    }

    const periodLabel = dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : L.all;

    const metaHtml = `
        <div class="meta-grid" style="direction:${direction}; text-align:${align};">
            <div><b>${escapeHtml(L.customer)}:</b> ${escapeHtml(customerName)}</div>
            <div><b>${escapeHtml(L.code)}:</b> ${escapeHtml(String(customerId ?? '—'))}</div>
            <div><b>${escapeHtml(L.period)}:</b> ${escapeHtml(periodLabel)}</div>
            <div><b>${escapeHtml(L.printed)}:</b> ${escapeHtml(printDate)}</div>
        </div>
        <div class="doc-title-centered" style="color:${escapeHtml(b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)};">${escapeHtml(L.docTitle)}</div>
    `;

    const tableHtml = `
        <table class="data-table">
            <thead>
                <tr>
                    <th style="width:32px">${escapeHtml(L.colSeq)}</th>
                    <th>${escapeHtml(L.colDesc)}</th>
                    <th>${escapeHtml(L.colDebit)}</th>
                    <th>${escapeHtml(L.colCredit)}</th>
                    <th>${escapeHtml(L.colBalance)}</th>
                    <th>${escapeHtml(L.colDate)}</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml.length
                    ? rowsHtml.join('')
                    : `<tr><td colspan="6">${escapeHtml(rtl ? 'لا توجد حركات' : 'No movements')}</td></tr>`}
            </tbody>
        </table>
    `;

    const totalsHtml = `
        <div class="totals-box" style="direction:${direction};">
            <table>
                <tr><td>${escapeHtml(L.totalDebit)}</td><td class="num" style="text-align:${align};">${formatMoney(totalDebit, rtl)}</td></tr>
                <tr><td>${escapeHtml(L.totalCredit)}</td><td class="num" style="text-align:${align};">${formatMoney(totalCredit, rtl)}</td></tr>
                <tr><td class="grand">${escapeHtml(L.finalBal)}</td><td class="num grand" style="text-align:${align};">${formatMoney(closing, rtl)}</td></tr>
            </table>
        </div>
    `;

    const html = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(L.docTitle)} — ${escapeHtml(customerName)}</title>
            <style>
                ${basePrintStyles(direction, align, b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)}
                /* nested items table */
                table.nested-items-table {
                    width: 68%;
                    border-collapse: collapse;
                    font-size: 0.71em;
                    margin: 4px 0;
                }
                table.nested-items-table thead tr th {
                    background: #dde3f0;
                    color: #374151;
                    font-weight: 700;
                    padding: 3px 7px;
                    border: 1px solid #c4cde0;
                    white-space: nowrap;
                }
                table.nested-items-table tbody tr td {
                    background: #fff;
                    color: #4b5563;
                    padding: 2px 7px;
                    border: 1px solid #e2e8f0;
                }
                table.nested-items-table tbody tr:nth-child(even) td { background: #f8fafc; }
                .ni-num { text-align: center; width: 48px; }
                .ni-name { text-align: ${align}; }
                /* invoice summary boxes */
                .inv-summary-boxes {
                    display: flex;
                    gap: 10px;
                    justify-content: flex-end;
                    padding: 3px 0;
                }
                .inv-sum-box {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 14px;
                    border-radius: 6px;
                    font-size: 0.82em;
                    border: 1px solid;
                }
                .inv-sum-total { background:#eff6ff; border-color:#bfdbfe; color:#1e40af; }
                .inv-sum-remaining { background:#fff7ed; border-color:#fed7aa; color:#c2410c; }
                .isb-label { font-weight: 400; opacity: 0.8; margin-left: 4px; }
                .isb-value { font-weight: 700; font-size: 1.05em; }
                ${getProfessionalInvoiceCompactCss(b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)}
            </style>
        </head>
        <body>
            ${buildBrandingHeaderHtml(b, rtl, 'letterheadLogo')}
            ${metaHtml}
            ${tableHtml}
            ${totalsHtml}
            ${buildPrintDocumentFooterHtml(b, rtl)}
            <script>
                window.onload = function () {
                    window.print();
                    window.onafterprint = function () { window.close(); };
                };
            </script>
        </body>
        </html>
    `;

    return openPrintHtml(html);
}

export function printSupplierStatement(params: {
     dateFrom?: string;
    dateTo?: string;
    ledger: SupplierStatementRow[];
    invoices: SupplierStatementInvoice[];
    includeLineItems: boolean;
}): boolean {
    const { rtl, supplierName, supplierCode, dateFrom, dateTo, invoices } = params;
    const b = getDefaultPrintBranding(params.branding);
    const direction = rtl ? 'rtl' : 'ltr';
    const align = rtl ? 'right' : 'left';
    const printDate =
        typeof window !== 'undefined'
            ? new Date().toLocaleString(rtl ? 'ar-EG' : 'en-US')
            : '';

    const invMap = new Map<number, SupplierStatementInvoice>();
    for (const inv of invoices) {
        invMap.set(Number(inv.id), inv);
    }

    const L = {
        docTitle: rtl ? 'كشف حساب مورد' : 'Supplier Account Statement',
        supplier: rtl ? 'اسم المورد' : 'Supplier',
        code: rtl ? 'كود المورد' : 'Supplier ref.',
        period: rtl ? 'الفترة' : 'Period',
        printed: rtl ? 'تاريخ الطباعة' : 'Printed at',
        all: rtl ? 'كل الفترات' : 'All dates',
        colSeq: rtl ? 'م' : '#',
        colDesc: rtl ? 'البيان' : 'Description',
        colDebit: rtl ? 'مدين' : 'Debit',
        colCredit: rtl ? 'دائن' : 'Credit',
        colBalance: rtl ? 'الرصيد' : 'Balance',
        colDate: rtl ? 'التاريخ' : 'Date',
        colTime: rtl ? 'الوقت' : 'Time',
        itemSeq: rtl ? 'م' : '#',
        itemName: rtl ? 'اسم الصنف' : 'Product',
        itemUnit: rtl ? 'النوع' : 'Unit',
        itemQty: rtl ? 'الكمية' : 'Qty',
        itemPrice: rtl ? 'السعر' : 'Price',
        itemDiscount: rtl ? 'الخصم' : 'Disc.',
        itemTotal: rtl ? 'الإجمالي' : 'Total',
        subtotalLabel: rtl ? 'الإجمالي' : 'Total',
        remainingLabel: rtl ? 'المتبقي' : 'Remaining',
        totalDebit: rtl ? 'إجمالي المدين' : 'Total debit',
        totalCredit: rtl ? 'إجمالي الدائن' : 'Total credit',
        finalBal: rtl ? 'الرصيد النهائي' : 'Closing balance',
    };

    // Build combined ledger from invoices + payments, sorted by date
    type LedgerEntry = {
        seq: number;
        date: string;
        description: string;
        debit: number;
        credit: number;
        balance: number;
        source: string;
        source_id: string;
        items?: any[];
        invoiceTotal?: number;
        invoiceRemaining?: number;
    };

    const entries: Omit<LedgerEntry, 'seq' | 'balance'>[] = [];

    for (const inv of invoices) {
        entries.push({
            date: String(inv.date ?? ''),
            description: (rtl ? 'من فاتورة شراء رقم ' : 'Purchase Invoice #') + String(inv.invoice_number ?? inv.id),
            debit: Number(inv.total ?? 0),
            credit: 0,
            source: 'invoice',
            source_id: String(inv.id),
            items: Array.isArray(inv.items) ? inv.items : [],
            invoiceTotal: Number(inv.total ?? 0),
            invoiceRemaining: Number((inv as any).remaining ?? 0),
        });
    }

    for (const row of params.ledger) {
        if (String(row.source || '') === 'payment' || (Number(row.credit ?? 0) > 0 && Number(row.debit ?? 0) === 0)) {
            const src = String(row.source || '');
            entries.push({
                date: String(row.date ?? ''),
                description:
                    src === 'payment'
                        ? formatSupplierLedgerRowDescription(row, supplierName ?? '', rtl)
                        : String(row.description ?? ''),
                debit: 0,
                credit: Number(row.credit ?? 0),
                source: 'payment',
                source_id: String(row.source_id ?? ''),
            });
        }
    }

    entries.sort((a, b) => {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return (a.source === 'invoice' ? 0 : 1) - (b.source === 'invoice' ? 0 : 1);
    });

    let running = 0;
    let totalDebit = 0;
    let totalCredit = 0;
    const ledgerRows: LedgerEntry[] = entries.map((e, i) => {
        running += e.debit - e.credit;
        totalDebit += e.debit;
        totalCredit += e.credit;
        return { ...e, seq: i + 1, balance: Math.round(running * 100) / 100 };
    });
    const closing = running;

    const rowsHtml: string[] = [];

    for (const row of ledgerRows) {
        const isInv = row.source === 'invoice';
        const isPay = row.source === 'payment';
        const mainBg = isInv ? ' style="background:#f0f4ff;"' : isPay ? ' style="background:#f0fff4;"' : '';

        if (isInv && Array.isArray(row.items) && row.items.length > 0) {
            const itemRowsInner = row.items.map((item: any, idx: number) => {
                const itemName = item.product_name || item.name || item.product?.name || item.sku_code || item.sku || '—';
                return `
                <tr>
                    <td class="ni-num">${idx + 1}</td>
                    <td class="ni-name">${escapeHtml(String(itemName))}</td>
                    <td class="ni-num">${escapeHtml(String(Number(item.quantity ?? 0).toLocaleString()))}</td>
                    <td class="ni-num">${formatMoney(item.unit_price ?? item.price ?? 0, rtl)}</td>
                    <td class="ni-num">${formatMoney(item.total_price ?? item.subtotal ?? item.total ?? 0, rtl)}</td>
                </tr>
            `}).join('');
            rowsHtml.push(`
                <tr class="items-nest-row">
                    <td colspan="6" style="padding:0 12px 0 12px; background:#f8fafc; border-bottom:none; border-top:1px solid #e2e8f0;">
                        <table class="nested-items-table" style="direction:${direction};">
                            <thead>
                                <tr>
                                    <th class="ni-num">${escapeHtml(L.itemSeq)}</th>
                                    <th class="ni-name">${escapeHtml(L.itemName)}</th>
                                    <th class="ni-num">${escapeHtml(L.itemQty)}</th>
                                    <th class="ni-num">${escapeHtml(L.itemPrice)}</th>
                                    <th class="ni-num">${escapeHtml(L.itemTotal)}</th>
                                </tr>
                            </thead>
                            <tbody>${itemRowsInner}</tbody>
                        </table>
                    </td>
                </tr>
                <tr class="inv-summary-row">
                    <td colspan="6" style="padding:6px 12px; background:#f8fafc; border-bottom:none;">
                        <div class="inv-summary-boxes" style="direction:${direction};">
                            <div class="inv-sum-box inv-sum-total">
                                <span class="isb-label">${escapeHtml(L.subtotalLabel)}</span>
                                <span class="isb-value">${formatMoney(row.invoiceTotal ?? 0, rtl)}</span>
                            </div>
                            <div class="inv-sum-box inv-sum-remaining">
                                <span class="isb-label">${escapeHtml(L.remainingLabel)}</span>
                                <span class="isb-value">${formatMoney(row.invoiceRemaining ?? 0, rtl)}</span>
                            </div>
                        </div>
                    </td>
                </tr>
            `);
        }

        rowsHtml.push(`
            <tr${mainBg} style="${isInv ? 'border-top:2px solid #c7d2fe;' : ''}">
                <td class="num">${row.seq}</td>
                <td style="font-weight:${isInv ? '600' : 'normal'}; color:${isInv ? '#1d4ed8' : isPay ? '#15803d' : 'inherit'};">${escapeHtml(row.description)}</td>
                <td class="num">${row.debit > 0 ? formatMoney(row.debit, rtl) : '—'}</td>
                <td class="num">${row.credit > 0 ? formatMoney(row.credit, rtl) : '—'}</td>
                <td class="num" style="font-weight:600;">${formatMoney(row.balance, rtl)}</td>
                <td class="num" style="font-size:0.78em;">${escapeHtml(row.date)}</td>
            </tr>
        `);
    }

    const periodLabel = dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : L.all;

    const metaHtml = `
        <div class="meta-grid" style="direction:${direction}; text-align:${align};">
            <div><b>${escapeHtml(L.supplier)}:</b> ${escapeHtml(supplierName)}</div>
            <div><b>${escapeHtml(L.code)}:</b> ${escapeHtml(String(supplierCode ?? '—'))}</div>
            <div><b>${escapeHtml(L.period)}:</b> ${escapeHtml(periodLabel)}</div>
            <div><b>${escapeHtml(L.printed)}:</b> ${escapeHtml(printDate)}</div>
        </div>
        <div class="doc-title-centered" style="color:${escapeHtml(b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)};">${escapeHtml(L.docTitle)}</div>
    `;

    const tableHtml = `
        <table class="data-table">
            <thead>
                <tr>
                    <th style="width:32px">${escapeHtml(L.colSeq)}</th>
                    <th>${escapeHtml(L.colDesc)}</th>
                    <th>${escapeHtml(L.colDebit)}</th>
                    <th>${escapeHtml(L.colCredit)}</th>
                    <th>${escapeHtml(L.colBalance)}</th>
                    <th>${escapeHtml(L.colDate)}</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml.length ? rowsHtml.join('') : `<tr><td colspan="6">${escapeHtml(rtl ? 'لا توجد حركات' : 'No movements')}</td></tr>`}
            </tbody>
        </table>
    `;

    const totalsHtml = `
        <div class="totals-box" style="direction:${direction};">
            <table>
                <tr><td>${escapeHtml(L.totalDebit)}</td><td class="num" style="text-align:${align};">${formatMoney(totalDebit, rtl)}</td></tr>
                <tr><td>${escapeHtml(L.totalCredit)}</td><td class="num" style="text-align:${align};">${formatMoney(totalCredit, rtl)}</td></tr>
                <tr><td class="grand">${escapeHtml(L.finalBal)}</td><td class="num grand" style="text-align:${align};">${formatMoney(closing, rtl)}</td></tr>
            </table>
        </div>
    `;

    const html = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(L.docTitle)} — ${escapeHtml(supplierName)}</title>
            <style>
                ${basePrintStyles(direction, align, b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)}
                table.nested-items-table {
                    width: 68%;
                    border-collapse: collapse;
                    font-size: 0.71em;
                    margin: 4px 0;
                }
                table.nested-items-table thead tr th {
                    background: #dde3f0;
                    color: #374151;
                    font-weight: 700;
                    padding: 3px 7px;
                    border: 1px solid #c4cde0;
                    white-space: nowrap;
                }
                table.nested-items-table tbody tr td {
                    background: #fff;
                    color: #4b5563;
                    padding: 2px 7px;
                    border: 1px solid #e2e8f0;
                }
                table.nested-items-table tbody tr:nth-child(even) td { background: #f8fafc; }
                .ni-num { text-align: center; width: 48px; }
                .ni-name { text-align: ${align}; }
                .inv-summary-boxes {
                    display: flex;
                    gap: 10px;
                    justify-content: flex-end;
                    padding: 3px 0;
                }
                .inv-sum-box {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 14px;
                    border-radius: 6px;
                    font-size: 0.82em;
                    border: 1px solid;
                }
                .inv-sum-total { background:#eff6ff; border-color:#bfdbfe; color:#1e40af; }
                .inv-sum-remaining { background:#fff7ed; border-color:#fed7aa; color:#c2410c; }
                .isb-label { font-weight: 400; opacity: 0.8; margin-left: 4px; }
                .isb-value { font-weight: 700; font-size: 1.05em; }
                ${getProfessionalInvoiceCompactCss(b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)}
            </style>
        </head>
        <body>
            ${buildBrandingHeaderHtml(b, rtl, 'letterheadLogo')}
            ${metaHtml}
            ${tableHtml}
            ${totalsHtml}
            ${buildPrintDocumentFooterHtml(b, rtl)}
            <script>
                window.onload = function () {
                    window.print();
                    window.onafterprint = function () { window.close(); };
                };
            </script>
        </body>
        </html>
    `;

    return openPrintHtml(html);
}

export function printPurchaseInvoiceProfessional(params: {
    rtl: boolean;
    branding?: Partial<CompanyBranding>;
    batch: any;
    labels: {
        title: string;
        invoiceNo: string;
        date: string;
        supplier: string;
        supplierRef: string;
        hash: string;
        product: string;
        qty: string;
        unitPrice: string;
        lineTotal: string;
        subtotal: string;
        discount: string;
        tax: string;
        grandTotal: string;
        notes: string;
        receivedBy: string;
        supplierSign: string;
        /** الحساب السابق / Previous balance */
        accountPrevious?: string;
        paid?: string;
        remaining?: string;
        accountPreviousHint?: string;
    };
}): boolean {
    const { rtl, batch, labels } = params;
    const b = getDefaultPrintBranding(params.branding);
    const direction = rtl ? 'rtl' : 'ltr';
    const align = rtl ? 'right' : 'left';
    const items = Array.isArray(batch?.items) ? batch.items : [];

    const lblPrev = labels.accountPrevious || (rtl ? 'الحساب السابق' : 'Previous balance');
    const lblPaid = labels.paid || (rtl ? 'المدفوع' : 'Paid');
    const lblRem = labels.remaining || (rtl ? 'المتبقي' : 'Remaining');
    const lblPrevHint =
        labels.accountPreviousHint ||
        (rtl ? '(تقريبي من رصيد المورد)' : '(estimated from vendor balance)');

    const rows: string[] = [];
    items.forEach((item: any, idx: number) => {
        const name =
            item?.master_product?.internal_name ||
            item?.masterProduct?.internal_name ||
            item?.raw_description ||
            '—';
        const sku = item?.sku?.sku || '—';
        const qty = Number(item?.quantity ?? 0);
        const unit = Number(item?.unit_price ?? 0);
        const line = Number(item?.total_price ?? qty * unit);
        const zebra = idx % 2 === 1 ? ' class="zebra"' : '';
        rows.push(`
            <tr${zebra}>
                <td class="num">${formatLatinNumber(idx + 1, { maximumFractionDigits: 0 })}</td>
                <td>${escapeHtml(String(name))}<div class="muted cell-sku-sub">SKU: ${escapeHtml(String(sku))}</div></td>
                <td class="num">${formatLatinNumber(qty, { maximumFractionDigits: 3 })}</td>
                <td class="num">${formatMoney(unit, rtl)}</td>
                <td class="num">${formatMoney(line, rtl)}</td>
            </tr>
        `);
    });

    const subtotal = Number(batch?.subtotal ?? 0);
    const discount = Number(batch?.discount_amount ?? batch?.discount ?? 0);
    const tax = Number(batch?.tax_amount ?? 0);
    const grand = Number(batch?.grand_total ?? batch?.total_amount ?? 0);
    const { paid: paidParsed, remaining: remainingParsed } = parseBatchPaymentFromNotes(batch);
    const paid = Number.isFinite(paidParsed) ? paidParsed : 0;
    const remaining = Number.isFinite(remainingParsed) ? remainingParsed : Math.max(0, grand - paid);
    const previousBal = estimateSupplierPreviousBalance(batch, remaining);

    const metaHtml = `
        <div class="doc-title-centered doc-title--purchase">${escapeHtml(labels.title)}</div>
        <div class="meta-grid meta-grid--compact" style="direction:${direction}; text-align:${align};">
            <div><b>${escapeHtml(labels.invoiceNo)}:</b> ${escapeHtml(String(batch?.invoice_number || batch?.reference_number || '—'))}</div>
            <div><b>${escapeHtml(labels.date)}:</b> ${formatPrintDateOnly(batch?.invoice_date || batch?.created_at, rtl)}</div>
            <div><b>${escapeHtml(labels.supplier)}:</b> ${escapeHtml(String(batch?.vendor?.name || batch?.supplier_name_raw || '—'))}</div>
            <div><b>${escapeHtml(labels.supplierRef)}:</b> ${escapeHtml(String(batch?.vendor_id ?? batch?.supplier_id ?? '—'))}</div>
        </div>
    `;

    const tableHtml = `
        <table class="data-table invoice-lines">
            <thead>
                <tr>
                    <th>${escapeHtml(labels.hash)}</th>
                    <th>${escapeHtml(labels.product)}</th>
                    <th>${escapeHtml(labels.qty)}</th>
                    <th>${escapeHtml(labels.unitPrice)}</th>
                    <th>${escapeHtml(labels.lineTotal)}</th>
                </tr>
            </thead>
            <tbody>
                ${rows.length ? rows.join('') : `<tr><td colspan="5">${escapeHtml(rtl ? 'لا توجد بنود' : 'No line items')}</td></tr>`}
            </tbody>
        </table>
    `;

    const prevCell =
        previousBal != null && Number.isFinite(previousBal)
            ? formatMoney(previousBal, rtl)
            : '—';

    const totalsHtml = `
        <div class="totals-box totals-box--purchase" style="direction:${direction};">
            <table>
                <tr><td>${escapeHtml(labels.subtotal)}</td><td class="num" style="text-align:${align};">${formatMoney(subtotal, rtl)}</td></tr>
                <tr><td>${escapeHtml(labels.discount)}</td><td class="num" style="text-align:${align};">${formatMoney(discount, rtl)}</td></tr>
                <tr><td>${escapeHtml(labels.tax)}</td><td class="num" style="text-align:${align};">${formatMoney(tax, rtl)}</td></tr>
                <tr class="totals-grand-bar"><td class="grand">${escapeHtml(labels.grandTotal)}</td><td class="num grand" style="text-align:${align};">${formatMoney(grand, rtl)}</td></tr>
            </table>
            <table class="account-summary-print">
                <tr>
                    <td class="acct-label">${escapeHtml(lblPrev)} <span class="acct-hint">${escapeHtml(lblPrevHint)}</span></td>
                    <td class="num" style="text-align:${align};">${prevCell}</td>
                </tr>
                <tr>
                    <td>${escapeHtml(lblPaid)}</td>
                    <td class="num" style="text-align:${align};">${formatMoney(paid, rtl)}</td>
                </tr>
                <tr class="acct-remaining">
                    <td><b>${escapeHtml(lblRem)}</b></td>
                    <td class="num" style="text-align:${align};"><b>${formatMoney(remaining, rtl)}</b></td>
                </tr>
            </table>
        </div>
    `;

    const notes = String(batch?.notes || '').trim();
    const footHtml = `
        <div class="signatures signatures--purchase" style="direction:${direction};">
            <div>${escapeHtml(labels.receivedBy)}<br /><br />_____________</div>
            <div>${escapeHtml(labels.supplierSign)}<br /><br />_____________</div>
        </div>
        ${notes ? `<div class="footer-note"><b>${escapeHtml(labels.notes)}:</b> ${escapeHtml(notes)}</div>` : ''}
    `;

    const html = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(labels.title)}</title>
            <style>
                ${basePrintStyles(direction, align, b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)}
                table.data-table tbody tr.zebra { background: #f3f4f6; }
                ${getProfessionalInvoiceCompactCss(b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)}
            </style>
        </head>
        <body>
            ${buildBrandingHeaderHtml(b, rtl, 'letterheadLogo')}
            ${metaHtml}
            ${tableHtml}
            ${totalsHtml}
            ${footHtml}
            ${buildPrintDocumentFooterHtml(b, rtl)}
            <script>
                window.onload = function () {
                    window.print();
                    window.onafterprint = function () { window.close(); };
                };
            </script>
        </body>
        </html>
    `;

    return openPrintHtml(html);
}

/**
 * Sales invoice print layout — matches {@link printPurchaseInvoiceProfessional} (centered title, meta grid, branded table, totals box, signatures).
 */
export function printSalesInvoiceProfessional(params: {
    rtl: boolean;
    branding?: Partial<CompanyBranding>;
    /** Sales order / shop-sale payload (flexible shape). */
    order: any;
    /** Optional line under meta grid, e.g. payment method */
    metaExtraLine?: string;
    labels: {
        title: string;
        invoiceNo: string;
        date: string;
        customer: string;
        warehouse: string;
        hash: string;
        product: string;
        qty: string;
        unitPrice: string;
        lineTotal: string;
        subtotal: string;
        discount: string;
        tax: string;
        grandTotal: string;
        notes: string;
        receivedBy: string;
        secondSign: string;
        paid: string;
        remaining: string;
        accountPrevious?: string;
        accountPreviousHint?: string;
    };
}): boolean {
    const { rtl, order, labels } = params;
    const b = getDefaultPrintBranding(params.branding);
    const direction = rtl ? 'rtl' : 'ltr';
    const align = rtl ? 'right' : 'left';
    const items = Array.isArray(order?.items) ? order.items : [];

    const lblPrev = labels.accountPrevious || (rtl ? 'الحساب السابق' : 'Previous balance');
    const lblPaid = labels.paid;
    const lblRem = labels.remaining;
    const lblPrevHint =
        labels.accountPreviousHint || (rtl ? '(غير متاح)' : '(n/a)');

    const invNo = String(
        order?.order_number ||
            order?.platform_order_id ||
            order?.invoice_number ||
            order?.reference_number ||
            (order?.id != null ? `#${order.id}` : '—')
    );

    const warehouseName = String(
        order?.warehouse?.name ?? order?.warehouse_name ?? '—'
    );

    const customerName = String(order?.customer_name ?? '—');
    const customerPhone = String(
        order?.customer_phone ??
            order?.customer?.phone ??
            order?.buyer_phone ??
            ''
    ).trim();
    const customerAddress = String(
        order?.shipping_address ??
            order?.customer_address ??
            order?.address ??
            ''
    ).trim();

    const rows: string[] = [];
    items.forEach((item: any, idx: number) => {
        const name =
            item?.product_name ||
            item?.master_product?.internal_name ||
            item?.masterProduct?.internal_name ||
            item?.sku?.offer?.masterProduct?.internal_name ||
            item?.sku?.name ||
            item?.raw_description ||
            '—';
        const sku =
            item?.sku?.sku ||
            item?.sku_code ||
            item?.sku?.code ||
            (typeof item?.sku === 'string' ? item.sku : null) ||
            '—';
        const qty = Number(item?.quantity ?? 0);
        const unit = Number(item?.unit_price ?? 0);
        const line = Number(item?.total_price ?? qty * unit);
        const zebra = idx % 2 === 1 ? ' class="zebra"' : '';
        rows.push(`
            <tr${zebra}>
                <td class="num">${formatLatinNumber(idx + 1, { maximumFractionDigits: 0 })}</td>
                <td>${escapeHtml(String(name))}<div class="muted cell-sku-sub">SKU: ${escapeHtml(String(sku))}</div></td>
                <td class="num">${formatLatinNumber(qty, { maximumFractionDigits: 3 })}</td>
                <td class="num">${formatMoney(unit, rtl)}</td>
                <td class="num">${formatMoney(line, rtl)}</td>
            </tr>
        `);
    });

    let lineSum = 0;
    items.forEach((item: any) => {
        const qty = Number(item?.quantity ?? 0);
        const unit = Number(item?.unit_price ?? 0);
        lineSum += Number(item?.total_price ?? qty * unit);
    });

    const subtotal = Number(order?.subtotal ?? lineSum);
    const discount = Number(order?.discount_amount ?? order?.discount ?? 0);
    const tax = Number(order?.tax_amount ?? order?.tax ?? 0);
    const grand = Number(order?.total_amount ?? order?.grand_total ?? lineSum);
    const paid = Number(order?.paid_amount ?? 0);
    let remaining = Number(order?.remaining_amount ?? NaN);
    if (!Number.isFinite(remaining)) {
        remaining = Math.max(0, grand - paid);
    }

    const metaExtra = params.metaExtraLine?.trim()
        ? `<div class="meta-extra-line" style="direction:${direction};text-align:${align};">${escapeHtml(params.metaExtraLine.trim())}</div>`
        : '';

    const metaHtml = `
        <div class="doc-title-centered doc-title--purchase">${escapeHtml(labels.title)}</div>
        <div class="meta-grid meta-grid--compact" style="direction:${direction}; text-align:${align};">
            <div><b>${escapeHtml(labels.invoiceNo)}:</b> ${escapeHtml(invNo)}</div>
            <div><b>${escapeHtml(labels.date)}:</b> ${formatPrintDateOnly(order?.created_at || order?.order_date || order?.invoice_date, rtl)}</div>
            <div>
                <b>${escapeHtml(labels.customer)}:</b> ${escapeHtml(customerName)}
                ${customerPhone ? `<div class="muted meta-subline" style="margin-top:4px;">${escapeHtml(rtl ? 'الهاتف' : 'Phone')}: ${escapeHtml(customerPhone)}</div>` : ''}
                ${customerAddress ? `<div class="muted meta-subline" style="margin-top:2px; white-space:pre-wrap;">${escapeHtml(rtl ? 'العنوان' : 'Address')}: ${escapeHtml(customerAddress)}</div>` : ''}
            </div>
            <div><b>${escapeHtml(labels.warehouse)}:</b> ${escapeHtml(warehouseName)}</div>
        </div>
        ${metaExtra}
    `;

    const tableHtml = `
        <table class="data-table invoice-lines">
            <thead>
                <tr>
                    <th>${escapeHtml(labels.hash)}</th>
                    <th>${escapeHtml(labels.product)}</th>
                    <th>${escapeHtml(labels.qty)}</th>
                    <th>${escapeHtml(labels.unitPrice)}</th>
                    <th>${escapeHtml(labels.lineTotal)}</th>
                </tr>
            </thead>
            <tbody>
                ${rows.length ? rows.join('') : `<tr><td colspan="5">${escapeHtml(rtl ? 'لا توجد بنود' : 'No line items')}</td></tr>`}
            </tbody>
        </table>
    `;

    const totalsHtml = `
        <div class="totals-box totals-box--purchase" style="direction:${direction};">
            <table>
                <tr><td>${escapeHtml(labels.subtotal)}</td><td class="num" style="text-align:${align};">${formatMoney(subtotal, rtl)}</td></tr>
                <tr><td>${escapeHtml(labels.discount)}</td><td class="num" style="text-align:${align};">${formatMoney(discount, rtl)}</td></tr>
                <tr><td>${escapeHtml(labels.tax)}</td><td class="num" style="text-align:${align};">${formatMoney(tax, rtl)}</td></tr>
                <tr class="totals-grand-bar"><td class="grand">${escapeHtml(labels.grandTotal)}</td><td class="num grand" style="text-align:${align};">${formatMoney(grand, rtl)}</td></tr>
            </table>
            <table class="account-summary-print">
                <tr>
                    <td class="acct-label">${escapeHtml(lblPrev)} <span class="acct-hint">${escapeHtml(lblPrevHint)}</span></td>
                    <td class="num" style="text-align:${align};">—</td>
                </tr>
                <tr>
                    <td>${escapeHtml(lblPaid)}</td>
                    <td class="num" style="text-align:${align};">${formatMoney(paid, rtl)}</td>
                </tr>
                <tr class="acct-remaining">
                    <td><b>${escapeHtml(lblRem)}</b></td>
                    <td class="num" style="text-align:${align};"><b>${formatMoney(remaining, rtl)}</b></td>
                </tr>
            </table>
        </div>
    `;

    const notes = String(order?.notes ?? order?.note ?? '').trim();
    const footHtml = `
        <div class="signatures signatures--purchase" style="direction:${direction};">
            <div>${escapeHtml(labels.receivedBy)}<br /><br />_____________</div>
            <div>${escapeHtml(labels.secondSign)}<br /><br />_____________</div>
        </div>
        ${notes ? `<div class="footer-note"><b>${escapeHtml(labels.notes)}:</b> ${escapeHtml(notes)}</div>` : ''}
    `;

    const html = `
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(labels.title)}</title>
            <style>
                ${basePrintStyles(direction, align, b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)}
                table.data-table tbody tr.zebra { background: #f3f4f6; }
                ${getProfessionalInvoiceCompactCss(b.primaryColor || PHYZIOLINE_BRAND_PRIMARY)}
            </style>
        </head>
        <body>
            ${buildBrandingHeaderHtml(b, rtl, 'letterheadLogo')}
            ${metaHtml}
            ${tableHtml}
            ${totalsHtml}
            ${footHtml}
            ${buildPrintDocumentFooterHtml(b, rtl)}
            <script>
                window.onload = function () {
                    window.print();
                    window.onafterprint = function () { window.close(); };
                };
            </script>
        </body>
        </html>
    `;

    return openPrintHtml(html);
}
