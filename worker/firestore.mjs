const encoder = new TextEncoder();
let cachedAuth;
const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export async function accessToken(env) {
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (account.project_id !== 'quiztanhoa' || !account.private_key || !account.client_email) throw new Error('Firebase credentials missing');
  if (cachedAuth?.keyId === account.private_key_id && cachedAuth.expires > Date.now()) return cachedAuth.token;
  const encode = value => base64url(encoder.encode(JSON.stringify(value)));
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:account.client_email,
    scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
  const pem = account.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(unsigned));
  const response = await fetch('https://oauth2.googleapis.com/token', {method:'POST',
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${base64url(signature)}`})});
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`Firebase OAuth ${response.status}`);
  cachedAuth={keyId:account.private_key_id,token:body.access_token,expires:Date.now()+Math.min(body.expires_in || 3600,3500)*1000};
  return body.access_token;
}

export function encodeValue(value) {
  if (value === null || value === undefined) return {nullValue:null};
  if (typeof value === 'boolean') return {booleanValue:value};
  if (typeof value === 'number') return Number.isInteger(value) ? {integerValue:String(value)} : {doubleValue:value};
  if (typeof value === 'string') return {stringValue:value};
  if (Array.isArray(value)) return {arrayValue:{values:value.map(encodeValue)}};
  return {mapValue:{fields:Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,encodeValue(v)]))}};
}
export function decodeValue(value) {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values||[]).map(decodeValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decodeValue(v)]));
  throw new Error('Unsupported Firestore field');
}

export class ConflictError extends Error {}

// Native serializable transactions protect uniqueness, pinned attempts, and
// answer/submit races. Normal answer/lease writes do not update a global lock,
// so candidates can save concurrently without contending on one shared record.
export class FirestoreStore {
  constructor(env) {
    this.env=env; this.cache=new Map(); this.queries=new Map(); this.writes=new Map();
    this.prefix=env.FIRESTORE_NAMESPACE||'qt';
    if(!/^qt(?:_[a-z0-9]+)?$/.test(this.prefix))throw new Error('Invalid Firestore namespace');
    this.root='projects/quiztanhoa/databases/(default)/documents';
  }
  async request(path, options={}) {
    const token=await accessToken(this.env);
    const response=await fetch(`https://firestore.googleapis.com/v1/${this.root}${path}`,{...options,
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if (response.status===404 && (!options.method || options.method==='GET')) return null;
    const data=await response.json();
    if (!response.ok) {
      if ([409,412].includes(response.status) || ['ABORTED','FAILED_PRECONDITION'].includes(data.error?.status)) throw new ConflictError('Concurrent write');
      throw new Error(`Firestore HTTP ${response.status} ${data.error?.status||''}`);
    }
    return data;
  }
  path(table,id) { if(!/^[a-zA-Z]+$/.test(table) || !/^[a-zA-Z0-9_-]+$/.test(String(id))) throw new Error('Invalid record ID'); return `${this.prefix}_${table}/${id}`; }
  async begin() {
    const started=await this.request(':beginTransaction',{method:'POST',body:JSON.stringify({options:{readWrite:{}}})});
    this.transaction=started.transaction;
    const document=await this.request(`/${this.prefix}_meta/state?transaction=${encodeURIComponent(this.transaction)}`);
    this.metadata=document ? decodeValue({mapValue:{fields:document.fields}}) : {revision:0,counters:{}};
  }
  async get(table,id) {
    const path=this.path(table,id);
    if(this.writes.has(path)) return this.writes.get(path);
    if(this.cache.has(path)) return this.cache.get(path);
    const doc=await this.request(`/${path}?transaction=${encodeURIComponent(this.transaction)}`);
    const value=doc ? decodeValue({mapValue:{fields:doc.fields}}) : null;
    this.cache.set(path,value);return value;
  }
  async all(table, field, value) {
    const queryKey=JSON.stringify([table,field,value]);
    if(!this.queries.has(queryKey)) {
      const query={from:[{collectionId:`${this.prefix}_${table}`} ]};
      if(field) query.where={fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:encodeValue(value)}};
      const rows=await this.request(':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:query,transaction:this.transaction})});
      const ids=[];
      for(const item of rows||[]) if(item.document) {
        const path=item.document.name.slice(this.root.length+1);
        this.cache.set(path,decodeValue({mapValue:{fields:item.document.fields}}));ids.push(path);
      }
      this.queries.set(queryKey,ids);
    }
    const paths=new Set([...this.queries.get(queryKey),...this.writes.keys()].filter(path=>path.startsWith(`${this.prefix}_${table}/`)));
    return [...paths].map(path=>this.writes.has(path)?this.writes.get(path):this.cache.get(path)).filter(row=>row && (!field || row[field]===value));
  }
  put(table,record,id=record.id) { this.writes.set(this.path(table,id),structuredClone(record));return record; }
  remove(table,id) { this.writes.set(this.path(table,id),null); }
  next(table) { this.metadataDirty=true;const counters=this.metadata.counters ||= {}; counters[table]=(counters[table]||0)+1; return counters[table]; }
  async close() {
    if(!this.transaction)return;
    const transaction=this.transaction;this.transaction=null;
    try{await this.request(':rollback',{method:'POST',body:JSON.stringify({transaction})});}catch{/* Already aborted or closed by Firestore. */}
  }
  async commit() {
    if(!this.writes.size) {await this.close();return;}
    if(this.writes.size>450) throw new Error('Too many records in one operation');
    const writes=[];
    if(this.metadataDirty)writes.push({update:{name:`${this.root}/${this.prefix}_meta/state`,fields:encodeValue({...this.metadata,revision:(this.metadata.revision||0)+1}).mapValue.fields}});
    for(const [path,value] of this.writes) {
      if(value===null) writes.push({delete:`${this.root}/${path}`});
      else {
        if(encoder.encode(JSON.stringify(value)).byteLength>850000) throw new Error('Record exceeds safe Firestore document size');
        writes.push({update:{name:`${this.root}/${path}`,fields:encodeValue(value).mapValue.fields}});
      }
    }
    await this.request(':commit',{method:'POST',body:JSON.stringify({writes,transaction:this.transaction})});
    this.transaction=null;
  }
}
