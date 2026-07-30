function mapSms(providerSms = []) {

    if (!Array.isArray(providerSms)) {
        return [];
    }

    return providerSms.map((sms) => ({
        sender: sms.sender || '',
        text: sms.text || sms.smstext || '',
        code: sms.code || '',
        date: sms.date
            ? new Date(sms.date * 1000)
            : new Date(),
    }));
}

module.exports = mapSms;