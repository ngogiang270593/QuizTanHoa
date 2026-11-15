export const normalizeQuestionSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
export const questionSourceLabel = question => (question.source || '').split('|')[0].trim() || 'Chưa ghi nguồn';
export const questionTopicLabel = question => question.topic?.trim() || question.source?.split('|')[0].trim() || 'Chưa phân chủ đề';
export function selectWholeTopic(questions, topic) {
  return { topic, questionIds: questions.filter(q => questionTopicLabel(q) === topic).map(q => q.id) };
}
export function topicSelectionIds(topics) {
  return [...new Set(topics.flatMap(topic => topic.questionIds || []))];
}
export function applyTopicSelection(topics, questions) {
  return topics.map(topic => ({ ...topic, questionIds: questions.filter(q => questionTopicLabel(q) === topic.topic).map(q => q.id) }));
}
export function filterQuestionLibrary(questions, { search = '', group = '', type = '', source = '', topic = '' } = {}) {
  const terms = normalizeQuestionSearch(search).trim().split(/\s+/).filter(Boolean);
  return questions.filter(question => (!topic || questionTopicLabel(question) === topic) && (!group || question.group === group) && (!type || question.type === type) && (!source || questionSourceLabel(question) === source)
    && terms.every(term => normalizeQuestionSearch(`${question.content} ${question.source || ''} ${(question.options || []).map(o => o.text).join(' ')}`).includes(term)));
}
export function updateQuestionSelection(selected, ids, checked, maximum = 400) {
  const next = new Set(selected);
  for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
  if (checked && next.size > maximum) throw new RangeError(`Bạn có thể chọn tối đa ${maximum} câu trong lần này. Hãy thu hẹp bộ lọc hoặc bỏ bớt câu đã chọn.`);
  return [...next];
}
export function questionSelectionSummary(questions) {
  return { count: questions.length, common: questions.filter(q => q.group === 'Common').length,
    specialized: questions.filter(q => q.group === 'Specialized').length,
    totalPoints: Math.round(questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0) * 1000000) / 1000000 };
}
