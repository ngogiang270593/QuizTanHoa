import {useAccess} from './AccessContext.jsx';
import { Fragment, useEffect, useState } from 'react';
import {updateQuestionSelection} from './questionLibrary.mjs';
import './TopicCatalog.css';
import {topicLabel} from './TopicQuotaPicker.jsx';
import { api } from './api.js';
import { emptyQuestion, QuestionForm, QuestionCard, QuestionIcon } from './QuestionEditor.jsx';
import { QUESTION_TYPES } from './questionDraft.mjs';
import './QuestionBankWorkspace.css';

function message(error) {
  const data = error.response?.data;
  const errors = data?.errors;
  const details = errors && typeof errors === 'object' ? Object.values(errors).flat().filter(value => typeof value === 'string') : [];
  return details.length ? details.join(' ') : data?.message || 'Chưa thực hiện được thao tác. Vui lòng thử lại.';
}

export default function QuestionBankWorkspace() {
 const {can}=useAccess();
  const [catalog, setCatalog] = useState([]);
  const [selected, setSelected] = useState([]);
  const [targetTopic, setTargetTopic] = useState('');
  useEffect(() => { const c = new AbortController(); api.get('/organizer/topics', {signal:c.signal}).then(({data}) => {if(!c.signal.aborted)setCatalog(data);}).catch(() => {if(!c.signal.aborted)setError('Không tải được danh mục chủ đề.');}); return () => c.abort(); }, []);
  const [questions, setQuestions] = useState([]);
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [topic, setTopic] = useState(() => new URLSearchParams(window.location.search).get('chuDe') || '');
  const [type, setType] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get('/organizer/question-bank', {
      params: { search: searchTerm || undefined },
      signal: controller.signal,
    }).then(({ data }) => {
      if (!controller.signal.aborted) setQuestions(Array.isArray(data) ? data : []);
    }).catch(requestError => {
      if (!controller.signal.aborted) setError(requestError.response?.status === 403 ? 'Bạn không có quyền quản lý ngân hàng câu hỏi.' : message(requestError));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, searchTerm]);

  function choose(ids, checked) {
    try { setSelected(updateQuestionSelection(selected, ids, checked)); setError(''); }
    catch(e) { setError(e.message); }
  }
  async function moveSelected() {
    if(busy || !selected.length || !targetTopic) return;
    setBusy(true); setError(''); setNotice('');
    try { const {data} = await api.post('/organizer/question-bank/set-topic', {questionIds:selected, topicId:Number(targetTopic)}); setSelected([]); setNotice(`Đã chuyển ${data.updatedCount} câu hỏi sang chủ đề đã chọn.`); setRevision(n=>n+1); }
    catch(e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function save(question) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const body = { ...question, points: Number(question.points || 0) };
      if (question.id) await api.put(`/organizer/question-bank/${question.id}`, body);
      else await api.post('/organizer/question-bank', body);
      setEditing(null); setNotice('Đã lưu câu hỏi. Các đề nháp liên kết đã được đồng bộ; bản đã duyệt không thay đổi.');
      setRevision(value => value + 1);
    } catch (requestError) {
      setError(message(requestError));
    } finally { setBusy(false); }
  }

  async function remove(id) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.delete(`/organizer/question-bank/${id}`);
      setDeleteId(null); setNotice('Đã xóa câu hỏi khỏi ngân hàng. Các bản câu hỏi trong đề được giữ lại và không còn liên kết.');
      setRevision(value => value + 1);
    } catch (requestError) {
      setError(message(requestError));
    } finally { setBusy(false); }
  }

  const topics = [...new Set([...catalog.map(t=>t.name), ...questions.map(topicLabel)])].sort((a,b)=>a.localeCompare(b,'vi'));
  const visibleQuestions = questions.filter(q => (!type || q.type === type) && (!topic || topicLabel(q) === topic)).sort((a,b)=>topicLabel(a).localeCompare(topicLabel(b),'vi'));
  return <div className="question-bank-workspace">
    <section className="panel exam-section">
      <div className="exam-section-heading"><div><h2>Ngân hàng câu hỏi <span className="question-bank-heading-count">{visibleQuestions.length} câu</span></h2><p>Soạn câu hỏi trắc nghiệm hoặc đúng/sai, chọn đáp án trực tiếp và xem trước trước khi lưu.</p></div><button className="button button-primary" disabled={!can('draft') || Boolean(editing) || busy} onClick={() => { setEditing({...emptyQuestion(), topic: topic === 'Chưa phân chủ đề' ? '' : topic}); setError(''); setNotice(''); }}><QuestionIcon name="plus" />Thêm câu hỏi</button></div>
      {error && !editing && <div className="notice notice-error" role="alert">{error}</div>}
      {notice && <div className="notice exam-notice-success" role="status">{notice}</div>}
      {editing && <QuestionForm key={editing.id || 'new-bank-question'} question={editing} context="Ngân hàng câu hỏi" error={error} saving={busy} disabled={!can('draft') || busy} onDirty={() => { setError(''); setNotice(''); }} onSave={save} onCancel={() => { setEditing(null); setError(''); }} />}
      <div className="bank-filters bank-filters-refined"><label>Tìm câu hỏi<input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm theo nội dung câu hỏi…" /></label><label>Chủ đề<select value={topic} onChange={e => setTopic(e.target.value)}><option value="">Tất cả chủ đề</option>{topics.map(t => <option key={t} value={t}>{t}</option>)}</select></label><label>Loại câu hỏi<select value={type} onChange={event => setType(event.target.value)}><option value="">Tất cả loại</option>{Object.entries(QUESTION_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <div className="bank-bulk-topics"><label><input type="checkbox" disabled={loading || busy || !visibleQuestions.length} checked={visibleQuestions.length > 0 && visibleQuestions.every(q=>selected.includes(q.id))} onChange={e=>choose(visibleQuestions.map(q=>q.id),e.target.checked)} /> Chọn tất cả kết quả</label><strong>{selected.length} câu đã chọn</strong><label>Chuyển sang chủ đề <select value={targetTopic} disabled={!can('draft') || busy} onChange={e=>setTargetTopic(e.target.value)}><option value="">Chọn chủ đề</option>{catalog.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button type="button" className="button button-secondary" disabled={!can('draft') || busy || !selected.length || !targetTopic} onClick={moveSelected}>Áp dụng chủ đề</button><button type="button" className="text-button" disabled={!can('draft') || busy || !selected.length} onClick={()=>setSelected([])}>Bỏ chọn tất cả</button></div>
      {loading ? <div className="exam-loading" role="status">Đang tải ngân hàng câu hỏi...</div> : visibleQuestions.length === 0 ? <div className="competition-empty"><h3>Chưa có câu hỏi phù hợp</h3><p>Thêm câu hỏi mới hoặc thay đổi điều kiện tìm kiếm.</p></div> : <ol className="question-card-list">{visibleQuestions.map((question, index) => <Fragment key={question.id}>{(index === 0 || topicLabel(visibleQuestions[index-1]) !== topicLabel(question)) && <li className="bank-topic-heading"><h3>{topicLabel(question)} <small>({visibleQuestions.filter(q => topicLabel(q) === topicLabel(question)).length} câu)</small></h3></li>}<QuestionCard question={question} index={index} selectable selected={selected.includes(question.id)} onSelectionChange={checked=>choose([question.id],checked)} linkedCount={question.linkedDraftCount} disabled={!can('draft') || busy || Boolean(editing)} busy={busy} confirming={deleteId === question.id} onEdit={() => { setEditing({ ...question, options: (question.options || []).map(option => ({ ...option })) }); setError(''); setNotice(''); }} onDelete={() => setDeleteId(question.id)} onConfirmDelete={() => remove(question.id)} onCancelDelete={() => setDeleteId(null)} /></Fragment>)}</ol>}
    </section>
  </div>;
}
