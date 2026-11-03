(function (root) {
    'use strict';
    const disclosure = 'I agree to receive SMS text messages from Fairmont Credit Partners about my financing inquiry, application-status updates, appointment scheduling, and customer support. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance. Consent is not a condition of purchase. See our Privacy Policy.';
    const disclosureVersion = 'fcp-inquiry-sms-2026-11-03-v1';
    function consentMessage(originalMessage, optedIn, pageUrl, shownDisclosure) {
        const lines = ['--- SMS consent for this inquiry ---'];
        if (optedIn === true) {
            const source = new URL(pageUrl);
            // Exclude query parameters, fragments, and URL credentials.
            lines.push('Affirmative SMS consent selected: Yes',
                'Source: ' + source.origin + source.pathname,
                'Disclosure version: ' + disclosureVersion,
                'Disclosure: ' + shownDisclosure);
        } else {
            lines.push('No new SMS consent provided by this submission.',
                'This does not revoke any previously recorded consent.');
        }
        lines.push('--- End SMS consent record ---');
        return originalMessage + '\n\n' + lines.join('\n');
    }
    function normalizePhone(value) {
        const raw = String(value || '').trim();
        if (!/^[+\d\s().-]+$/.test(raw)) return null;
        const digits = raw.replace(/\D/g, '');
        if (/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return '+1' + digits;
        if (/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return '+' + digits;
        if (raw.startsWith('+') && /^[2-9]\d{7,14}$/.test(digits)) return '+' + digits;
        return null;
    }
    function validate(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Please complete the inquiry form.';
        // Existing required/email constraints remain native HTML validation.
        if (data.sms_consent !== undefined && typeof data.sms_consent !== 'boolean') return 'Please check your SMS consent selection.';
        if (data.sms_consent === true && !normalizePhone(data.phone)) return 'To receive SMS messages, enter a valid phone number (include + and country code outside the US/Canada).';
        return '';
    }
    const api = { disclosure, disclosureVersion, consentMessage, normalizePhone, validate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.InquiryValidation = api;
})(typeof window !== 'undefined' ? window : globalThis);
