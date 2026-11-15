'use strict';
const { firebaseAdmin } = require('./firebase-admin.cjs');

async function main() {
  const client = await firebaseAdmin(process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const base = `https://firestore.googleapis.com/v1/projects/${client.project}/databases`;
  const existing = await client.request(base);
  const databases = existing.databases || [];
  const defaultDatabase = databases.find(db => db.name.endsWith('/(default)'));
  if (defaultDatabase) {
    console.log(JSON.stringify({ existing: true, database: defaultDatabase.name, location: defaultDatabase.locationId, type: defaultDatabase.type }));
    return;
  }
  if (databases.length) throw new Error('Another database exists. Stopping to preserve the one-database free quota.');
  if (!process.argv.includes('--create')) {
    console.log(JSON.stringify({ project: client.project, databases: [], next: 'Use --create for Standard Native (default) in asia-southeast1.' }));
    return;
  }
  const operation = await client.request(`${base}?databaseId=%28default%29`, {
    method: 'POST', body: JSON.stringify({ locationId: 'asia-southeast1', type: 'FIRESTORE_NATIVE', databaseEdition: 'STANDARD' }),
  });
  console.log(JSON.stringify({ operation: operation.name, done: !!operation.done, error: operation.error?.message }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
