'use strict';

// Read-only verification. Never print the key, assertion, or OAuth access token.
const fs = require('node:fs');
const crypto = require('node:crypto');

async function main() {
  const filename = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!filename) throw new Error('Pass the service-account JSON path as the first argument.');
  const account = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  if (account.type !== 'service_account' || account.project_id !== 'quiztanhoa'
      || !account.client_email?.endsWith('@quiztanhoa.iam.gserviceaccount.com')) {
    throw new Error('Expected a service account for project quiztanhoa.');
  }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })}`;
  const assertion = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url')}`;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) {
    console.log(JSON.stringify({ project: account.project_id, oauth: false, httpStatus: tokenResponse.status,
      reason: ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(token.error) ? token.error : 'oauth_rejected' }));
    process.exitCode = 1;
    return;
  }
  // A bounded collection read tests data access without changing project/database configuration.
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/documents/appSettings?pageSize=1`, {
    headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  console.log(JSON.stringify({ project: account.project_id, oauth: true, firestoreRead: response.ok,
    httpStatus: response.status, status: response.ok ? 'OK' : data.error?.status || 'UNKNOWN',
    reason: data.error?.details?.find(item => item.reason)?.reason || undefined }));
  if (!response.ok) process.exitCode = 1;
}

main().catch(error => {
  const code = error.cause?.code || error.code || error.name;
  console.error(`Firebase verification failed (${code}). No credentials were printed.`);
  process.exitCode = 1;
});
