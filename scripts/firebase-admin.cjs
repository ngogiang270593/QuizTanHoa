'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

async function firebaseAdmin(filename) {
  const account = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  if (account.type !== 'service_account' || account.project_id !== 'quiztanhoa') {
    throw new Error('Expected project quiztanhoa.');
  }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const assertion = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const token = await response.json();
  if (!response.ok || !token.access_token) throw new Error(`OAuth HTTP ${response.status}`);
  return {
    project: account.project_id,
    async request(url, options = {}) {
      const result = await fetch(url, { ...options,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.access_token}`, ...options.headers },
        signal: AbortSignal.timeout(30000),
      });
      const body = await result.json();
      if (!result.ok) {
        // Google status/message contain configuration errors, never submitted credentials.
        const failure = new Error(`HTTP ${result.status}: ${body.error?.status || 'UNKNOWN'}: ${body.error?.message || 'Request failed'}`);
        failure.status = result.status;
        throw failure;
      }
      return body;
    },
  };
}
module.exports = { firebaseAdmin };
