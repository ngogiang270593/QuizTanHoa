import {ensure} from './common.mjs';
export const topicLabel=q=>q.topic?.trim() || q.source?.split('|')[0].trim() || 'Chưa phân chủ đề';
export function selectTopicQuestions(bank, quotas) {
  ensure(Array.isArray(quotas)&&quotas.length>0&&quotas.length<=400,'Chọn ít nhất một chủ đề.');
  const seen=new Set(),selected=[];
  for(const quota of quotas) {
    const topic=typeof quota.topic==='string'?quota.topic.trim():'';
    ensure(topic&&!seen.has(topic),'Chủ đề không hợp lệ hoặc bị trùng.');seen.add(topic);
    const pool=bank.filter(q=>q.isActive&&topicLabel(q)===topic);
    ensure(Number.isInteger(quota.count)&&quota.count>0&&quota.count<=pool.length,`Chủ đề ${topic} có ${pool.length} câu; hãy chọn số câu phù hợp.`);
    for(let i=pool.length-1;i>0;i--){const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);const j=bytes[0]%(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
    selected.push(...pool.slice(0,quota.count));
    ensure(selected.length<=400,'Tổng số câu tối đa là 400.');
  }
  return selected;
}
