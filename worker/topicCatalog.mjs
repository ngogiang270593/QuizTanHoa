import {ensure,text,json,now} from './common.mjs';
import {topicLabel} from './topics.mjs';
const key=name=>name.normalize('NFC').trim().toLocaleLowerCase('vi');
export async function topicCatalog(db) {
 const catalog=await db.all('topics');
 for(const q of await db.all('bank')) {
  const name=topicLabel(q);if(!q.isActive||name==='Chưa phân chủ đề'||catalog.some(t=>key(t.name)===key(name)))continue;
  const topic={id:db.next('topics'),name,createdAtUtc:now(),updatedAtUtc:now()};db.put('topics',topic);catalog.push(topic);
 }
 return catalog;
}
export async function topicsRoute(ctx) {
 const {db,body,method,parts}=ctx;
 const catalog=await topicCatalog(db),bank=await db.all('bank');
 if(parts.length===3&&method==='GET')return json(catalog.sort((a,b)=>a.name.localeCompare(b.name,'vi')).map(t=>({...t,questionCount:bank.filter(q=>q.isActive&&topicLabel(q)===t.name).length})));
 const name=['POST','PUT'].includes(method)?text(body.name,200,true).normalize('NFC'):null;
 if(parts.length===3&&method==='POST') {
  ensure(!catalog.some(t=>key(t.name)===key(name)),'Tên chủ đề đã tồn tại.',409);
  ensure(name!=='Chưa phân chủ đề','Tên này dành cho câu hỏi chưa phân chủ đề.');
  const topic={id:db.next('topics'),name,createdAtUtc:now(),updatedAtUtc:now()};db.put('topics',topic);return json({...topic,questionCount:0},201);
 }
 const topic=catalog.find(t=>t.id===Number(parts[3]));ensure(topic,'Không tìm thấy chủ đề.',404);
 if(parts.length===4&&method==='PUT') {
  ensure(!catalog.some(t=>t.id!==topic.id&&key(t.name)===key(name)),'Tên chủ đề đã tồn tại.',409);
  ensure(name!=='Chưa phân chủ đề','Tên này dành cho câu hỏi chưa phân chủ đề.');
  const old=topic.name,bankIds=new Set(bank.filter(q=>topicLabel(q)===old).map(q=>q.id));
  const linked=(await db.all('questions')).filter(q=>bankIds.has(q.bankQuestionId)||q.topic===old);
  ensure(bankIds.size+linked.length<440,'Chủ đề có quá nhiều liên kết để đổi tên trong một lần.',409);
  for(const q of bank)if(bankIds.has(q.id)){q.topic=name;q.updatedAtUtc=now();db.put('bank',q);}
  const changed=new Set();for(const q of linked){q.topic=name;db.put('questions',q);changed.add(q.examId);}
  for(const id of changed){const exam=await db.get('exams',id);ensure(exam.reviewStatus!=='PendingReview','Có đề đang chờ duyệt sử dụng chủ đề này. Hãy rút hoặc trả lại đề trước.',409);exam.reviewStatus='Draft';exam.draftRevision++;exam.updatedAtUtc=now();db.put('exams',exam);}
  topic.name=name;topic.updatedAtUtc=now();db.put('topics',topic);ensure(db.writes.size<=449,'Có quá nhiều liên kết để đổi tên cùng lúc.',409);return json({...topic,questionCount:bank.filter(q=>q.isActive&&bankIds.has(q.id)).length});
 }
 if(parts.length===4&&method==='DELETE') {
  ensure(!bank.some(q=>q.isActive&&topicLabel(q)===topic.name),'Chủ đề đang có câu hỏi. Hãy chuyển các câu sang chủ đề khác trước khi xóa.',409);
  db.remove('topics',topic.id);return json(null,204);
 }
}
