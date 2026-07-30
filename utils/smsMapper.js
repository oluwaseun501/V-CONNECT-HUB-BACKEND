// Add this helper above mapSms
function extractCodeFromText(text) {
    if (!text) return '';
    // Match 4–8 digit sequences (covers most OTP lengths)
    const match = text.match(/\b\d{4,8}\b/);
    return match ? match[0] : '';
}

function mapSms(providerSms = []) {
    if (!Array.isArray(providerSms)) return [];

    return providerSms.map((sms) => {
        const text = sms.text || sms.smstext || '';
        // FIX: 5sim often returns code: "" even when the OTP is in the text.
        // Fall back to extractCodeFromText so the dashboard always shows the code.
        const code = sms.code || extractCodeFromText(text) || '';
        return {
            sender: sms.sender || '',
            text,
            code,
            date: sms.date ? new Date(sms.date * 1000) : new Date(),
        };
    });
}

module.exports = mapSms;
