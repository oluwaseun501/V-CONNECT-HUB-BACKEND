function parseSmsDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  if (value === null || value === undefined || value === "") {
    return new Date();
  }

  // Support Unix timestamps as well as 5SIM date strings.
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const timestamp = Number(value);

    // Seconds have fewer digits; milliseconds have more.
    const milliseconds =
      timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;

    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  // 5SIM normally sends values such as:
  // "2026-08-01T12:34:56.000Z"
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function extractCode(text = "") {
  const match = String(text).match(/\b\d{3,8}\b/);
  return match ? match[0] : "";
}

function mapSms(smsList = []) {
  if (!Array.isArray(smsList)) {
    return [];
  }

  return smsList.map((sms = {}) => {
    const messageText = sms.text || "";
    const smsDate = parseSmsDate(sms.date || sms.created_at);

    return {
      created_at: parseSmsDate(sms.created_at || sms.date),
      date: smsDate,
      sender: sms.sender || "",
      text: messageText,
      code: sms.code || extractCode(messageText),
    };
  });
}

module.exports = mapSms;