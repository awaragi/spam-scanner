import emailAddresses from 'email-addresses';
import {rootLogger} from './logger.js';

const {parseOneAddress} = emailAddresses;
const logger = rootLogger.forComponent('email-utils');

/**
 * Checks if an email address appears to be human-generated.
 * Filters out per-message tokens and relay addresses while keeping
 * legitimate corporate senders (even if automated).
 */
export function isHumanReadable(email) {
    if (!email) return false;
    const [local, domain] = email.split('@');
    if (!local || !domain) return false;

    const localLower = local.toLowerCase();

    // 1. Known bounce/relay patterns in local part
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

    // 5. UUID-like patterns (8-4-4-4-12 hex format with dashes or without)
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(local)) return false;
    if (/^[a-f0-9]{32,}$/i.test(local)) return false; // Long hex strings

    // 6. Domain checks - only filter obvious relay/bounce subdomains
    const domainLower = domain.toLowerCase();
    
    // Check for bounce/relay subdomains at the start (more specific than before)
    if (/^(bounces?\.|relay\.|mailer\.)/.test(domainLower)) return false;
    
    // Known relay domains that generate per-message addresses
    const knownRelays = [
        'lnk01.com',
        'cyberimpact.com',
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
                logger.debug({field, email: parsed.address}, 'Email address rejected as non-human-readable');
            }
        }
    }

    return [...new Set(candidates)].slice(0, 2);
}
