import { useEffect, useState } from 'react';
import { api } from './api.js';
import { emptyQuestion, QuestionForm } from './ExamWorkspace.jsx';
import './QuestionBankWorkspace.css';

function message(error) {
  const data = error.response?.data;
  const errors = data?.errors;
  const details = errors && typeof errors === 'object' ? Object.values(errors).flat().filter(value => typeof value === 'string') : [];
  return details.length ? details.join(' ') : data?.message || 'Chưa thực hiện được thao tác. Vui lòng thử lại.';
}

export default function QuestionBankWorkspace() {
  const [questions, setQuestions] = useState([]);
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api.get('/organizer/question-bank', {
      params: { search: search.trim() || undefined },
      signal: controller.signal,
    }).then(({ data }) => {
      if (!controller.signal.aborted) setQuestions(Array.isArray(data) ? data : []);
    }).catch(requestError => {
      if (!controller.signal.aborted) setError(requestError.response?.status === 403 ? 'Bạn không có quyền quản lý ngân hàng câu hỏi.' : message(requestError));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, search]);

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

  return <div className="question-bank-workspace">
    <section className="panel exam-section">
      <div className="exam-section-heading"><div><h2>Ngân hàng câu hỏi</h2><p>Nhập nội dung câu hỏi, 4 đáp án A–D và chọn một đáp án đúng. Câu hỏi liên kết được đồng bộ vào bản nháp.</p></div><button className="button button-primary" disabled={Boolean(editing) || busy} onClick={() => { setEditing(emptyQuestion()); setError(''); setNotice(''); }}>Thêm câu hỏi</button></div>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {notice && <div className="notice exam-notice-success" role="status">{notice}</div>}
      {editing && <QuestionForm key={editing.id || 'new-bank-question'} question={editing} saving={busy} disabled={busy} onDirty={() => { setError(''); setNotice(''); }} onSave={save} onCancel={() => { setEditing(null); setError(''); }} />}
      <div className="bank-filters"><label>Tìm nội dung<input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder="Nhập từ khóa câu hỏi" /></label></div>
      {loading ? <div className="exam-loading" role="status">Đang tải ngân hàng câu hỏi...</div> : questions.length === 0 ? <div className="competition-empty"><h3>Chưa có câu hỏi phù hợp</h3><p>Thêm câu hỏi mới hoặc thay đổi điều kiện tìm kiếm.</p></div> : <ol className="exam-question-list">{questions.map(question => <li key={question.id}>
        <div className="question-item-heading"><strong>Câu hỏi trắc nghiệm</strong><span>{question.linkedDraftCount} bản nháp đang liên kết</span></div>
        <p className="exam-plain">{question.content || 'Chưa nhập nội dung câu hỏi'}</p>
        <ol className="bank-question-options">{(question.options || []).map(option => <li key={option.key}><strong>{option.key}.</strong> {option.text}{option.key === question.correctAnswer && <span> · Đáp án đúng</span>}</li>)}</ol>
        <div className="exam-actions"><button className="text-button" disabled={busy || Boolean(editing)} onClick={() => { setEditing({ ...question, options: (question.options || []).map(option => ({ ...option })) }); setError(''); setNotice(''); }}>Sửa câu hỏi</button>{deleteId === question.id ? <><span>Xóa khỏi ngân hàng?</span><button className="text-button exam-danger" disabled={busy} onClick={() => remove(question.id)}>Xác nhận xóa</button><button className="text-button" disabled={busy} onClick={() => setDeleteId(null)}>Hủy</button></> : <button className="text-button exam-danger" disabled={busy || Boolean(editing)} onClick={() => setDeleteId(question.id)}>Xóa</button>}</div>
      </li>)}</ol>}
    </section>
  </div>;
}
