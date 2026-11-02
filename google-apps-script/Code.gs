/**
 * Email notifications for the personal website.
 *
 * Configure these values under Apps Script > Project Settings > Script properties.
 * The webhook secret must match the secret stored in Supabase Vault.
 */
function doPost(e) {
  const properties = PropertiesService.getScriptProperties();
  const expectedSecret = properties.getProperty('EMAIL_NOTIFICATION_WEBHOOK_SECRET');
  const recipient = properties.getProperty('EMAIL_NOTIFICATION_TO');

  let payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return jsonResponse({ error: 'Invalid JSON' });
  }

  if (!expectedSecret || payload.secret !== expectedSecret) {
    return jsonResponse({ error: 'Unauthorized' });
  }

  if (!recipient) {
    return jsonResponse({ error: 'Recipient is not configured' });
  }

  try {
    const email = buildNotification(payload, recipient);
    MailApp.sendEmail(recipient, email.subject, email.body, email.options || {});

    let receiptSent = false;
    if (email.receipt) {
      try {
        if (shouldSendContactReceipt(email.receipt.to)) {
          MailApp.sendEmail(
            email.receipt.to,
            email.receipt.subject,
            email.receipt.body,
            email.receipt.options || {}
          );
          receiptSent = true;
        }
      } catch (receiptError) {
        // The site owner's notification was already sent; a receipt failure should not undo it.
        console.error('Admin notification sent, but the contact receipt could not be sent:', receiptError);
      }
    }

    return jsonResponse({ sent: true, receiptSent: receiptSent });
  } catch (error) {
    console.error('Could not send notification:', error);
    return jsonResponse({ error: 'Could not send notification' });
  }
}

function buildNotification(payload, ownerEmail) {
  const record = payload && payload.record;
  if (!record || typeof record !== 'object') {
    throw new Error('Invalid notification record');
  }

  if (payload.event === 'contact_message') {
    const name = safeText(record.name, 100);
    const email = safeText(record.email, 254);
    const message = safeText(record.message, 5000);
    const createdAt = safeText(record.created_at, 80);
    if (!name || !isValidEmail(email) || !message) throw new Error('Incomplete contact message');

    return {
      subject: 'Новое сообщение на сайте',
      body: [
        'НОВОЕ СООБЩЕНИЕ НА САЙТЕ',
        '',
        'Имя: ' + name,
        'Электронная почта: ' + email,
        'Дата: ' + createdAt,
        '',
        'ТЕКСТ СООБЩЕНИЯ',
        message
      ].join('\n'),
      options: {
        replyTo: email,
        name: 'Уведомления сайта',
        htmlBody: contactMessageHtml(name, email, createdAt, message)
      },
      receipt: {
        to: email,
        subject: 'Мы получили ваше сообщение — Сергей Шуляк',
        body: [
          'Здравствуйте, ' + name + '!',
          '',
          'Ваше сообщение успешно доставлено. Я получил его и постараюсь ответить в ближайшее время.',
          '',
          'Это автоматическое подтверждение; отдельный ответ придёт позже.'
        ].join('\n'),
        options: {
          name: 'Сергей Шуляк',
          replyTo: ownerEmail,
          htmlBody: contactReceiptHtml(name)
        }
      }
    };
  }

  if (payload.event === 'site_visit') {
    const visitDate = safeText(record.visit_date, 20);
    const visitors = Number(record.visitors);
    if (!visitDate || !Number.isFinite(visitors) || visitors < 1) {
      throw new Error('Invalid site visit');
    }

    return {
      subject: 'На сайт зашёл новый посетитель',
      body: [
        'НОВОЕ ПОСЕЩЕНИЕ САЙТА',
        'Дата: ' + visitDate,
        'Уникальных браузеров за день: ' + visitors,
        '',
        'Подсчёт основан на случайном ID в браузере на один день. Это не точный подсчёт людей; IP-адрес и контактные данные в таблицу статистики не записываются.'
      ].join('\n'),
      options: {
        name: 'Уведомления сайта',
        htmlBody: siteVisitHtml(visitDate, visitors)
      }
    };
  }

  throw new Error('Unsupported notification event');
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function shouldSendContactReceipt(email) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return false;

  try {
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      email.trim().toLowerCase(),
      Utilities.Charset.UTF_8
    );
    const key = 'contact-receipt-' + Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return false;

    cache.put(key, 'sent', 15 * 60);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function contactReceiptHtml(name) {
  const safeName = escapeHtml(name);

  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">' +
    '<style>:root{color-scheme:dark;supported-color-schemes:dark}</style></head>' +
    '<body bgcolor="#09090b" style="margin:0;padding:28px 12px;background-color:#09090b;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#09090b" style="border-collapse:collapse;background-color:#09090b"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#18181b" style="width:100%;max-width:560px;border:1px solid #303034;border-radius:18px;background-color:#18181b">' +
    '<tr><td style="padding:24px 28px;border-bottom:1px solid #303034;color:#b5b5b8;font-size:12px;font-weight:700;letter-spacing:1.3px">СЕРГЕЙ ШУЛЯК&nbsp; · &nbsp;ЛИЧНЫЙ САЙТ</td></tr>' +
    '<tr><td style="padding:30px 28px 34px">' +
    '<h1 style="margin:22px 0 0;color:#f4f4f5;font-size:27px;font-weight:700;line-height:1.25">Спасибо за сообщение, ' + safeName + '!</h1>' +
    '<p style="margin:16px 0 0;color:#d0d0d4;font-size:16px;line-height:1.7">Ваше сообщение успешно доставлено. Я получил его и постараюсь ответить в ближайшее время.</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#101012" style="margin-top:24px;border-collapse:collapse;background-color:#101012;border:1px solid #2c2c30;border-radius:12px"><tr>' +
    '<td style="padding:16px 18px;color:#a0a0a8;font-size:13px;line-height:1.6">Это автоматическое подтверждение. Если понадобится, просто ответьте на это письмо — оно придёт Сергею.</td>' +
    '</tr></table>' +
    '</td></tr>' +
    '<tr><td style="padding:16px 28px;border-top:1px solid #303034;color:#77777e;font-size:12px;line-height:1.5">Письмо отправлено после отправки формы обратной связи.</td></tr>' +
    '</table></td></tr></table></body></html>';
}

function contactMessageHtml(name, email, createdAt, message) {
  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeDate = escapeHtml(createdAt);
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, '<br>');
  const emailLink = 'mailto:' + encodeURIComponent(email);

  return emailLayout(
    'НОВОЕ СООБЩЕНИЕ',
    'Тебе написали на сайте',
    'В форме обратной связи появилось новое сообщение.',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 20px">' +
      detailRowHtml('Имя', safeName) +
      detailRowHtml('Электронная почта', '<a href="' + emailLink + '" style="color:#e6e6e9;text-decoration:underline">' + safeEmail + '</a>') +
      detailRowHtml('Дата', safeDate) +
    '</table>' +
    '<div style="padding:18px 20px;background:#101012;border:1px solid #2c2c30;border-radius:14px">' +
      '<div style="margin:0 0 10px;color:#a0a0a8;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Сообщение</div>' +
      '<div style="color:#f0f0f0;font-size:16px;line-height:1.65;overflow-wrap:anywhere">' + safeMessage + '</div>' +
    '</div>' +
    '<div style="margin-top:20px"><a href="' + emailLink + '" style="display:inline-block;padding:12px 18px;background:#303034;border:1px solid #55555b;border-radius:10px;color:#f4f4f5;font-size:14px;font-weight:700;text-decoration:none">Ответить на сообщение&nbsp; →</a></div>'
  );
}

function siteVisitHtml(visitDate, visitors) {
  const safeDate = escapeHtml(visitDate);
  const safeVisitors = escapeHtml(String(visitors));

  return emailLayout(
    'СТАТИСТИКА',
    'Новый посетитель',
    'Сайт посетил новый браузер, которого ещё не было в сегодняшнем подсчёте.',
    '<div style="padding:20px;background:#101012;border:1px solid #2c2c30;border-radius:14px">' +
      '<div style="color:#a0a0a8;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Уникальных браузеров за день</div>' +
      '<div style="margin-top:8px;color:#f0f0f0;font-size:36px;font-weight:700;line-height:1.15">' + safeVisitors + '</div>' +
      '<div style="margin-top:16px;color:#a0a0a8;font-size:13px">Дата · ' + safeDate + ' UTC</div>' +
    '</div>' +
    '<p style="margin:18px 0 0;color:#8e8e96;font-size:13px;line-height:1.6">Счётчик распознаёт случайный ID браузера на один день. Это оценка браузеров, а не точное число людей.</p>'
  );
}

function detailRowHtml(label, valueHtml) {
  return '<tr>' +
    '<td style="width:155px;padding:8px 12px 8px 0;color:#92929a;font-size:13px;vertical-align:top">' + escapeHtml(label) + '</td>' +
    '<td style="padding:8px 0;color:#e8e8eb;font-size:14px;line-height:1.5;overflow-wrap:anywhere">' + valueHtml + '</td>' +
  '</tr>';
}

function emailLayout(eyebrow, title, intro, contentHtml) {
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">' +
    '<style>:root{color-scheme:dark;supported-color-schemes:dark}</style></head>' +
    '<body bgcolor="#09090b" style="margin:0;padding:28px 12px;background-color:#09090b;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#09090b" style="border-collapse:collapse;background-color:#09090b"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#18181b" style="width:100%;max-width:620px;border:1px solid #303034;border-radius:18px;background-color:#18181b;overflow:hidden">' +
    '<tr><td style="padding:26px 28px 10px">' +
    '<div style="color:#a0a0a8;font-size:11px;font-weight:700;letter-spacing:1.5px">СЕРГЕЙ ШУЛЯК&nbsp; / &nbsp;УВЕДОМЛЕНИЯ</div>' +
    '<div style="margin-top:24px;color:#b5b5b8;font-size:11px;font-weight:700;letter-spacing:1.2px">' + escapeHtml(eyebrow) + '</div>' +
    '<h1 style="margin:8px 0 0;color:#f4f4f5;font-size:26px;font-weight:700;line-height:1.25">' + escapeHtml(title) + '</h1>' +
    '<p style="margin:10px 0 0;color:#a0a0a8;font-size:14px;line-height:1.6">' + escapeHtml(intro) + '</p>' +
    '</td></tr>' +
    '<tr><td style="padding:22px 28px 28px">' + contentHtml + '</td></tr>' +
    '<tr><td style="padding:16px 28px;border-top:1px solid #303034;color:#77777e;font-size:12px;line-height:1.5">Автоматическое уведомление с сайта</td></tr>' +
    '</table></td></tr></table></body></html>';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
