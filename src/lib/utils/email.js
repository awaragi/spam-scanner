import emailAddresses from 'email-addresses';
import pino from 'pino';

const {parseOneAddress} = emailAddresses;
const logger = pino();

/**
 * Checks if an email address appears to be human-generated.
 */
function isHumanReadable(email) {
    if (!email) return false;
    const [local, domain] = email.split('@');
    if (!local || !domain) return false;

    const localLower = local.toLowerCase();

    // 1. Known bounce/relay patterns
    if (/^(bounce[_\-+]|bounces[+])/.test(localLower)) return false;

    // 2. Tokenized or entropy-heavy local part (long and random)
    if (local.length > 30 && /[a-z]/i.test(local) && /\d/.test(local)) {
        const entropyFactor = (local.match(/[a-z0-9]/gi) || []).length / local.length;
        if (entropyFactor > 0.7) return false;
    }

    // 3. Starts with timestamp-like data (e.g., 2025062619..., 2025051718...)
    if (/^20\d{10,}/.test(local)) return false;

    // 4. Multiple dot-separated numeric tokens
    if ((local.match(/\d+\.\d+/g) || []).length >= 2) return false;

    // 5. Long token ending in subdomain that indicates ESP or relay
    const domainLower = domain.toLowerCase();
    const relayIndicators = [
        'bounces.', 'bounce.', 'email.', 'mailer', 'relay',
    ];
    if (relayIndicators.some(prefix => domainLower.includes(prefix))) return false;

    const knownRelays = [
        'lnk01.com',
        'cyberimpact.com',
        'amazonmusic.com',
        'primevideo.com',
        'questrade.com',
        'res-marriott.com',
    ];
    if (knownRelays.some(relay => domainLower.endsWith(relay))) {
        return false;
    }

    // other cases
    return true;
}

/**
 * Simple helper to safely convert date to string
 * @param {any} date - Date value to convert
 * @returns {string} - ISO string or empty string if conversion fails
 */
export function dateToString(date) {
    try {
        return date ? date.toISOString() : '';
    } catch {
        return '';
    }
}

/**
 * Extracts human-relevant sender addresses from parsed headers.
 * @param {Record<string, string>} headers - Email headers with lowercase keys
 * @returns {string[]} - Up to 2 clean sender addresses
 */
export function extractSenders(headers) {
    const candidates = [];
    const priorityFields = ['from', 'reply-to', 'return-path', 'sender'];

    for (const field of priorityFields) {
        const raw = headers[field];
        if (!raw) continue;

        const parsed = parseOneAddress(raw);
        if (parsed) {
            if (isHumanReadable(parsed.address)) {
                candidates.push(parsed.address.toLowerCase());
            } else {
                logger.info({field, email: parsed.address}, 'Email address rejected as non-human-readable');
            }
        }
    }

    return [...new Set(candidates)].slice(0, 2);
}
