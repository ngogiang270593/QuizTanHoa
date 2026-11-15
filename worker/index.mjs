import {FirestoreStore,ConflictError} from './firestore.mjs';
import {HttpError,ensure,fail,json,now,TIME_ZONE} from './common.mjs';
import {authenticate,authRoute} from './auth.mjs';
import {organizerRoute} from './organizer.mjs';
import {candidateRoute} from './attempts.mjs';

async function readBody(request) {
  if(!request.body)return {};
  const multipart=request.headers.get('Content-Type')?.startsWith('multipart/form-data'),limit=multipart?5*1024*1024+131072:1024*1024;
  ensure(Number(request.headers.get('Content-Length')||0)<=limit,'Dữ liệu gửi lên vượt giới hạn.',413);
  const reader=request.body.getReader(),chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail(413,'Dữ liệu gửi lên vượt giới hạn.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(multipart)return {form:await new Response(bytes,{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData()};
  if(!size)return {};
  ensure(request.headers.get('Content-Type')?.includes('application/json'),'Yêu cầu dữ liệu JSON.',415);
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'Dữ liệu JSON không hợp lệ.');}
  ensure(body&&typeof body==='object'&&!Array.isArray(body),'Dữ liệu JSON phải là một đối tượng.');return {body};
}
export async function handleApi(request,env,makeStore=()=>new FirestoreStore(env)) {
  const url=new URL(request.url),path=url.pathname.replace(/\/+$/,'').toLowerCase(),method=request.method.toUpperCase();
  try {
    const origin=request.headers.get('Origin');
    if(origin)ensure(origin===url.origin||origin==='https://quiztanhoa.pages.dev','Nguồn truy cập không được phép.',403);
    if(method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin||url.origin,'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Quiz-Attempt-Tab','Access-Control-Max-Age':'600','Vary':'Origin'}});
    if(path==='/api/system/public'&&method==='GET')return json({application:'Quiz_TanHoa',timeZone:TIME_ZONE,serverTimeUtc:now(),demoEnabled:false,demoAccounts:[]});
    const input=['GET','HEAD'].includes(method)?{}:await readBody(request);
    for(let attempt=0;attempt<3;attempt++) {
      const db=makeStore();
      try {
        await db.begin();
        if(path==='/api/health'&&method==='GET'){await db.commit();return json({application:'Quiz_TanHoa',status:'ok',timeZone:TIME_ZONE,storage:'Firestore',environment:env.FIRESTORE_NAMESPACE==='qt_verify'?'preview':'production'});}
        const ctx={request,env,url,path,parts:path.split('/').filter(Boolean),method,db,body:input.body||{},form:input.form};
        if(path!=='/api/auth/login'||method!=='POST')await authenticate(ctx);
        const response=await authRoute(ctx)||await organizerRoute(ctx)||await candidateRoute(ctx);
        if(!response)fail(404,'Không tìm thấy API.');
        await db.commit();return response;
      }catch(error){await db.close();if(error instanceof ConflictError&&attempt<2)continue;throw error;}
    }
  }catch(error){
    if(error instanceof HttpError)return json({message:error.message,...error.extra},error.status);
    if(error instanceof ConflictError)return json({message:'Dữ liệu vừa được cập nhật ở phiên khác. Vui lòng thử lại.'},409);
    // Only short infrastructure errors; never log request bodies or secret bindings.
    console.error('API failure',error?.message?.startsWith('Firestore')?error.message:error?.name||'Error');
    return json({message:'Máy chủ gặp lỗi. Vui lòng thử lại sau.'},503);
  }
}
export default {async fetch(request,env) {
  const path=new URL(request.url).pathname;
  if(path.toLowerCase()==='/api'||path.toLowerCase().startsWith('/api/'))return handleApi(request,env);
  return env.ASSETS.fetch(request);
}};
