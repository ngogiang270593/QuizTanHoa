import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api.js';
import { QuestionIcon } from './QuestionEditor.jsx';
import { answerLabel, QUESTION_TYPES } from './questionDraft.mjs';
import { filterQuestionLibrary, questionSelectionSummary, questionSourceLabel, questionTopicLabel, updateQuestionSelection } from './questionLibrary.mjs';
import './QuestionLibraryPicker.css';

const EMPTY_IDS = [];
export default function QuestionLibraryPicker({ initialSelectedIds = EMPTY_IDS, excludedIds = EMPTY_IDS, allowedIds = null, maximum = 400, context = 'Chọn câu hỏi cho cuộc thi', confirmLabel = 'Áp dụng lựa chọn', showSyncCounts = false, onConfirm, onCancel }) {
  const [questions, setQuestions] = useState([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(() => [...new Set(initialSelectedIds)]);
  const [filters, setFilters] = useState({ search: '', group: '', type: '', source: '', topic: '' });
  const [page, setPage] = useState(1), [expanded, setExpanded] = useState(null), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [syncCounts, setSyncCounts] = useState(true);
  const modal = useRef(null), search = useRef(null), allCheckbox = useRef(null), operation = useRef(false), locked = useRef(false);
  locked.current = saving;
  const titleId = useId(), descriptionId = useId();
  const excluded = useMemo(() => new Set(excludedIds), [excludedIds]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const scopedQuestions = useMemo(() => allowedIds === null ? questions : questions.filter(q => allowedIds.includes(q.id)), [questions, allowedIds]);

  useEffect(() => {
    const node = modal.current, previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; node.showModal();
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => { cancelAnimationFrame(frame); if (node.open) node.close(); document.body.style.overflow = overflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError('');
    api.get('/organizer/question-bank', { signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setQuestions(Array.isArray(data) ? data : []); })
      .catch(failure => { if (!controller.signal.aborted) setLoadError(failure.response?.data?.message || 'Chưa tải được thư viện câu hỏi. Vui lòng thử lại.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    if (loading || loadError) return;
    const available = new Set(scopedQuestions.filter(q => !excluded.has(q.id)).map(q => q.id));
    setSelected(current => { const next = current.filter(id => available.has(id)); return next.length === current.length ? current : next; });
  }, [scopedQuestions, excluded, loading, loadError]);

  const visible = useMemo(() => filterQuestionLibrary(scopedQuestions, filters), [scopedQuestions, filters]);
  const eligible = visible.filter(q => !excluded.has(q.id));
  const allSelected = eligible.length > 0 && eligible.every(q => selectedSet.has(q.id));
  const someSelected = eligible.some(q => selectedSet.has(q.id));
  useEffect(() => { if (allCheckbox.current) allCheckbox.current.indeterminate = !allSelected && someSelected; }, [allSelected, someSelected]);
  const selectedRows = useMemo(() => { const map = new Map(scopedQuestions.map(q => [q.id, q])); return selected.map(id => map.get(id)).filter(Boolean); }, [scopedQuestions, selected]);
  const summary = questionSelectionSummary(selectedRows), pages = Math.max(1, Math.ceil(visible.length / 20)), currentPage = Math.min(page, pages), rows = visible.slice((currentPage - 1) * 20, currentPage * 20);
  const sources = [...new Set(scopedQuestions.map(questionSourceLabel))].sort((a, b) => a.localeCompare(b, 'vi'));

  const topics = [...new Set(scopedQuestions.map(questionTopicLabel))].sort((a,b) => a.localeCompare(b,'vi'));

  function filter(key, value) { setFilters(current => ({ ...current, [key]: value })); setPage(1); }
  function select(ids, checked) {
    if (saving) return;
    try { setSelected(updateQuestionSelection(selected, ids, checked, maximum)); setError(''); }
    catch (failure) { setError(failure.message); }
  }
  function close() { if (!locked.current) onCancel(); }
  async function confirm() {
    if (operation.current || loading || loadError) return;
    if (selectedRows.length > maximum) { setError(`Đề đang có ${selectedRows.length} câu. Hãy bỏ bớt để còn tối đa ${maximum} câu.`); return; }
    if (showSyncCounts && selectedRows.length === 0) { setError('Chọn ít nhất một câu để thêm vào đề.'); return; }
    operation.current = true; setSaving(true); setError('');
    try { await onConfirm(selectedRows, { syncCounts }); }
    catch (failure) { setError(failure.response?.data?.message || failure.message || 'Chưa thêm được câu hỏi. Lựa chọn của bạn vẫn được giữ lại.'); }
    finally { operation.current = false; setSaving(false); }
  }

  return createPortal(<dialog ref={modal} className="question-library-dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target !== modal.current) return; const r = modal.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); }}>
    <div className="ql-shell"><header className="ql-header"><div className="ql-header-icon"><QuestionIcon name="plus" size={23} /></div><div><span>THƯ VIỆN CÂU HỎI</span><h2 id={titleId}>{context}</h2><p id={descriptionId}>{allowedIds === null ? 'Chọn nhiều câu, kiểm tra danh sách bên phải rồi xác nhận.' : 'Các câu của chủ đề đã được tích sẵn. Bỏ tích từng câu hoặc dùng ô chọn tất cả để bỏ hàng loạt kết quả đang lọc.'} Lựa chọn được giữ khi đổi bộ lọc.</p></div><button type="button" className="qe-close" onClick={close} disabled={saving} aria-label="Đóng thư viện câu hỏi"><QuestionIcon name="close" size={22} /></button></header>
      <div className="ql-content"><section className="ql-library">
        <div className="ql-filters"><label className="ql-search">Tìm kiếm<input ref={search} type="search" value={filters.search} maxLength={200} disabled={saving} onChange={event => filter('search', event.target.value)} placeholder="Nội dung, từ khóa hoặc tên tài liệu…" /></label><label>Chủ đề<select value={filters.topic} disabled={saving} onChange={event => filter('topic', event.target.value)}><option value="">Tất cả chủ đề</option>{topics.map(topic => <option key={topic} value={topic}>{topic}</option>)}</select></label><label>Loại câu hỏi<select value={filters.type} disabled={saving} onChange={event => filter('type', event.target.value)}><option value="">Tất cả loại</option>{Object.entries(QUESTION_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Tài liệu nguồn<select value={filters.source} disabled={saving} onChange={event => filter('source', event.target.value)}><option value="">Tất cả tài liệu</option>{sources.map(source => <option key={source} value={source}>{source}</option>)}</select></label></div>
        <div className="ql-list-toolbar"><label><input ref={allCheckbox} type="checkbox" checked={allSelected} disabled={saving || loading || eligible.length === 0} onChange={event => select(eligible.map(q => q.id), event.target.checked)} />{allSelected ? 'Bỏ chọn' : 'Chọn tất cả'} {eligible.length} kết quả</label><button type="button" className="text-button" disabled={saving || loading || !someSelected} onClick={() => select(eligible.map(q => q.id), false)}>Bỏ chọn kết quả đang lọc</button><span>{visible.length} câu phù hợp · tối đa {maximum} câu/lần</span></div>
        {loadError && <div className="ql-message" role="alert">{loadError} <button type="button" onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div>}
        {error && <div className="ql-message" role="alert">{error}</div>}{selectedRows.length > maximum && <div className="ql-message" role="alert">Đang chọn {selectedRows.length} câu. Hãy bỏ bớt để còn tối đa {maximum} câu trước khi áp dụng.</div>}
        {loading ? <div className="ql-empty" role="status">Đang tải thư viện câu hỏi…</div> : !visible.length ? <div className="ql-empty"><QuestionIcon name="eye" size={28} /><strong>Không có câu hỏi phù hợp</strong><p>Thử bỏ bớt bộ lọc hoặc bổ sung câu hỏi tại Ngân hàng câu hỏi.</p></div> : <ul className="ql-question-list">{rows.map(question => {
          const already = excluded.has(question.id), chosen = selectedSet.has(question.id);
          return <li className={`${chosen ? 'selected' : ''} ${already ? 'already-added' : ''}`} key={question.id}><div className="ql-row"><label className="ql-question-select"><input type="checkbox" checked={chosen || already} disabled={saving || already} onChange={event => select([question.id], event.target.checked)} /><span><span className="ql-question-meta"><small>{QUESTION_TYPES[question.type]}</small><small>{question.points} điểm</small>{already && <small className="ql-existing">Đã có trong đề</small>}</span><strong>{question.content || 'Câu hỏi chưa có nội dung'}</strong><span className="ql-source">{questionTopicLabel(question)} · {questionSourceLabel(question)}</span></span></label><button type="button" className="ql-view" disabled={saving} onClick={() => setExpanded(expanded === question.id ? null : question.id)} aria-expanded={expanded === question.id}><QuestionIcon name="eye" size={15} />{expanded === question.id ? 'Thu gọn' : 'Xem'}</button></div>{expanded === question.id && <div className="ql-question-detail"><p>{question.content}</p><ul>{(question.options || []).map(option => <li className={option.key === question.correctAnswer ? 'correct' : ''} key={option.key}><strong>{answerLabel(option.key)}.</strong><span>{option.text}</span>{option.key === question.correctAnswer && <QuestionIcon name="check" size={15} />}</li>)}</ul><small>{question.source}</small></div>}</li>;
        })}</ul>}
        {pages > 1 && <nav className="ql-pagination" aria-label="Trang thư viện câu hỏi"><button type="button" disabled={saving || currentPage === 1} onClick={() => setPage(currentPage - 1)}>← Trước</button><span>Trang {currentPage} / {pages}</span><button type="button" disabled={saving || currentPage === pages} onClick={() => setPage(currentPage + 1)}>Sau →</button></nav>}
      </section><aside className="ql-basket"><div className="ql-basket-heading"><h3>Đã chọn <span>{summary.count}</span></h3><button type="button" disabled={saving || !selected.length} onClick={() => { setSelected([]); setError(''); }}>Bỏ chọn tất cả</button></div><div className="ql-summary"><div><strong>{summary.count}</strong><span>Câu hỏi</span></div><div><strong>{new Set(selectedRows.map(questionTopicLabel)).size}</strong><span>Chủ đề</span></div><div><strong>{summary.totalPoints}</strong><span>Tổng điểm</span></div></div>{!selectedRows.length ? <div className="ql-basket-empty">Tích chọn câu hỏi trong thư viện để thêm vào danh sách này.</div> : <ol className="ql-selected-list">{selectedRows.map((question, index) => <li key={question.id}><span>{index + 1}</span><div><strong>{question.content}</strong><small>{questionTopicLabel(question)} · {question.points} điểm</small></div><button type="button" disabled={saving} aria-label={`Bỏ chọn câu ${index + 1}`} onClick={() => select([question.id], false)}><QuestionIcon name="close" size={15} /></button></li>)}</ol>}<p className="ql-basket-note">Câu đã có trong đề được đánh dấu và không thể thêm trùng.</p></aside></div>
      <footer className="ql-footer"><div>{showSyncCounts ? <label><input type="checkbox" checked={syncCounts} disabled={saving} onChange={event => setSyncCounts(event.target.checked)} />Tự khớp số câu và cơ cấu đề sau khi thêm</label> : <span>Số câu và cơ cấu đề được thiết lập theo danh sách đã chọn.</span>}</div><div><button type="button" className="button button-secondary" disabled={saving} onClick={close}>Hủy</button><button type="button" className="button button-primary" disabled={saving || loading || Boolean(loadError) || showSyncCounts && selectedRows.length === 0} onClick={confirm}>{saving ? 'Đang áp dụng…' : `${confirmLabel} (${selectedRows.length})`}</button></div></footer>
    </div>
  </dialog>, document.body);
}
