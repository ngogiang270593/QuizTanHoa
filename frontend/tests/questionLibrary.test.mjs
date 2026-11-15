import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterQuestionLibrary, updateQuestionSelection, questionSelectionSummary } from '../src/questionLibrary.mjs';
const rows = [
  { id: 1, content: 'Đất đai và môi trường', group: 'Common', type: 'SingleChoice', source: 'aaa.docx | Câu 01', points: 1, options: [] },
  { id: 2, content: 'Khoa học công nghệ', group: 'Specialized', type: 'TrueFalse', source: 'bbb.docx', points: 2.5, options: [{text:'Chuyển đổi số'}] },
];
test('accent insensitive search combines terms and source/type/group filters', () => {
  assert.deepEqual(filterQuestionLibrary(rows, {search:'dat moi aaa', source:'aaa.docx', type:'SingleChoice', group:'Common'}).map(q=>q.id), [1]);
  assert.deepEqual(filterQuestionLibrary(rows, {search:'chuyen doi'}).map(q=>q.id), [2]);
  assert.equal(filterQuestionLibrary(rows, {group:'Common', type:'TrueFalse'}).length, 0);
});
test('selection persists across filters and deselecting matching results keeps other selections', () => {
  let selected = updateQuestionSelection([], [1], true);
  selected = updateQuestionSelection(selected, [2], true);
  assert.deepEqual(updateQuestionSelection(selected, [1], false), [2]);
  assert.deepEqual(updateQuestionSelection(selected, [1], true), [1,2]);
  assert.throws(()=>updateQuestionSelection(selected, [3,4], true, 3), RangeError);
  assert.deepEqual(selected, [1,2]);
});
test('basket summarizes actual group counts and points', () => {
  assert.deepEqual(questionSelectionSummary(rows), {count:2, common:1, specialized:1, totalPoints:3.5});
});

import { selectWholeTopic, topicSelectionIds, applyTopicSelection } from '../src/questionLibrary.mjs';
test('topic defaults to every question and keeps exact IDs after multi deselection and restore', () => {
  const bank = [...rows, { ...rows[0], id: 3 }, { ...rows[0], id: 4, topic: 'Hành chính' }];
  let topics = [selectWholeTopic(bank, 'aaa.docx'), selectWholeTopic(bank, 'Hành chính')];
  assert.deepEqual(topicSelectionIds(topics), [1,3,4]);
  topics = applyTopicSelection(topics, [bank[2], bank[3]]);
  assert.deepEqual(topics[0].questionIds, [3]);
  assert.deepEqual(topicSelectionIds(topics), [3,4]);
  // Rechecking a previously removed question in the modal must add it back.
  topics = applyTopicSelection(topics, [bank[0], bank[2], bank[3]]);
  assert.deepEqual(topicSelectionIds(topics), [1,3,4]);
  assert.deepEqual(applyTopicSelection(topics, [])[0].questionIds, []);
  assert.deepEqual(selectWholeTopic(bank, 'aaa.docx').questionIds, [1,3]);
  assert.deepEqual(topicSelectionIds(topics.filter(t => t.topic !== 'aaa.docx')), [4]);
});
test('oversized topics select all initially and allow progressive removal until under limit', () => {
  const bank = Array.from({length:450}, (_,i)=>({...rows[0],id:i+1,topic:'Lớn'}));
  const selected = selectWholeTopic(bank,'Lớn').questionIds;
  assert.equal(selected.length,450);
  let next = updateQuestionSelection(selected, [1], false);
  assert.equal(next.length,449);
  next = updateQuestionSelection(next, bank.slice(1,51).map(q=>q.id), false);
  assert.equal(next.length,399);
  assert.throws(()=>updateQuestionSelection(next,[1,2],true),RangeError);
});
test('topic filtering scopes bulk deselection while preserving questions in other topics', () => {
  const bank = rows.map((q,i)=>({...q,topic:i?'Hành chính':'Đất đai'}));
  const filtered = filterQuestionLibrary(bank,{topic:'Đất đai',search:'dat'});
  assert.deepEqual(filtered.map(q=>q.id),[1]);
  assert.deepEqual(updateQuestionSelection([1,2],filtered.map(q=>q.id),false),[2]);
});
