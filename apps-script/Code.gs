const FIREBASE_PROJECT_ID = 'card-balance-2cdf0';

function doPost(event) {
  try {
    const payload = JSON.parse((event.postData && event.postData.contents) || '{}');
    if (payload.action === 'balance') {
      return handleBalanceRequest(payload);
    }
    const requestId = String(payload.requestId || '');
    const idToken = String(payload.idToken || '');
    if (!/^req_[0-9a-f]{64}$/.test(requestId) || !idToken) {
      return jsonResponse({ok: false, error: 'invalid_request'});
    }

    const document = readPendingRequest(requestId, idToken);
    const fields = document.fields || {};
    if (stringField(fields.status) !== 'PENDING') {
      return jsonResponse({ok: false, error: 'not_pending'});
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const properties = PropertiesService.getScriptProperties();
      const dedupeKey = 'sent_' + digest(requestId);
      if (properties.getProperty(dedupeKey)) {
        return jsonResponse({ok: true, duplicate: true});
      }
      const adminEmail = properties.getProperty('ADMIN_EMAIL');
      if (!adminEmail) throw new Error('ADMIN_EMAIL is not configured');

      const name = stringField(fields.userEnteredName) || '-';
      const accountEmail = stringField(fields.email) || '-';
      const manufacturer = stringField(fields.manufacturer);
      const model = stringField(fields.model);
      const version = stringField(fields.versionName) || '-';
      const installationId = stringField(fields.installationId) || '-';
      const device = (manufacturer + ' ' + model).trim() || '-';
      const subject = 'Νέο αίτημα έγκρισης Card Balance';
      const text = [
        'Νέο αίτημα εγκατάστασης Card Balance',
        '',
        'Όνομα: ' + name,
        'Google email: ' + accountEmail,
        'Συσκευή: ' + device,
        'Έκδοση: ' + version,
        'Installation ID: ' + installationId,
        '',
        'Άνοιξε το Card Balance Admin για έγκριση.'
      ].join('\n');

      MailApp.sendEmail({to: adminEmail, subject: subject, body: text});
      properties.setProperty(dedupeKey, new Date().toISOString());
      return jsonResponse({ok: true, duplicate: false});
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse({ok: false, error: 'notification_failed'});
  }
}

function handleBalanceRequest(payload) {
  const requestId = String(payload.requestId || '');
  const idToken = String(payload.idToken || '');
  const cardNumber = String(payload.cardNumber || '');
  const extraCode = String(payload.extraCode || '');
  if (!/^[0-9a-f]{64}$/.test(requestId) || !idToken ||
      !/^\d{1,30}$/.test(cardNumber) || !/^\d{6}$/.test(extraCode)) {
    return jsonResponse({ok: false, error: 'invalid_request'});
  }

  const document = readPendingRequest(requestId, idToken);
  const fields = document.fields || {};
  if (stringField(fields.status) !== 'APPROVED' ||
      stringField(fields.clientPlatform) !== 'WEB') {
    return jsonResponse({ok: false, error: 'not_approved'});
  }

  const response = UrlFetchApp.fetch('https://vouchercards.ab.gr/api/Balance/CheckBalance', {
    method: 'post',
    contentType: 'application/json',
    headers: {Accept: 'application/json'},
    payload: JSON.stringify({cardCode: cardNumber, extraCode: extraCode}),
    followRedirects: false,
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  if (status < 200 || status > 299) {
    return jsonResponse({ok: false, error: 'upstream_unavailable', status: status});
  }
  const result = JSON.parse(response.getContentText());
  return jsonResponse({ok: true, result: result});
}

function readPendingRequest(requestId, idToken) {
  const url = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(FIREBASE_PROJECT_ID) +
    '/databases/(default)/documents/installationRequests/' +
    encodeURIComponent(requestId);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {Authorization: 'Bearer ' + idToken},
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Firestore verification failed: ' + response.getResponseCode());
  }
  return JSON.parse(response.getContentText());
}

function stringField(field) {
  return field && typeof field.stringValue === 'string' ? field.stringValue : '';
}

function digest(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
    .map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); })
    .join('');
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
