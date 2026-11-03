'use strict';
// Original public Supabase configuration and direct inquiry transport.
const SUPABASE_URL = 'https://ivdjgxutjafwjvroltjf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2ZGpneHV0amFmd2p2cm9sdGpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1Njc3NjcsImV4cCI6MjA5MzE0Mzc2N30.qN8Jxh3e2amTmI74kyGMbCr1O7rdKsunQ7noMp_eE5E';

function supabaseInsert(table, row) {
    return fetch(SUPABASE_URL + '/rest/v1/' + table, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        },
        body: JSON.stringify(row)
    });
}


const inquiryForm = document.getElementById('contactForm');
const smsCheckbox = document.getElementById('smsConsent');
const inquiryPhone = document.getElementById('phone');
function updateSmsValidation() {
    inquiryPhone.required = smsCheckbox.checked;
    const invalid = smsCheckbox.checked && !InquiryValidation.normalizePhone(inquiryPhone.value);
    inquiryPhone.setCustomValidity(invalid ? 'Enter a valid phone number for SMS (include + and country code outside the US/Canada).' : '');
    inquiryPhone.setAttribute('aria-invalid', String(invalid));
}
smsCheckbox.addEventListener('change', updateSmsValidation);
inquiryPhone.addEventListener('input', updateSmsValidation);
window.handleSubmit = async function (event) {
    event.preventDefault();
    const button = inquiryForm.querySelector('.submit-btn');
    if (button.disabled) return;
    const status = document.getElementById('inquiryStatus');
    updateSmsValidation();
    if (!inquiryForm.reportValidity()) return;
    const data = Object.fromEntries(new FormData(inquiryForm));
    data.sms_consent = smsCheckbox.checked;
    const error = InquiryValidation.validate(data);
    if (error) { status.textContent = error; status.focus(); return; }
    button.disabled = true;
    button.textContent = 'Sending...';
    status.textContent = '';
    try {
        // Build from fresh form input each time; never append to the textarea itself.
        const shownDisclosure = document.querySelector('label[for="smsConsent"]').textContent.trim();
        const message = InquiryValidation.consentMessage(
            data.message, data.sms_consent, window.location.href, shownDisclosure
        );
        const response = await supabaseInsert('inquiries', {
            name: data.name,
            company: data.company,
            email: data.email,
            phone: data.phone,
            message
        });
        // Supabase return=minimal can return an empty 201 response.
        if (!response.ok) throw new Error('We could not confirm your inquiry was saved. Please try again or email deals@fairmontcp.net.');
        inquiryForm.reset();
        updateSmsValidation();
        status.textContent = 'Your inquiry has been sent. We will be in touch.';
        if (typeof gtag_report_conversion === 'function') gtag_report_conversion();
    } catch (error) {
        status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError'
            ? 'We could not confirm your inquiry was saved. Please try again or email deals@fairmontcp.net.' : error.message;
    } finally {
        button.disabled = false;
        button.textContent = 'Send Inquiry';
    }
};
