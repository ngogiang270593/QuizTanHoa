import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import QuestionLibraryPicker from './QuestionLibraryPicker.jsx';
import { applyTopicSelection, normalizeQuestionSearch, questionTopicLabel, selectWholeTopic, topicSelectionIds } from './questionLibrary.mjs';

export const topicLabel = questionTopicLabel;

export default function TopicQuotaPicker({ value, onChange, disabled, onValidity }) {
  const [bank, setBank] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [revision, setRevision] = useState(0), [search, setSearch] = useState(''), [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get('/organizer/question-bank', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setBank(Array.isArray(data) ? data : []);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Không thể tải chủ đề. Vui lòng thử lại.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  const topics = useMemo(() => {
    const groups = new Map();
    bank.forEach(q => { const topic = topicLabel(q); if (!groups.has(topic)) groups.set(topic, []); groups.get(topic).push(q); });
    return [...groups].sort(([a], [b]) => a.localeCompare(b, 'vi'));
  }, [bank]);
  const ids = topicSelectionIds(value), selectedTopics = new Set(value.map(q => q.topic));
  const allowedIds = bank.filter(q => selectedTopics.has(topicLabel(q))).map(q => q.id), available = new Set(allowedIds);
  const valid = !loading && !error && value.length > 0 && ids.length > 0 && ids.length <= 400 && ids.every(id => available.has(id));
  useEffect(() => { onValidity(valid); }, [valid, onValidity]);
  function review(rows) { onChange(applyTopicSelection(value, rows)); setReviewing(false); }
  return <div className="topic-picker" aria-busy={loading}>
    <p>Chọn chủ đề để lấy toàn bộ câu hỏi. Sau đó mở danh sách để bỏ từng câu hoặc bỏ chọn nhiều câu cùng lúc.</p>
    {loading ? <p role="status">Đang tải chủ đề…</p> : error ? <div role="alert">{error} <button type="button" disabled={disabled} onClick={() => setRevision(n => n + 1)}>Thử lại</button></div> : <>
      <label>Tìm chủ đề<input type="search" value={search} disabled={disabled} onChange={e => setSearch(e.target.value)} placeholder="Nhập tên chủ đề…" /></label>
      <div className="topic-quota-list">{topics.filter(([t]) => normalizeQuestionSearch(t).includes(normalizeQuestionSearch(search))).map(([topic, questions]) => {
        const chosen = value.find(q => q.topic === topic);
        return <div className={`topic-quota-row${chosen ? ' topic-selected' : ''}`} key={topic}>
          <label><input type="checkbox" disabled={disabled} checked={Boolean(chosen)} onChange={e => onChange(e.target.checked ? [...value, selectWholeTopic(bank, topic)] : value.filter(q => q.topic !== topic))} /><span>{topic}<small>{chosen ? `${chosen.questionIds.length} / ${questions.length} câu được giữ lại` : `${questions.length} câu · mặc định chọn tất cả`}</small></span></label>
          {chosen && <button type="button" className="text-button" disabled={disabled || chosen.questionIds.length === questions.length} onClick={() => onChange(value.map(q => q.topic === topic ? selectWholeTopic(bank, topic) : q))}>Khôi phục tất cả</button>}
        </div>;
      })}</div>
      {!topics.length ? <p>Ngân hàng chưa có câu hỏi. Hãy thêm câu hỏi và gán chủ đề trước.</p> : !topics.some(([t]) => normalizeQuestionSearch(t).includes(normalizeQuestionSearch(search))) && <p>Không tìm thấy chủ đề phù hợp.</p>}
    </>}
    <div className="cqs-summary" aria-live="polite"><strong>{value.length} chủ đề · {ids.length} câu được giữ lại</strong><span>Tối đa 400 câu / đề</span></div>
    {value.length > 0 && <div className="topic-review-actions"><button type="button" className="button button-secondary" disabled={disabled || loading || Boolean(error)} onClick={() => setReviewing(true)}>Xem và bỏ chọn câu hỏi ({ids.length})</button><small>Bỏ chọn câu chỉ loại khỏi đề đang tạo; câu hỏi vẫn được giữ trong ngân hàng.</small></div>}
    {value.length > 0 && !valid && !loading && !error && <p role="alert" className="competition-field-error">{ids.length > 400 ? `Đang chọn ${ids.length} câu. Mở danh sách để bỏ bớt, còn tối đa 400 câu.` : 'Đề cần ít nhất 1 câu đang hoạt động. Hãy chọn lại hoặc khôi phục câu hỏi.'}</p>}
    {reviewing && <QuestionLibraryPicker initialSelectedIds={ids} allowedIds={allowedIds} context="Rà soát câu hỏi theo chủ đề" confirmLabel="Giữ các câu đã chọn" onConfirm={review} onCancel={() => setReviewing(false)} />}
  </div>;
}
