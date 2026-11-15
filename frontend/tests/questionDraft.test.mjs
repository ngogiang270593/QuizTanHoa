import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuestionDraft, emptyQuestion, questionErrors, questionPayload } from '../src/questionDraft.mjs';

test('editing True/False keeps its type, answer, scenario, points and source details', () => {
  const original = { id: 8, type: 'TrueFalse', group: 'Specialized', content: 'Phát biểu kiểm tra.', options: [{ key: 'True', text: 'Đúng' }, { key: 'False', text: 'Sai' }], correctAnswer: 'False', points: 2.5, isScenario: true, explanation: 'Giải thích.', source: 'Văn bản tham khảo.', requiresSourceReview: true, sourceReviewed: true };
  const draft = createQuestionDraft(original);
  draft.content = 'Phát biểu đã sửa.';
  const payload = questionPayload(draft);
  assert.equal(payload.type, 'TrueFalse');
  assert.equal(payload.correctAnswer, 'False');
  for (const key of ['group', 'points', 'isScenario', 'explanation', 'source', 'requiresSourceReview', 'sourceReviewed']) assert.deepEqual(payload[key], original[key]);
  assert.deepEqual(payload.options, original.options);
  assert.equal(original.content, 'Phát biểu kiểm tra.');
  assert.deepEqual(questionErrors(draft), {});
});

test('editing does not truncate six options or remap nonstandard answer keys', () => {
  const options = Array.from({ length: 6 }, (_, i) => Object.freeze({ key: `choice${i + 1}`, text: `Phương án ${i + 1}` }));
  const original = Object.freeze({ ...emptyQuestion(), options: Object.freeze(options), content: 'Câu hỏi sáu phương án?', correctAnswer: 'choice6' });
  const draft = createQuestionDraft(original);
  draft.options[5].text = 'Nội dung sửa';
  const payload = questionPayload(draft);
  assert.equal(payload.options.length, 6);
  assert.equal(payload.correctAnswer, 'choice6');
  assert.deepEqual(payload.options.map(o => o.key), options.map(o => o.key));
  assert.equal(original.options[5].text, 'Phương án 6');
  assert.deepEqual(questionErrors(draft), {});
});

test('missing answers are not silently chosen when saving a draft', () => {
  const draft = createQuestionDraft({ ...emptyQuestion(), content: 'Câu hỏi đang soạn.' });
  assert.ok(questionErrors(draft).answer);
  assert.ok(questionErrors(draft)['option:A']);
  assert.equal(questionPayload(draft).correctAnswer, null);
});

test('points and scenario are not silently reset to one and false', () => {
  const draft = createQuestionDraft({ ...emptyQuestion(), points: 0, isScenario: true });
  assert.equal(draft.points, 0);
  assert.equal(questionPayload(draft).points, 0);
  assert.equal(questionPayload(draft).isScenario, true);
  assert.ok(questionErrors(draft).points);
});

test('removed or invalid answer keys must be corrected before a complete save', () => {
  const draft = createQuestionDraft({ ...emptyQuestion(), content: 'Nội dung', options: [{ key: 'A', text: 'Một' }, { key: 'B', text: 'Hai' }], correctAnswer: 'C' });
  assert.ok(questionErrors(draft).answer);
  draft.correctAnswer = 'B';
  assert.deepEqual(questionErrors(draft), {});
});

test('duplicate option keys and empty or nonpositive points produce actionable errors', () => {
  const draft = createQuestionDraft({ ...emptyQuestion(), content: 'Nội dung', options: [{ key: 'A', text: 'Một' }, { key: 'a', text: 'Hai' }], correctAnswer: 'A', points: '' });
  assert.ok(questionErrors(draft).options);
  assert.ok(questionErrors(draft).points);
});

test('source review cannot remain confirmed without an actual source', () => {
  assert.equal(questionPayload(createQuestionDraft({ source: '', sourceReviewed: true })).sourceReviewed, false);
});
