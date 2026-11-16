import {useAccess} from './AccessContext.jsx';
import { useEffect, useRef, useState } from 'react';
import { api, isConnectionError } from './api.js';
import './Competitions.css';
import { CompetitionTabs } from './ExamWorkspace.jsx';
import { formatVietnamDateTime } from './dateTime.js';
import TopicQuotaPicker from './TopicQuotaPicker.jsx';
import QuestionLibraryPicker from './QuestionLibraryPicker.jsx';
import { questionSelectionSummary, topicSelectionIds } from './questionLibrary.mjs';

const BASE = '/ban-to-chuc/cuoc-thi';
export const SAMPLE_COMPETITION_NAME = 'Hội thi trực tuyến tìm hiểu kiến thức, nghiệp vụ dành cho cán bộ, công chức xã Tân Hòa';
const STATUS_NAMES = { Draft: 'Nháp', Published: 'Đã công bố', Ended: 'Đã kết thúc' };

function formatDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Chưa cấu hình';
  return formatVietnamDateTime(value);
}

function ContestIcon() {
  return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 13v6m-4 2h8m-7-2h6" /></svg>;
}

function StatusBadge({ status }) {
  return <span className={`competition-status competition-status-${status?.toLowerCase()}`}>{STATUS_NAMES[status] || 'Không xác định'}</span>;
}

function Loading() {
  return <div className="competition-loading" role="status"><span className="loading-spinner" aria-hidden="true" /> Đang tải cuộc thi...</div>;
}

function ErrorNotice({ message, retry }) {
  return <div className="notice notice-error" role="alert"><span>{message}</span>{retry && <button type="button" className="text-button" onClick={retry}>Thử lại</button>}</div>;
}

function CompetitionDetailsDialog({ competition, can, navigate, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement;
    node.showModal();
    return () => {
      if (node.open) node.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const go = path => { onClose(); navigate(path); };
  return <dialog ref={dialog} className="competition-detail-dialog" aria-modal="true" aria-labelledby="competition-detail-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target !== dialog.current) return; const box = dialog.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); }}>
    <header className="competition-detail-header"><div><span className="eyebrow">CHI TIẾT CUỘC THI</span><h2 id="competition-detail-title">{competition.name}</h2></div><button type="button" className="button button-quiet" aria-label="Đóng chi tiết cuộc thi" onClick={onClose}>×</button></header>
    <div className="competition-detail-body"><div className="competition-row-badges"><StatusBadge status={competition.status}/>{competition.isDemo&&<span className="demo-label">Dữ liệu minh họa</span>}</div><p className="competition-plain-text">{competition.description||'Chưa có mô tả.'}</p>{competition.rules&&<section><h3>Thể lệ</h3><p className="competition-plain-text">{competition.rules}</p></section>}<dl className="competition-detail-schedule"><div><dt>Mở thi</dt><dd>{formatDate(competition.opensAtUtc)}</dd></div><div><dt>Hạn bắt đầu</dt><dd>{formatDate(competition.startDeadlineUtc)}</dd></div><div><dt>Đóng thi</dt><dd>{formatDate(competition.closesAtUtc)}</dd></div></dl><small>Cập nhật: {formatDate(competition.updatedAtUtc)} · Múi giờ Việt Nam (UTC+7)</small></div>
    <footer className="competition-detail-actions"><button type="button" className="button button-secondary" onClick={()=>go(`${BASE}/${competition.id}/de-thi`)}>Đề thi</button>{can('operate')&&<><button type="button" className="button button-secondary" onClick={()=>go(`${BASE}/${competition.id}/lich-thi`)}>Lịch thi</button><button type="button" className="button button-secondary" onClick={()=>go(`${BASE}/${competition.id}/phan-cong`)}>Phân công</button></>}{(can('operate')||can('approve'))&&<button type="button" className="button button-secondary" onClick={()=>go(`${BASE}/${competition.id}/xet-giai`)}>Kết quả</button>}{can('draft')&&<button type="button" className="button button-primary" onClick={()=>go(`${BASE}/${competition.id}/chinh-sua`)}>Chỉnh sửa</button>}</footer>
  </dialog>;
}

function List({ navigate }) {
  const {can}=useAccess();
  const [state, setState] = useState({ loading: true, competitions: [], error: '' });
  const [attempt, setAttempt] = useState(0);
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [details, setDetails] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, competitions: [], error: '' });
    api.get('/organizer/competitions', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setState({ loading: false, competitions: Array.isArray(data) ? data : [], error: '' });
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ loading: false, competitions: [], error: error.response?.status === 403 ? 'Bạn không có quyền xem danh sách cuộc thi.' : 'Không thể tải danh sách cuộc thi. Vui lòng thử lại.' });
    });
    return () => controller.abort();
  }, [attempt]);

  async function removeCompetition(id) {
    if (deleting || !can('draft')) return;
    setDeleting(true); setActionError(''); setNotice('');
    try {
      let complete=false,deletedCount=0;
      while(!complete){const {data}=await api.delete(`/organizer/competitions/${id}`);complete=data.complete;deletedCount+=data.deletedCount||0;}
      setDeleteId(null); setNotice(`Đã xóa cuộc thi nháp và ${deletedCount} mục dữ liệu liên quan.`); setAttempt(value => value + 1);
    } catch (error) {
      setActionError(error.response?.data?.message || 'Chưa thể xóa cuộc thi. Vui lòng thử lại.');
    } finally { setDeleting(false); }
  }

  return <section className="panel competition-panel">
    <div className="panel-heading competition-list-heading"><div><h2>Danh sách cuộc thi</h2><p>Chuẩn bị nội dung và thể lệ cho từng cuộc thi.</p></div><button className="button button-primary" disabled={!can('draft')} onClick={() => navigate(`${BASE}/tao`)}><span aria-hidden="true">＋</span> Tạo cuộc thi</button></div>
    {actionError && <ErrorNotice message={actionError} />}{notice && <div className="notice competition-success" role="status">{notice}</div>}
    {state.loading ? <Loading /> : state.error ? <ErrorNotice message={state.error} retry={() => setAttempt((value) => value + 1)} /> : state.competitions.length === 0 ? <div className="competition-empty"><span className="competition-empty-icon"><ContestIcon /></span><h3>Chưa có cuộc thi</h3><p>Tạo cuộc thi đầu tiên để chuẩn bị tên, mô tả và thể lệ. Cuộc thi mới được lưu ở trạng thái Nháp.</p><button className="button button-secondary" onClick={() => navigate(`${BASE}/tao`)}>Tạo cuộc thi đầu tiên</button></div> : <div className="competition-list" data-testid="competition-list">{state.competitions.map((competition) => <article key={competition.id} className="competition-row">
      <div className="competition-row-icon"><ContestIcon /></div><div className="competition-row-body"><div className="competition-row-badges"><StatusBadge status={competition.status} />{competition.isDemo && <span className="demo-label">Dữ liệu minh họa</span>}</div><h3>{competition.name}</h3><p>{competition.description || 'Chưa có mô tả.'}</p><small>Cập nhật: {formatDate(competition.updatedAtUtc)}</small></div><div className="competition-edit-actions"><button type="button" className="button button-primary competition-view-button" onClick={()=>setDetails(competition)}>Xem chi tiết</button>{competition.status === 'Draft' && (deleteId === competition.id ? <div className="exam-actions"><span>Xóa bản nháp này?</span><button className="text-button exam-danger" disabled={!can('draft') || deleting} onClick={() => removeCompetition(competition.id)}>{deleting ? 'Đang xóa...' : 'Xác nhận xóa'}</button><button className="text-button" disabled={!can('draft') || deleting} onClick={() => setDeleteId(null)}>Hủy</button></div> : can('draft')&&<button className="text-button exam-danger" disabled={!can('draft') || deleting} onClick={() => { setDeleteId(competition.id); setActionError(''); }}>Xóa nháp</button>)}</div>
    </article>)}</div>}
    {details&&<CompetitionDetailsDialog competition={details} can={can} navigate={navigate} onClose={()=>setDetails(null)}/>}
    <div className="competition-list-footer"><span>Trạng thái: Nháp · Đã công bố · Đã kết thúc</span><span>Lịch thi theo giờ Việt Nam (UTC+7).</span></div>
  </section>;
}

function Form({ competitionId, navigate, onSaved, isDemoUser }) {
  const {can}=useAccess();
  const editing = Boolean(competitionId);
  const [fields, setFields] = useState({ name: '', description: '', rules: '' });
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState('');
  const [loadStatus, setLoadStatus] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const saveInProgress = useRef(false);
  const [selectionMode, setSelectionMode] = useState('topics');
  const [topicQuotas, setTopicQuotas] = useState([]);
  const [topicsValid, setTopicsValid] = useState(false);
  const [initialQuestions, setInitialQuestions] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [initialExamName, setInitialExamName] = useState('Đề thi chính');
  const [initialDuration, setInitialDuration] = useState(30);
  const summary = questionSelectionSummary(initialQuestions);
  const request = useRef(null);
  const nameInput = useRef(null);

  useEffect(() => {
    if (!editing) return undefined;
    const controller = new AbortController();
    setLoading(true); setLoadError(''); setLoadStatus(0);
    api.get(`/organizer/competitions/${competitionId}`, { signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setRecord(data); setFields({ name: data.name || '', description: data.description || '', rules: data.rules || '' });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setLoadStatus(error.response?.status || 0);
      setLoadError(error.response?.status === 404 ? 'Không tìm thấy cuộc thi này.' : error.response?.status === 403 ? 'Bạn không có quyền chỉnh sửa cuộc thi.' : 'Không thể tải cuộc thi. Vui lòng thử lại.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [competitionId, editing, attempt]);
  useEffect(() => () => request.current?.abort(), []);

  function changeField(field, value) {
    setFields((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: '' }));
    setSaveError('');
    onSaved('');
  }

  async function save(event) {
    event.preventDefault();
    if (saveInProgress.current) return;
    if (!fields.name.trim()) {
      setFieldErrors({ name: 'Vui lòng nhập tên cuộc thi.' });
      nameInput.current?.focus();
      return;
    }
    if (!editing && selectionMode === 'topics' && topicQuotas.length && !topicsValid) { setSaveError('Đề cần từ 1 đến 400 câu. Vui lòng rà soát danh sách câu hỏi theo chủ đề.'); return; }
    if (!editing && (initialQuestions.length || topicQuotas.length) && (!Number.isInteger(Number(initialDuration)) || initialDuration < 1 || initialDuration > 480)) { setSaveError('Thời lượng phải từ 1 đến 480 phút.'); return; }
    saveInProgress.current = true; setSaving(true); setSaveError(''); setFieldErrors({});
    const controller = new AbortController(); request.current = controller;
    try {
      const body = { name: fields.name.trim(), description: fields.description, rules: fields.rules };
      if (!editing && selectionMode === 'topics' && topicQuotas.length) body.initialExam = { name: initialExamName.trim() || 'Đề thi chính', durationMinutes: Number(initialDuration), questionIds: topicSelectionIds(topicQuotas) };
      if (!editing && selectionMode === 'manual' && initialQuestions.length) body.initialExam = { name: initialExamName.trim() || 'Đề thi chính', durationMinutes: Number(initialDuration), questionIds: initialQuestions.map(q => q.id) };
      const { data } = editing
        ? await api.put(`/organizer/competitions/${competitionId}`, body, { signal: controller.signal })
        : await api.post('/organizer/competitions', body, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setRecord(data); setFields({ name: data.name || '', description: data.description || '', rules: data.rules || '' });
      onSaved(editing ? 'Đã lưu thay đổi.' : 'Đã tạo cuộc thi ở trạng thái Nháp.');
      if (!editing) navigate(`${BASE}/${data.id}/lich-thi`, true);
    } catch (error) {
      if (controller.signal.aborted) return;
      const errors = error.response?.data?.errors;
      if (errors && typeof errors === 'object') {
        const converted = {};
        for (const field of ['name', 'description', 'rules']) {
          const messages = errors[field] || errors[field[0].toUpperCase() + field.slice(1)];
          if (messages) converted[field] = Array.isArray(messages) ? messages.join(' ') : String(messages);
        }
        setFieldErrors(converted);
        if (converted.name) nameInput.current?.focus();
      }
      setSaveError(isConnectionError(error) ? 'Không thể kết nối máy chủ. Nội dung bạn nhập vẫn được giữ lại; vui lòng thử lưu lại.' : error.response?.status === 403 ? 'Bạn không có quyền lưu cuộc thi.' : error.response?.data?.message || 'Chưa lưu được cuộc thi. Vui lòng kiểm tra nội dung và thử lại.');
    } finally {
      if (request.current === controller) { request.current = null; saveInProgress.current = false; setSaving(false); }
    }
  }

  if (loading) return <section className="panel"><Loading /></section>;
  if (loadError) return <section className="panel competition-form-panel"><ErrorNotice message={loadError} retry={loadStatus === 404 || loadStatus === 403 ? undefined : () => setAttempt((value) => value + 1)} /><button className="button button-secondary" onClick={() => navigate(BASE)}>Về danh sách cuộc thi</button></section>;

  return <div className="competition-form-layout"><section className="panel competition-form-panel"><div className="competition-form-heading"><div><h2>{editing ? 'Thông tin cuộc thi' : 'Chuẩn bị cuộc thi mới'}</h2><p>{editing ? 'Chỉnh sửa nội dung và lưu để cập nhật cuộc thi.' : 'Nhập thông tin cơ bản. Cuộc thi chỉ được tạo khi bạn lưu biểu mẫu.'}</p></div><StatusBadge status={record?.status || 'Draft'} /></div>
    {(record?.isDemo || (!editing && isDemoUser)) && <div className="competition-demo-note"><strong>Dữ liệu minh họa.</strong> Cuộc thi này được tạo bằng tài khoản minh họa.</div>}
    <fieldset className="permission-readonly" disabled={!can('draft')}><form className="competition-form" onSubmit={save} noValidate aria-busy={saving}>
      {saveError && <ErrorNotice message={saveError} />}
      <div className="field"><div className="competition-label-row"><label htmlFor="competition-name">Tên cuộc thi <span aria-hidden="true" className="required-mark">*</span></label>{!editing && <button type="button" className="text-button" disabled={saving} onClick={() => { changeField('name', SAMPLE_COMPETITION_NAME); nameInput.current?.focus(); }}>Dùng tên mẫu</button>}</div><input ref={nameInput} id="competition-name" name="name" type="text" required maxLength={300} value={fields.name} disabled={saving} onChange={(event) => changeField('name', event.target.value)} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'competition-name-error' : 'competition-name-help'} placeholder="Nhập tên cuộc thi" />{fieldErrors.name ? <p className="competition-field-error" id="competition-name-error" role="alert">{fieldErrors.name}</p> : <p className="competition-field-help" id="competition-name-help">Bắt buộc. Tối đa 300 ký tự.</p>}</div>
      <div className="field"><label htmlFor="competition-description">Mô tả</label><textarea id="competition-description" name="description" rows={4} maxLength={5000} value={fields.description} disabled={saving} onChange={(event) => changeField('description', event.target.value)} aria-invalid={Boolean(fieldErrors.description)} aria-describedby={fieldErrors.description ? 'competition-description-error' : undefined} placeholder="Giới thiệu mục đích, nội dung và đối tượng của cuộc thi" />{fieldErrors.description && <p className="competition-field-error" id="competition-description-error" role="alert">{fieldErrors.description}</p>}</div>
      <div className="field"><label htmlFor="competition-rules">Thể lệ</label><textarea id="competition-rules" name="rules" rows={8} maxLength={20000} value={fields.rules} disabled={saving} onChange={(event) => changeField('rules', event.target.value)} aria-invalid={Boolean(fieldErrors.rules)} aria-describedby={fieldErrors.rules ? 'competition-rules-error' : undefined} placeholder="Nhập thể lệ, yêu cầu và các lưu ý cho thí sinh" />{fieldErrors.rules && <p className="competition-field-error" id="competition-rules-error" role="alert">{fieldErrors.rules}</p>}</div>
      {!editing && <section className="competition-question-setup"><div className="cqs-heading"><div><h3>Câu hỏi cho cuộc thi</h3><p>Chọn chủ đề để lấy toàn bộ câu hỏi, sau đó bỏ chọn những câu không dùng.</p></div><button type="button" className="button button-secondary" disabled={saving} onClick={() => { setSelectionMode('manual'); setShowPicker(true); }}>Chọn nhiều câu hỏi</button></div><div className="exam-actions"><button type="button" className="button button-secondary" aria-pressed={selectionMode === 'topics'} disabled={saving} onClick={() => setSelectionMode('topics')}>Theo chủ đề</button><button type="button" className="button button-secondary" aria-pressed={selectionMode === 'manual'} disabled={saving} onClick={() => setSelectionMode('manual')}>Tự chọn câu hỏi</button></div>{selectionMode === 'topics' && <><TopicQuotaPicker value={topicQuotas} onChange={setTopicQuotas} disabled={saving} onValidity={setTopicsValid} /><div className="cqs-exam-fields"><label>Tên đề thi<input value={initialExamName} maxLength={300} disabled={saving} onChange={e => setInitialExamName(e.target.value)} /></label><label>Thời lượng (phút)<input type="number" min="1" max="480" value={initialDuration} disabled={saving} onChange={e => setInitialDuration(e.target.value)} /></label></div></>}{selectionMode === 'manual' && (initialQuestions.length ? <><div className="cqs-summary"><strong>{summary.count} câu đã chọn</strong><span>{summary.totalPoints} điểm</span></div><div className="cqs-exam-fields"><label>Tên đề thi<input value={initialExamName} maxLength={300} disabled={saving} onChange={e => setInitialExamName(e.target.value)} /></label><label>Thời lượng (phút)<input type="number" min="1" max="480" value={initialDuration} disabled={saving} onChange={e => setInitialDuration(e.target.value)} /></label></div><ol className="cqs-selected">{initialQuestions.map((q, i) => <li key={q.id}><span>{i + 1}. {q.content}</span><button type="button" className="text-button" disabled={saving} aria-label={`Bỏ câu ${i + 1}`} onClick={() => setInitialQuestions(rows => rows.filter(row => row.id !== q.id))}>Bỏ</button></li>)}</ol></> : <p className="cqs-empty">Chưa chọn câu hỏi. Bạn có thể chọn ngay hoặc bổ sung sau trong mục Đề thi.</p>)}</section>}
      {showPicker && <QuestionLibraryPicker initialSelectedIds={initialQuestions.map(q => q.id)} onConfirm={rows => { setInitialQuestions(rows); setShowPicker(false); }} onCancel={() => setShowPicker(false)} />}
      <div className="competition-form-actions"><button type="submit" className="button button-primary" disabled={saving}>{saving ? <><span className="loading-spinner" aria-hidden="true" /> Đang lưu...</> : editing ? 'Lưu thay đổi' : 'Lưu cuộc thi'}</button><button type="button" className="button button-secondary" disabled={saving} onClick={() => navigate(BASE)}>Về danh sách</button></div>
    </form></fieldset></section><aside className="competition-help-panel"><span className="eyebrow">TRẠNG THÁI CUỘC THI</span><h3>Chuẩn bị từ bản nháp</h3><p>Cuộc thi mới ở trạng thái <strong>Nháp</strong> và chưa hiển thị cho thí sinh.</p><ol><li><strong>Nháp</strong><span>Soạn tên, mô tả và thể lệ.</span></li><li><strong>Đã công bố</strong><span>Chỉ thí sinh được phân tham gia mới nhìn thấy.</span></li><li><strong>Đã kết thúc</strong><span>Cuộc thi đã hoàn tất.</span></li></ol><div className="competition-schedule-note"><strong>Lịch thi theo giờ Việt Nam</strong><p>Lịch mở và đóng thi sẽ quyết định thời điểm được bắt đầu làm bài. Cấu hình các mốc tại mục Lịch thi; thời lượng làm bài đặt ở mỗi đề.</p><code>Asia/Ho_Chi_Minh</code></div></aside></div>;
}

export function CompetitionsPage({ path, navigate, user }) {
  const [notice, setNotice] = useState('');
  const match = path.match(/^\/ban-to-chuc\/cuoc-thi\/(\d+)\/chinh-sua$/);
  const creating = path === `${BASE}/tao`;
  return <>{match && <CompetitionTabs competitionId={match[1]} {...{ path, navigate }} />}{notice && <div className="notice competition-success" role="status">{notice}</div>}{creating || match ? <Form key={creating ? 'new' : match[1]} competitionId={match?.[1]} navigate={navigate} onSaved={setNotice} isDemoUser={user.isDemo} /> : <List navigate={navigate} />}</>;
}

export function CandidateCompetitions() {
  const [state, setState] = useState({ loading: true, competitions: [], error: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, competitions: [], error: '' });
    api.get('/candidate/competitions', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setState({ loading: false, competitions: Array.isArray(data) ? data : [], error: '' });
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ loading: false, competitions: [], error: error.response?.status === 403 ? 'Bạn không có quyền xem các cuộc thi này.' : 'Không thể tải cuộc thi. Vui lòng thử lại.' });
    });
    return () => controller.abort();
  }, [attempt]);
  return <section className="panel candidate-competitions"><div className="panel-heading"><div><h2>Cuộc thi dành cho bạn</h2><p>Các cuộc thi đã công bố và được phân cho tài khoản của bạn.</p></div></div>{state.loading ? <Loading /> : state.error ? <ErrorNotice message={state.error} retry={() => setAttempt((value) => value + 1)} /> : state.competitions.length === 0 ? <div className="competition-empty"><span className="competition-empty-icon"><ContestIcon /></span><h3>Chưa có cuộc thi được phân tham gia</h3><p>Khi Ban Tổ chức công bố và phân bạn tham gia, thông tin cuộc thi sẽ xuất hiện tại đây.</p></div> : <div className="candidate-competition-list">{state.competitions.map((competition) => <article className="candidate-competition" key={competition.id}><div className="competition-row-badges"><StatusBadge status={competition.status} />{competition.isDemo && <span className="demo-label">Dữ liệu minh họa</span>}</div><h3>{competition.name}</h3>{competition.description && <p className="competition-plain-text">{competition.description}</p>}<dl className="competition-schedule"><div><dt>Mở thi</dt><dd>{formatDate(competition.opensAtUtc)}</dd></div><div><dt>Hạn bắt đầu</dt><dd>{formatDate(competition.startDeadlineUtc)}</dd></div><div><dt>Đóng thi</dt><dd>{formatDate(competition.closesAtUtc)}</dd></div></dl><p className="competition-entry-note">{competition.canStart ? 'Đã đến thời gian dự thi.' : competition.startBlockedReason || competition.message || 'Vui lòng theo dõi lịch mở và đóng thi.'}</p>{competition.rules && <details><summary>Thể lệ cuộc thi</summary><div className="competition-plain-text">{competition.rules}</div></details>}<a className="button button-primary" href={`/thi-sinh/cuoc-thi/${competition.id}/huong-dan`}>Vào thi</a></article>)}</div>}</section>;
}
