export const QUESTION_TYPES = { SingleChoice: 'Một đáp án đúng', TrueFalse: 'Đúng / Sai' };
export const QUESTION_GROUPS = { Common: 'Kiến thức chung', Specialized: 'Chuyên môn' };
export const trueFalseOptions = () => [{ key: 'True', text: 'Đúng' }, { key: 'False', text: 'Sai' }];
export const emptyQuestion = () => ({ topic: '', type: 'SingleChoice', group: 'Common', content: '', options: ['A', 'B', 'C', 'D'].map(key => ({ key, text: '' })), correctAnswer: '', points: 1, isScenario: false, explanation: '', source: '', requiresSourceReview: false, sourceReviewed: false });

export function createQuestionDraft(question = {}) {
  const draft = { ...emptyQuestion(), ...question };
  draft.options = draft.type === 'TrueFalse' ? trueFalseOptions()
    : (Array.isArray(question.options) ? question.options : emptyQuestion().options).map(option => ({ key: option.key, text: option.text ?? '' }));
  for (const field of ['content', 'explanation', 'source', 'correctAnswer']) draft[field] ??= '';
  draft.points ??= 1;
  return draft;
}

export function questionErrors(fields) {
  const errors = {};
  if (!QUESTION_TYPES[fields.type]) errors.type = 'Chọn loại câu hỏi hợp lệ.';

  if (!fields.content.trim()) errors.content = 'Nhập nội dung câu hỏi.';
  else if (fields.content.length > 5000) errors.content = 'Nội dung tối đa 5.000 ký tự.';
  const options = fields.type === 'TrueFalse' ? trueFalseOptions() : fields.options;
  if (options.length < 2 || options.length > 6) errors.options = 'Cần từ 2 đến 6 phương án trả lời.';
  if (new Set(options.map(o => o.key.toLowerCase())).size !== options.length) errors.options = 'Mã phương án không được trùng nhau.';
  for (const option of options) {
    if (!option.text.trim()) errors[`option:${option.key}`] = `Nhập nội dung phương án ${option.key}.`;
    else if (option.text.length > 2000) errors[`option:${option.key}`] = 'Mỗi phương án tối đa 2.000 ký tự.';
  }
  if (!options.some(option => option.key === fields.correctAnswer)) errors.answer = 'Chọn một đáp án đúng bằng nút tròn trên phương án.';
  if (!Number.isFinite(Number(fields.points)) || Number(fields.points) <= 0 || Number(fields.points) > 1000) errors.points = 'Điểm phải lớn hơn 0 và không vượt quá 1.000.';
  return errors;
}

export function questionPayload(fields) {
  return { ...fields, options: fields.type === 'TrueFalse' ? trueFalseOptions() : fields.options.map(option => ({ ...option })),
    content: fields.content.trim(), correctAnswer: fields.correctAnswer || null, points: Number(fields.points),
    isScenario: fields.isScenario === true, sourceReviewed: fields.sourceReviewed === true && Boolean(fields.source.trim()) };
}

export function answerLabel(value) { return value === 'True' ? 'Đúng' : value === 'False' ? 'Sai' : value || 'Chưa chọn'; }
