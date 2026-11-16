import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useAccess } from './AccessContext.jsx';
import { formatVietnamDateTime } from './dateTime.js';

export const REVIEW_LABELS = { Draft: 'Nháp', PendingReview: 'Chờ duyệt', Returned: 'Nháp (trả lại)', Approved: 'Đã duyệt', Published: 'Công khai' };
const EVENTS = { Submitted: 'Gửi chờ duyệt', Withdrawn: 'Rút về Nháp', Returned: 'Trả lại về Nháp', Approved: 'Duyệt' };

export default function ExamReviewActions({ record, endpoint, onChanged, onComplete, unsaved }) {
  const { user, can } = useAccess();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const status = record.isApproved
    ? ['Published', 'Ended'].includes(record.competitionStatus) ? 'Published' : 'Approved'
    : record.reviewStatus === 'Returned' ? 'Draft' : record.reviewStatus || 'Draft';

  useEffect(() => {
    const controller = new AbortController();
    setHistoryError('');
    api.get(`${endpoint}/review-history`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setHistory(data); })
      .catch(() => { if (!controller.signal.aborted) setHistoryError('Chưa tải được lịch sử duyệt.'); });
    return () => controller.abort();
  }, [endpoint, record.reviewStatus, record.draftRevision, record.isApproved]);

  async function action(path) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api.post(`${endpoint}/${path}`, { draftRevision: record.draftRevision, note });
      setNote(''); setDecision(null); onChanged(); if (path === 'approve' || path === 'return-review' || path === 'withdraw-review') onComplete?.();
    } catch (failure) {
      const details = failure.response?.data?.errors;
      setError((failure.response?.data?.message || 'Chưa xử lý được yêu cầu.')
        + (Array.isArray(details) ? ` ${details.map(item => item.message || item).join(' ')}` : ''));
    } finally { setBusy(false); }
  }

  return <section className="panel exam-section">
    <h3>Quy trình Ban tổ chức</h3>
    <div className="workflow-strip" aria-label="Trạng thái quy trình">
      {['Draft', 'PendingReview', 'Approved', 'Published'].map(step => <span key={step} className={status === step ? 'current' : ''} aria-current={status === step ? 'step' : undefined}>{REVIEW_LABELS[step]}</span>)}
    </div>
    <p>Trạng thái: <strong>{REVIEW_LABELS[status]}</strong>{record.submittedAtUtc && <> · Gửi lúc {formatVietnamDateTime(record.submittedAtUtc)}</>}</p>
    {record.reviewNote && <p className="workflow-note">Ghi chú: {record.reviewNote}</p>}
    {status === 'PendingReview' && <p className="workflow-note">Duyệt để chuyển sang Đã duyệt, hoặc trả lại về Nháp. Cả hai thao tác cần ghi chú và được lưu trong lịch sử.</p>}
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    <div className="exam-actions">
      {can('submit') && status === 'Draft' && <button type="button" className="button button-primary" disabled={busy || unsaved} onClick={() => action('submit-review')}>Gửi chờ duyệt</button>}
      {can('submit') && status === 'PendingReview' && (record.submittedByUserId === user.id || can('manageUsers')) && <button type="button" className="button button-secondary" disabled={busy} onClick={() => action('withdraw-review')}>Rút về Nháp</button>}
      {can('approve') && status === 'PendingReview' && <>
        <button type="button" className="button button-primary" disabled={busy || unsaved} onClick={() => { setDecision('approve'); setNote(''); setError(''); }}>Duyệt</button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setDecision('return-review'); setNote(''); setError(''); }}>Trả lại về Nháp</button>
      </>}
      {can('operate') && status === 'Approved' && <a className="button button-primary" href={`/ban-to-chuc/cuoc-thi/${record.competitionId}/phan-cong`}>Tiếp tục đến Công khai</a>}
    </div>
    {decision && status === 'PendingReview' && <div className="workflow-return">
      <label htmlFor="review-note">{decision === 'approve' ? 'Ghi chú duyệt (bắt buộc)' : 'Ghi chú trả lại (bắt buộc)'}<textarea id="review-note" maxLength={2000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} rows={3} /></label>
      <p>{decision === 'approve' ? 'Duyệt sẽ lưu phiên bản đề cố định.' : 'Trả lại sẽ chuyển đề về Nháp để chỉnh sửa.'}</p>
      <div className="exam-actions"><button type="button" className="button button-primary" disabled={busy || !note.trim()} onClick={() => action(decision)}>{busy ? 'Đang xử lý…' : decision === 'approve' ? 'Xác nhận duyệt' : 'Xác nhận trả lại'}</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => { setDecision(null); setNote(''); }}>Hủy</button></div>
    </div>}
    {status === 'Approved' && <p className="competition-field-help">Chuẩn bị lịch thi, phân công người dùng và kiểm tra điều kiện trước khi công khai.</p>}
    {status === 'Published' && <p className="competition-field-help">Cuộc thi đã công khai cho người dùng được phân công. Nội dung phiên bản đã duyệt được giữ nguyên.</p>}
    {unsaved && <p>Lưu thay đổi trước khi gửi duyệt.</p>}
    <details className="workflow-history"><summary>Lịch sử duyệt ({history.length})</summary>{historyError && <p role="alert">{historyError}</p>}{history.map(event => <article key={event.id}><strong>{EVENTS[event.action] || event.action}</strong> · {event.actorName}<small>{formatVietnamDateTime(event.occurredAtUtc)} · Bản sửa {event.draftRevision}</small>{event.note && <p>{event.note}</p>}</article>)}</details>
  </section>;
}
