import { useEffect, useRef, useState } from 'react';
import { api, isConnectionError } from './api.js';
import './ExamWorkspace.css';
import AssignmentWorkspace, { AwardReviewWorkspace } from './AssignmentWorkspace.jsx';
import { formatVietnamDateTime, parseVietnamDateTimeInput } from './dateTime.js';

const ROOT = '/ban-to-chuc/cuoc-thi';
const GROUP_NAMES = { Common: 'Kiến thức chung', Specialized: 'Chuyên môn' };
const TYPE_NAMES = { SingleChoice: 'Một đáp án đúng', TrueFalse: 'Đúng / Sai' };
const DEFAULT_CONFIG = { name: '', fieldGroupId: '', durationMinutes: 30, targetQuestionCount: 30, commonQuestionCount: 10, specializedQuestionCount: 20 };
export const emptyQuestion = () => ({ type: 'SingleChoice', group: 'Common', content: '', options: ['A', 'B', 'C', 'D'].map(key => ({ key, text: '' })), correctAnswer: '', points: 1, isScenario: false, explanation: '', source: '', requiresSourceReview: false, sourceReviewed: false });
const list = value => Array.isArray(value) ? value : [];
const messageText = value => typeof value === 'string' ? value : value?.message || value?.description || '';

function errorText(error, fallback = 'Chưa thực hiện được thao tác. Vui lòng thử lại.') {
  if (isConnectionError(error)) return 'Không thể kết nối máy chủ. Nội dung đang nhập vẫn được giữ lại.';
  if (error.response?.status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
  if (error.response?.status === 404) return 'Không tìm thấy cuộc thi hoặc đề thi trong đường dẫn này.';
  const data = error.response?.data;
  const errors = data?.validation?.errors || data?.errors;
  const details = Array.isArray(errors) ? errors.map(messageText).filter(Boolean) : errors && typeof errors === 'object' ? Object.values(errors).flat().map(messageText).filter(Boolean) : [];
  return details.length ? details.join(' ') : data?.message || fallback;
}

function useResource(url, revision = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    setState(current => ({ ...current, loading: true, error: '' }));
    api.get(url, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: '' });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ data: null, loading: false, error: errorText(error) });
    });
    return () => controller.abort();
  }, [url, revision]);
  return state;
}

function Loading() { return <div className="exam-loading" role="status"><span className="loading-spinner" aria-hidden="true" />Đang tải dữ liệu...</div>; }
function Notice({ children, kind = 'error' }) { return children ? <div className={`notice exam-notice exam-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div> : null; }
function DateText({ value }) {
  if (!value) return <>Chưa cấu hình</>;
  return <>{formatVietnamDateTime(value)}</>;
}

export function isExamWorkspacePath(path) { return /^\/ban-to-chuc\/cuoc-thi\/\d+\/(de-thi(?:\/\d+)?|lich-thi|phan-cong|xet-giai)$/.test(path); }

export function CompetitionTabs({ competitionId, path, navigate }) {
  const base = `${ROOT}/${competitionId}`;
  const tabs = [{ label: 'Thông tin', url: `${base}/chinh-sua` }, { label: 'Đề thi', url: `${base}/de-thi` }, { label: 'Lịch thi', url: `${base}/lich-thi` }, { label: 'Phân công dự thi', url: `${base}/phan-cong` }, { label: 'Xét giải', url: `${base}/xet-giai` }];
  return <nav className="competition-tabs" aria-label="Các mục trong cuộc thi">{tabs.map(tab => <a key={tab.url} href={tab.url} className={path === tab.url || (tab.label === 'Đề thi' && path.startsWith(`${tab.url}/`)) ? 'selected' : ''} aria-current={path === tab.url ? 'page' : undefined} onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(tab.url); }}>{tab.label}</a>)}</nav>;
}

export default function ExamWorkspace({ path, navigate }) {
  const match = path.match(/^\/ban-to-chuc\/cuoc-thi\/(\d+)\/(de-thi|lich-thi|phan-cong|xet-giai)(?:\/(\d+))?$/);
  const competitionId = match?.[1];
  const base = `/organizer/competitions/${competitionId}`;
  const competition = useResource(base);
  if (competition.loading) return <Loading />;
  if (competition.error) return <Notice>{competition.error}</Notice>;
  return <div className="exam-workspace"><div className="exam-parent"><span>CUỘC THI</span><strong>{competition.data?.name}</strong>{competition.data?.isDemo && <span className="demo-label">Dữ liệu minh họa</span>}</div><CompetitionTabs {...{ competitionId, path, navigate }} />{match[2] === 'phan-cong' ? <AssignmentWorkspace key={`assignment-${competitionId}`} competitionId={competitionId} /> : match[2] === 'xet-giai' ? <AwardReviewWorkspace key={`awards-${competitionId}`} competitionId={competitionId} /> : match[2] === 'lich-thi' ? <Schedule key={`schedule-${competitionId}`} base={base} /> : match[3] ? <ExamEditor key={`${competitionId}-${match[3]}`} base={base} competitionId={competitionId} examId={match[3]} navigate={navigate} /> : <ExamList key={`list-${competitionId}`} {...{ base, competitionId, navigate }} />}</div>;
}

function ConfigFields({ fields, setFields, groups, disabled }) {
  const change = (key, value) => setFields(current => ({ ...current, [key]: value }));
  return <div className="exam-config-fields"><div className="field exam-wide"><label htmlFor="exam-name">Tên đề thi <span className="required-mark">*</span></label><input id="exam-name" maxLength={300} required value={fields.name} onChange={e => change('name', e.target.value)} disabled={disabled} placeholder="Ví dụ: Đề thi lĩnh vực kinh tế và hạ tầng" /></div><div className="field exam-wide"><label htmlFor="exam-field-group">Nhóm lĩnh vực <span className="required-mark">*</span></label><select id="exam-field-group" required value={fields.fieldGroupId} onChange={e => change('fieldGroupId', e.target.value)} disabled={disabled}><option value="">Chọn nhóm lĩnh vực</option>{list(groups).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div><div className="field"><label htmlFor="exam-duration">Thời lượng làm bài (phút)</label><input id="exam-duration" type="number" min="1" max="480" required value={fields.durationMinutes} onChange={e => change('durationMinutes', e.target.value)} disabled={disabled} /></div><div className="field"><label htmlFor="exam-target-count">Tổng số câu</label><input id="exam-target-count" type="number" min="1" max="500" required value={fields.targetQuestionCount} onChange={e => change('targetQuestionCount', e.target.value)} disabled={disabled} /></div><div className="field"><label htmlFor="exam-common-count">Số câu Kiến thức chung</label><input id="exam-common-count" type="number" min="0" max="500" required value={fields.commonQuestionCount} onChange={e => change('commonQuestionCount', e.target.value)} disabled={disabled} /></div><div className="field"><label htmlFor="exam-specialized-count">Số câu Chuyên môn</label><input id="exam-specialized-count" type="number" min="0" max="500" required value={fields.specializedQuestionCount} onChange={e => change('specializedQuestionCount', e.target.value)} disabled={disabled} /></div></div>;
}

function configBody(fields) {
  return { name: fields.name.trim(), fieldGroupId: Number(fields.fieldGroupId), durationMinutes: Number(fields.durationMinutes), targetQuestionCount: Number(fields.targetQuestionCount), commonQuestionCount: Number(fields.commonQuestionCount), specializedQuestionCount: Number(fields.specializedQuestionCount) };
}
function configError(fields) {
  const value = configBody(fields);
  if (!value.name) return 'Vui lòng nhập tên đề thi.';
  if (!value.fieldGroupId) return 'Vui lòng chọn nhóm lĩnh vực.';
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 1 || value.durationMinutes > 480) return 'Thời lượng làm bài phải từ 1 đến 480 phút.';
  if (!Number.isInteger(value.targetQuestionCount) || value.targetQuestionCount < 1 || value.targetQuestionCount > 500) return 'Tổng số câu phải từ 1 đến 500.';
  if (![value.commonQuestionCount, value.specializedQuestionCount].every(count => Number.isInteger(count) && count >= 0) || value.commonQuestionCount + value.specializedQuestionCount !== value.targetQuestionCount) return 'Số câu Kiến thức chung cộng số câu Chuyên môn phải bằng tổng số câu.';
  return '';
}

function ExamList({ base, competitionId, navigate }) {
  const [revision, setRevision] = useState(0);
  const exams = useResource(`${base}/exams`, revision);
  const groups = useResource(`${base}/field-groups`, revision);
  const [creating, setCreating] = useState(false);
  const [fields, setFields] = useState({ ...DEFAULT_CONFIG });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inProgress = useRef(false);
  useEffect(() => { if (list(groups.data).length) setFields(current => current.fieldGroupId ? current : { ...current, fieldGroupId: groups.data[0].id }); }, [groups.data]);
  async function create(event) {
    event.preventDefault(); if (inProgress.current) return;
    const issue = configError(fields); if (issue) { setError(issue); return; }
    inProgress.current = true; setBusy(true); setError('');
    try { const { data } = await api.post(`${base}/exams`, configBody(fields)); navigate(`${ROOT}/${competitionId}/de-thi/${data.id}`); }
    catch (e) { setError(errorText(e)); } finally { inProgress.current = false; setBusy(false); }
  }
  return <><section className="panel exam-section"><div className="exam-section-heading"><div><h2>Đề thi theo lĩnh vực</h2><p>Tạo nhiều đề trong cùng cuộc thi, với thời lượng và cơ cấu câu hỏi riêng.</p></div><button className="button button-primary" onClick={() => { setCreating(true); setError(''); }}>Tạo đề thi</button></div>{creating && <form className="exam-form exam-create-form" onSubmit={create}><h3>Tạo đề thi</h3><Notice kind="info">Cấu hình minh họa: 30 câu, 30 phút, gồm 10 câu chung và 20 câu chuyên môn. Bạn có thể thay đổi; hệ thống không tạo sẵn câu hỏi.</Notice><Notice>{error}</Notice><ConfigFields {...{ fields, setFields }} groups={groups.data} disabled={busy} /><div className="exam-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu đề thi'}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => setCreating(false)}>Hủy</button></div></form>}{exams.loading ? <Loading /> : exams.error || groups.error ? <Notice>{exams.error || groups.error}</Notice> : !list(exams.data).length ? <div className="competition-empty"><h3>Chưa có đề thi</h3><p>Bắt đầu bằng một đề thi theo nhóm lĩnh vực được phân công.</p></div> : <div className="exam-list">{list(exams.data).map(exam => <article key={exam.id} className="exam-list-row"><div><div className="exam-badges"><span className={`exam-status ${exam.isApproved ? 'approved' : ''}`}>{exam.isApproved ? 'Đã duyệt' : 'Bản nháp'}</span>{exam.isDemo && <span className="demo-label">Minh họa</span>}</div><h3>{exam.name}</h3><p>{exam.fieldGroupName || list(groups.data).find(group => group.id === exam.fieldGroupId)?.name} · {exam.targetQuestionCount} câu · {exam.durationMinutes} phút</p><small>{exam.commonQuestionCount} câu chung · {exam.specializedQuestionCount} câu chuyên môn</small></div><button className="button button-secondary" onClick={() => navigate(`${ROOT}/${competitionId}/de-thi/${exam.id}`)}>Mở đề thi</button></article>)}</div>}</section><FieldGroups base={base} groups={list(groups.data)} onChanged={() => setRevision(value => value + 1)} /></>;
}

function FieldGroups({ base, groups, onChanged }) {
  const [names, setNames] = useState({}); const [rankingNames, setRankingNames] = useState({}); const [newName, setNewName] = useState(''); const [busy, setBusy] = useState(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  async function save(group) {
    if (busy) return; const name = (names[group.id] ?? group.name).trim(); if (!name) { setError('Tên nhóm lĩnh vực không được bỏ trống.'); return; }
    setBusy(group.id); setError(''); setNotice('');
    const rankingGroupName = (rankingNames[group.id] ?? group.rankingGroupName ?? group.name).trim();
    try { await api.put(`${base}/field-groups/${group.id}`, { name, rankingGroupName }); setNotice('Đã cập nhật tên nhóm và nhóm xếp hạng.'); onChanged(); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  }
  async function create(event) {
    event.preventDefault(); if (busy || !newName.trim()) return; setBusy('new'); setError(''); setNotice('');
    try { await api.post(`${base}/field-groups`, { name: newName.trim() }); setNewName(''); setNotice('Đã thêm nhóm lĩnh vực.'); onChanged(); } catch(e) { setError(errorText(e)); } finally { setBusy(null); }
  }
  return <details className="panel exam-section exam-group-settings"><summary>Nhóm lĩnh vực và xếp hạng</summary><div className="exam-group-content"><p>Các nhóm xếp hạng có cùng tên sẽ được xếp chung; đổi tên nhóm xếp hạng để xác định nhóm đề tương đương. Nhóm mặc định theo tên lĩnh vực.</p><Notice>{error}</Notice><Notice kind="success">{notice}</Notice>{groups.map(group => <div className="exam-group-row" key={group.id}><label className="visually-hidden" htmlFor={`field-group-${group.id}`}>Tên nhóm lĩnh vực {group.name}</label><input id={`field-group-${group.id}`} aria-label={`Tên nhóm lĩnh vực ${group.name}`} value={names[group.id] ?? group.name} maxLength={200} onChange={e => setNames(current => ({ ...current, [group.id]: e.target.value }))} disabled={Boolean(busy)} /><label className="visually-hidden" htmlFor={`ranking-group-${group.id}`}>Nhóm xếp hạng tương đương cho {group.name}</label><input id={`ranking-group-${group.id}`} aria-label={`Nhóm xếp hạng tương đương cho ${group.name}`} value={rankingNames[group.id] ?? group.rankingGroupName ?? group.name} maxLength={200} onChange={e => setRankingNames(current => ({ ...current, [group.id]: e.target.value }))} placeholder="Nhóm xếp hạng tương đương" disabled={Boolean(busy)} /><button className="button button-secondary" onClick={() => save(group)} disabled={Boolean(busy)}>Lưu</button></div>)}<form className="exam-group-row" onSubmit={create}><label className="visually-hidden" htmlFor="new-field-group">Tên nhóm mới</label><input id="new-field-group" required maxLength={200} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Thêm nhóm lĩnh vực khác" disabled={Boolean(busy)} /><button className="button button-secondary" type="submit" disabled={Boolean(busy)}>Thêm nhóm</button></form></div></details>;
}

function ExamEditor({ base, competitionId, examId, navigate }) {
  const endpoint = `${base}/exams/${examId}`;
  const [revision, setRevision] = useState(0);
  const exam = useResource(endpoint, revision);
  const questions = useResource(`${endpoint}/questions`, revision);
  const groups = useResource(`${base}/field-groups`, revision);
  const versions = useResource(`${endpoint}/versions`, revision);
  const [fields, setFields] = useState({ ...DEFAULT_CONFIG });
  const [configDirty, setConfigDirty] = useState(false);
  const [question, setQuestion] = useState(null);
  const [questionDirty, setQuestionDirty] = useState(false);
  const [preview, setPreview] = useState(null);
  const [versionPreview, setVersionPreview] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showBankImport, setShowBankImport] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef(false);
  useEffect(() => { if (exam.data && !configDirty) setFields({ ...DEFAULT_CONFIG, ...exam.data }); }, [exam.data, configDirty]);
  function changedConfig(update) { setConfigDirty(true); setNotice(''); setError(''); setPreview(null); setFields(update); }
  function reload() { setRevision(value => value + 1); }
  async function run(name, action) {
    if (operation.current) return;
    operation.current = true; setBusy(name); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(errorText(e)); } finally { operation.current = false; setBusy(''); }
  }
  async function saveConfig(event) {
    event.preventDefault(); const issue = configError(fields); if (issue) { setError(issue); return; }
    await run('config', async () => { const { data } = await api.put(endpoint, configBody(fields)); setFields(data); setConfigDirty(false); setNotice('Đã lưu cấu hình đề thi.'); setPreview(null); reload(); });
  }
  async function saveQuestion(value) {
    await run('question', async () => {
      if (value.id) await api.put(`${endpoint}/questions/${value.id}`, value);
      else await api.post(`${endpoint}/questions`, value);
      setQuestion(null); setQuestionDirty(false); setPreview(null); setNotice('Đã lưu câu hỏi vào bản nháp.'); reload();
    });
  }
  async function removeQuestion(id) {
    await run('delete', async () => { await api.delete(`${endpoint}/questions/${id}`); setDeleteId(null); setPreview(null); setNotice('Đã xóa câu hỏi khỏi bản nháp.'); reload(); });
  }
  async function showPreview() {
    await run('preview', async () => { const { data } = await api.get(`${endpoint}/preview`); setPreview(data); setVersionPreview(null); });
  }
  async function approve() {
    if (operation.current) return;
    operation.current = true; setBusy('approve'); setError(''); setNotice('');
    try {
      const { data } = await api.post(`${endpoint}/approve`);
      setNotice(`Đã duyệt đề thi — phiên bản ${data.versionNumber}. Nội dung phiên bản này được giữ cố định.`);
      setVersionPreview(data); setPreview(null); reload();
    } catch (e) {
      setError(errorText(e, 'Chưa thể duyệt đề. Vui lòng sửa các lỗi trong bản xem trước.'));
      if (e.response?.status === 400) {
        try { const { data } = await api.get(`${endpoint}/preview`); setPreview(data); setVersionPreview(null); } catch { /* Keep the approval error visible. */ }
      }
    } finally { operation.current = false; setBusy(''); }
  }
  async function loadVersion(id) {
    await run('version', async () => { const { data } = await api.get(`${endpoint}/versions/${id}`); setVersionPreview(data); setPreview(null); });
  }
  if (exam.loading && !exam.data) return <Loading />;
  if (exam.error) return <Notice>{exam.error}</Notice>;
  const record = exam.data || {};
  const unsaved = configDirty || questionDirty;
  return <>
    <div className="exam-editor-top"><div><button className="text-button" onClick={() => navigate(`${ROOT}/${competitionId}/de-thi`)}>← Danh sách đề thi</button><h2>{record.name}</h2><div className="exam-badges"><span className={`exam-status ${record.isApproved ? 'approved' : ''}`}>{record.isApproved ? 'Đã duyệt bản hiện tại' : 'Bản nháp'}</span><span>Chỉnh sửa lần {record.draftRevision || 1}</span>{record.isDemo && <span className="demo-label">Minh họa</span>}</div></div><div className="exam-actions"><button className="button button-secondary" disabled={Boolean(busy) || unsaved} onClick={showPreview}>Xem trước đề</button><button className="button button-primary" disabled={Boolean(busy) || unsaved} onClick={approve}>{busy === 'approve' ? 'Đang duyệt...' : 'Duyệt đề'}</button></div></div>
    <Notice>{error}</Notice><Notice kind="success">{notice}</Notice>{unsaved && <Notice kind="info">Có nội dung chưa lưu. Vui lòng lưu cấu hình hoặc câu hỏi trước khi xem trước và duyệt đề.</Notice>}
    {record.currentApprovedVersionId && !record.isApproved && <Notice kind="info">Bản nháp đã thay đổi sau lần duyệt trước. Phiên bản đã duyệt vẫn được giữ nguyên để các bài thi đã phát tiếp tục tham chiếu đúng nội dung.</Notice>}
    <section className="panel exam-section"><details className="exam-config-details" open><summary>Cấu hình đề thi</summary><form className="exam-form" onSubmit={saveConfig}><p className="exam-hint">Gợi ý minh họa: 30 câu, 30 phút, gồm 10 câu chung và 20 câu chuyên môn; điều chỉnh theo phân công thực tế.</p><ConfigFields fields={fields} setFields={changedConfig} groups={groups.data} disabled={Boolean(busy)} /><button type="submit" className="button button-secondary" disabled={Boolean(busy)}>{busy === 'config' ? 'Đang lưu...' : 'Lưu cấu hình'}</button></form></details></section>
    <section className="panel exam-section"><div className="exam-section-heading"><div><h2>Câu hỏi của đề</h2><p>{list(questions.data).length} / {record.targetQuestionCount} câu · đáp án và điểm được kiểm tra khi duyệt.</p></div><div className="exam-actions"><button className="button button-secondary" disabled={Boolean(busy) || unsaved} onClick={() => { setShowImport(value => !value); setShowBankImport(false); }}>Nhập từ Excel</button><button className="button button-secondary" disabled={Boolean(busy) || unsaved} onClick={() => { setShowBankImport(value => !value); setShowImport(false); }}>Thêm từ ngân hàng</button><button className="button button-primary" disabled={Boolean(busy) || Boolean(question)} onClick={() => { setQuestion(emptyQuestion()); setQuestionDirty(false); setError(''); setPreview(null); }}>Thêm câu hỏi</button></div></div>
      {showImport && <ExcelImport endpoint={endpoint} disabled={Boolean(busy) || unsaved} onImported={() => { setShowImport(false); setPreview(null); setNotice('Đã nhập các câu hỏi hợp lệ vào bản nháp.'); reload(); }} />}
      {showBankImport && <QuestionBankImport endpoint={endpoint} disabled={Boolean(busy) || unsaved} onImported={count => { setShowBankImport(false); if (count > 0) { setPreview(null); setNotice(`Đã thêm ${count} câu từ ngân hàng vào bản nháp; các câu này tiếp tục đồng bộ khi ngân hàng được sửa.`); reload(); } }} />}
      <Notice>{questions.error || groups.error}</Notice>
      {question && <QuestionForm key={question.id || 'new'} question={question} saving={busy === 'question'} disabled={Boolean(busy)} onDirty={() => { setQuestionDirty(true); setNotice(''); setPreview(null); }} onSave={saveQuestion} onCancel={() => { setQuestion(null); setQuestionDirty(false); }} />}
      {questions.loading ? <Loading /> : !list(questions.data).length ? <div className="competition-empty"><h3>Chưa có câu hỏi</h3><p>Thêm câu hỏi hoặc nhập từ mẫu Excel, sau đó xem trước để kiểm tra đề thi.</p></div> : <ol className="exam-question-list">{list(questions.data).map((item, index) => <li key={item.id}><div className="question-item-heading"><strong>Câu {index + 1}</strong><span>{TYPE_NAMES[item.type]} · {GROUP_NAMES[item.group]} · {item.points} điểm{item.isScenario ? ' · Câu tình huống' : ''}</span></div><p className="exam-plain">{item.content || 'Chưa nhập nội dung câu hỏi'}</p><div className="exam-badges">{!item.correctAnswer && <span className="exam-warning-text">Thiếu đáp án đúng</span>}</div><div className="exam-actions"><button className="text-button" disabled={Boolean(busy) || Boolean(question)} onClick={() => { setQuestion({ ...item, options: list(item.options).map(option => ({ ...option })), correctAnswer: item.correctAnswer || '' }); setQuestionDirty(false); setError(''); }}>Sửa câu hỏi</button>{deleteId === item.id ? <><span>Xóa câu hỏi này?</span><button className="text-button exam-danger" disabled={Boolean(busy)} onClick={() => removeQuestion(item.id)}>Xác nhận xóa</button><button className="text-button" disabled={Boolean(busy)} onClick={() => setDeleteId(null)}>Hủy</button></> : <button className="text-button exam-danger" disabled={Boolean(busy) || unsaved} onClick={() => setDeleteId(item.id)}>Xóa</button>}</div></li>)}</ol>}
    </section>
    {preview && <Preview data={preview} onClose={() => setPreview(null)} />}
    {versionPreview && <Preview data={versionPreview.snapshot || {}} version={versionPreview} onClose={() => setVersionPreview(null)} />}
    <details className="panel exam-section exam-version-history"><summary>Phiên bản đã duyệt ({list(versions.data).length})</summary><div className="exam-history-content"><p>Mỗi lần duyệt lưu một phiên bản cố định. Chỉnh sửa bản nháp không thay đổi nội dung phiên bản đã phát cho bài thi.</p><Notice>{versions.error}</Notice>{versions.loading ? <Loading /> : !list(versions.data).length ? <p>Chưa có phiên bản đã duyệt.</p> : list(versions.data).map(version => <div className="exam-version-row" key={version.id}><div><strong>Phiên bản {version.versionNumber}</strong><span><DateText value={version.approvedAtUtc} /></span><small>Mã đối chiếu: {version.hashSha256}</small></div><button className="button button-secondary" disabled={Boolean(busy) || unsaved} onClick={() => loadVersion(version.id)}>Xem phiên bản</button></div>)}</div></details>
  </>;
}

export function QuestionForm({ question, onSave, onCancel, onDirty, disabled, saving }) {
  const [fields, setFields] = useState(() => {
    const current = { ...emptyQuestion(), ...question };
    const legacyOptions = Array.isArray(current.options) ? current.options : [];
    const answerIndex = current.type === 'TrueFalse'
      ? current.correctAnswer === 'True' ? 0 : current.correctAnswer === 'False' ? 1 : -1
      : legacyOptions.findIndex(option => option.key === current.correctAnswer);
    const normalizedOptions = ['A', 'B', 'C', 'D'].map((key, index) => ({
      key,
      text: current.type === 'TrueFalse' && index < 2
        ? legacyOptions[index]?.text || (index === 0 ? 'Đúng' : 'Sai')
        : legacyOptions[index]?.text || '',
    }));
    return {
      ...current,
      type: 'SingleChoice',
      options: normalizedOptions,
      correctAnswer: answerIndex >= 0 && answerIndex < normalizedOptions.length
        ? normalizedOptions[answerIndex].key : '',
      points: Number(current.points) > 0 ? Number(current.points) : 1,
    };
  });
  function change(key, value) {
    setFields(current => ({ ...current, [key]: value, ...(key === 'sourceReviewed' ? {} : { sourceReviewed: false }) })); onDirty();
  }
  function optionText(key, text) {
    setFields(current => ({ ...current, sourceReviewed: false, options: current.options.map(option => option.key === key ? { ...option, text } : option) })); onDirty();
  }
  function submit(event) {
    event.preventDefault();
    onSave({
      ...fields,
      type: 'SingleChoice',
      group: fields.group || 'Common',
      options: ['A', 'B', 'C', 'D'].map(key => fields.options.find(option => option.key === key) || { key, text: '' }),
      points: Number(fields.points) > 0 ? Number(fields.points) : 1,
      isScenario: false,
      correctAnswer: fields.correctAnswer || null,
    });
  }
  return <form className="exam-form question-form" onSubmit={submit} noValidate>
    <h3>{fields.id ? 'Sửa câu hỏi trắc nghiệm' : 'Tạo câu hỏi trắc nghiệm'}</h3>
    <div className="field"><label htmlFor="question-content">Nội dung câu hỏi</label><textarea id="question-content" rows={4} maxLength={5000} value={fields.content} onChange={event => change('content', event.target.value)} disabled={disabled} /></div>
    <div className="exam-options-grid">{fields.options.map(option => <div className="field" key={option.key}>
      <label htmlFor={`question-option-${option.key}`}>Đáp án {option.key}</label>
      <input id={`question-option-${option.key}`} maxLength={2000} value={option.text} onChange={event => optionText(option.key, event.target.value)} disabled={disabled} />
    </div>)}</div>
    <div className="field"><label htmlFor="question-answer">Chọn đáp án đúng</label>
      <select id="question-answer" value={fields.correctAnswer || ''} onChange={event => change('correctAnswer', event.target.value)} disabled={disabled}>
        <option value="">Chọn đáp án đúng</option>{fields.options.map(option => <option value={option.key} key={option.key}>Đáp án {option.key}</option>)}
      </select>
    </div>
    <div className="exam-actions"><button className="button button-primary" type="submit" disabled={disabled}>{saving ? 'Đang lưu...' : 'Lưu câu hỏi'}</button><button className="button button-secondary" type="button" disabled={disabled} onClick={onCancel}>Hủy</button></div>
  </form>;
}

function QuestionBankImport({ endpoint, disabled, onImported }) {
  const bank = useResource('/organizer/question-bank');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const questions = list(bank.data);
  async function submit(event) {
    event.preventDefault();
    if (busy || selected.length === 0) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`${endpoint}/questions/from-bank`, { questionIds: selected });
      onImported(Array.isArray(data) ? data.length : selected.length);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setBusy(false);
    }
  }
  return <section className="exam-import" aria-label="Thêm câu hỏi từ ngân hàng"><div className="exam-section-heading"><div><h3>Chọn câu hỏi trong ngân hàng</h3><p>Thay đổi ở ngân hàng sẽ đồng bộ vào bản nháp đang liên kết; phiên bản đề đã duyệt vẫn được giữ nguyên.</p></div><button className="button button-secondary" disabled={busy} onClick={() => onImported(0)}>Đóng</button></div><Notice>{error || bank.error}</Notice>{bank.loading ? <Loading /> : <form onSubmit={submit}><div className="bank-import-list">{questions.map(question => <label className="bank-import-item" key={question.id}><input type="checkbox" checked={selected.includes(question.id)} disabled={disabled || busy} onChange={event => setSelected(current => event.target.checked ? [...current, question.id] : current.filter(id => id !== question.id))} /><span><strong>{question.content || 'Chưa nhập nội dung'}</strong><small>{GROUP_NAMES[question.group]} · {question.points} điểm</small></span></label>)}</div>{!questions.length && <p>Ngân hàng chưa có câu hỏi đang hoạt động.</p>}<button type="submit" className="button button-primary" disabled={disabled || busy || selected.length === 0}>{busy ? 'Đang thêm...' : `Thêm ${selected.length} câu đã chọn`}</button></form>}</section>;
}

function Preview({ data, version, onClose }) {
  const exam = data.exam || data;
  const questions = list(data.questions || exam.questions);
  const validation = data.validation || {};
  return <section className="panel exam-section exam-preview" id="exam-preview" aria-label="Bản xem trước đề"><div className="exam-section-heading"><div><h2>{version ? `Phiên bản đã duyệt ${version.versionNumber}` : 'Bản xem trước đề'}</h2><p>{version ? 'Nội dung cố định đã được lưu khi duyệt; các chỉnh sửa bản nháp không tác động đến phiên bản này.' : 'Nội dung từ bản nháp đã lưu. Đáp án chỉ hiển thị trong khu vực Ban Tổ chức.'}</p></div><button className="button button-secondary" onClick={onClose}>Đóng xem trước</button></div><div className="exam-preview-content"><h3>{exam.name}</h3><p>{exam.durationMinutes} phút · {questions.length} câu · {questions.reduce((sum, question) => sum + Number(question.points || 0), 0)} điểm</p>{version && <div className="exam-version-hash">Mã đối chiếu SHA-256: <code>{version.hashSha256}</code></div>}{!version && <><Notice kind={validation.canApprove ? 'success' : 'info'}>{validation.canApprove ? 'Đề đáp ứng các điều kiện để duyệt.' : 'Đề chưa đủ điều kiện duyệt. Vui lòng sửa các mục dưới đây.'}</Notice>{list(validation.errors).length > 0 && <ul className="exam-validation-errors" role="alert">{validation.errors.map((issue, index) => <li key={index}>{issue.questionNumber ? `Câu ${issue.questionNumber}: ` : ''}{messageText(issue)}</li>)}</ul>}{list(validation.warnings).length > 0 && <ul className="exam-validation-warnings">{validation.warnings.map((issue, index) => <li key={index}>{messageText(issue)}</li>)}</ul>}</>}{!questions.length ? <p>Đề chưa có câu hỏi.</p> : <ol className="exam-preview-questions">{questions.map((question, index) => <li key={question.id || index}><div className="question-item-heading"><strong>Câu {index + 1}</strong><span>{TYPE_NAMES[question.type]} · {GROUP_NAMES[question.group]} · {question.points} điểm</span></div><p className="exam-plain">{question.content || 'Chưa có nội dung'}</p><ul className="exam-preview-options">{list(question.options).map(option => <li key={option.key} className={option.key === question.correctAnswer ? 'correct-answer' : ''}><strong>{option.key === 'True' ? 'Đúng' : option.key === 'False' ? 'Sai' : option.key}.</strong> {option.text || 'Chưa nhập phương án'}</li>)}</ul><p className="exam-preview-answer"><strong>Đáp án đúng:</strong> {question.correctAnswer ? question.correctAnswer === 'True' ? 'Đúng' : question.correctAnswer === 'False' ? 'Sai' : question.correctAnswer : 'Chưa chọn đáp án'}</p>{question.explanation && <p className="exam-plain"><strong>Giải thích:</strong> {question.explanation}</p>}{question.source && <p className="exam-plain"><strong>Nguồn đối chiếu:</strong> {question.source}</p>}{question.requiresSourceReview && <p className={question.sourceReviewed ? 'exam-reviewed' : 'exam-warning-text'}>{question.sourceReviewed ? 'Đã đối chiếu nguồn' : 'Chưa đối chiếu nguồn'}</p>}</li>)}</ol>}</div></section>;
}

function ExcelImport({ endpoint, onImported, disabled }) {
  const [file, setFile] = useState(null); const [preview, setPreview] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const operation = useRef(false);
  async function download() {
    if (operation.current) return; operation.current = true; setBusy('download'); setError('');
    try {
      const { data } = await api.get(`${endpoint}/import-template`, { responseType: 'blob' });
      const url = URL.createObjectURL(data); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Mau_nhap_cau_hoi_Tan_Hoa.xlsx'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(errorText(e, 'Không tải được mẫu Excel.')); } finally { operation.current = false; setBusy(''); }
  }
  function choose(value) {
    setPreview(null); setError('');
    if (value && (!value.name.toLowerCase().endsWith('.xlsx') || value.size > 5 * 1024 * 1024)) { setFile(null); setError('Chọn tệp Excel .xlsx không vượt quá 5 MB.'); return; }
    setFile(value || null);
  }
  async function upload(commit) {
    if (!file || operation.current) return; operation.current = true; setBusy(commit ? 'commit' : 'preview'); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const { data } = await api.post(`${endpoint}/${commit ? 'import' : 'import-preview'}`, form, { timeout: 30000 });
      if (commit) { setFile(null); setPreview(null); onImported(data); } else setPreview(data);
    } catch (e) {
      const data = e.response?.data;
      if (data?.rows) setPreview(data);
      setError(errorText(e, 'Không đọc được tệp Excel. Vui lòng kiểm tra định dạng và các dòng dữ liệu.'));
    } finally { operation.current = false; setBusy(''); }
  }
  return <div className="exam-import"><div className="exam-section-heading"><div><h3>Nhập câu hỏi từ Excel</h3><p>Tải mẫu và điền sheet <strong>CauHoi</strong>. Sheet hướng dẫn và ví dụ minh họa không được nhập vào đề.</p></div><button className="button button-secondary" disabled={Boolean(busy) || disabled} onClick={download}>{busy === 'download' ? 'Đang tải...' : 'Tải mẫu Excel'}</button></div><Notice>{error}</Notice><div className="field"><label htmlFor="exam-import-file">Tệp câu hỏi (.xlsx, tối đa 5 MB và 500 dòng)</label><input id="exam-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy) || disabled} onChange={event => choose(event.target.files?.[0])} /></div><div className="exam-actions"><button className="button button-secondary" disabled={!file || Boolean(busy) || disabled} onClick={() => upload(false)}>{busy === 'preview' ? 'Đang đọc dữ liệu...' : 'Xem trước dữ liệu Excel'}</button>{preview && <button className="button button-primary" disabled={!preview.canImport || Boolean(busy) || disabled} onClick={() => upload(true)}>{busy === 'commit' ? 'Đang nhập...' : `Nhập ${preview.validRows ?? preview.totalRows} câu hỏi`}</button>}</div>{preview && <div className="exam-import-preview"><h4>Xem trước dữ liệu Excel</h4><p>{preview.totalRows} dòng dữ liệu · {preview.validRows} dòng hợp lệ. {preview.canImport ? 'Có thể nhập toàn bộ dữ liệu.' : 'Sửa các dòng báo lỗi trong Excel rồi tải lại tệp.'}</p>{list(preview.errors).length > 0 && <ul className="exam-validation-errors">{preview.errors.map((issue, index) => <li key={index}>{messageText(issue)}</li>)}</ul>}<div className="exam-import-rows">{list(preview.rows).map((row, index) => <article key={row.rowNumber || index} className={list(row.errors).length ? 'has-errors' : ''}><div className="question-item-heading"><strong>Dòng {row.rowNumber}</strong><span>{list(row.errors).length ? 'Cần sửa' : 'Hợp lệ'}</span></div><p className="exam-plain">{row.question?.content || row.content || 'Chưa có nội dung'}</p>{row.question && <small>{TYPE_NAMES[row.question.type]} · {GROUP_NAMES[row.question.group]} · {row.question.points} điểm · Đáp án: {row.question.correctAnswer || 'Chưa chọn'}</small>}{list(row.errors).length > 0 && <ul className="exam-validation-errors">{row.errors.map((issue, item) => <li key={item}>{messageText(issue)}</li>)}</ul>}{list(row.warnings).length > 0 && <ul className="exam-validation-warnings">{row.warnings.map((issue, item) => <li key={item}>{messageText(issue)}</li>)}</ul>}</article>)}</div></div>}</div>;
}

function utcToLocalInput(value) {
  if (!value) return '';
  const formatted = formatVietnamDateTime(value);
  return formatted === '—' ? '' : formatted;
}

function Schedule({ base }) {
  const [revision, setRevision] = useState(0);
  const schedule = useResource(`${base}/schedule`, revision);
  const exams = useResource(`${base}/exams`);
  const [fields, setFields] = useState({ opensAtLocal: '', startDeadlineLocal: '', closesAtLocal: '' });
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [warnings, setWarnings] = useState([]); const [busy, setBusy] = useState(false); const operation = useRef(false);
  useEffect(() => {
    if (schedule.data) { const value = schedule.data; setFields({ opensAtLocal: value.opensAtLocal || utcToLocalInput(value.opensAtUtc), startDeadlineLocal: value.startDeadlineLocal || utcToLocalInput(value.startDeadlineUtc), closesAtLocal: value.closesAtLocal || utcToLocalInput(value.closesAtUtc) }); setWarnings(list(value.warnings)); }
  }, [schedule.data]);
  function change(key, value) { setFields(current => ({ ...current, [key]: value })); setNotice(''); setError(''); setWarnings([]); }
  const opensAtIso = parseVietnamDateTimeInput(fields.opensAtLocal);
  const startDeadlineIso = parseVietnamDateTimeInput(fields.startDeadlineLocal);
  const closesAtIso = parseVietnamDateTimeInput(fields.closesAtLocal);
  const available = startDeadlineIso && closesAtIso ? (Date.parse(`${closesAtIso}+07:00`) - Date.parse(`${startDeadlineIso}+07:00`)) / 60000 : null;
  const lateExams = available !== null && available >= 0 ? list(exams.data).filter(exam => Number(exam.durationMinutes) > available) : [];
  async function save(event) {
    event.preventDefault(); if (operation.current) return;
    if (!fields.opensAtLocal || !fields.startDeadlineLocal || !fields.closesAtLocal) { setError('Vui lòng nhập đủ ngày và giờ mở thi, hạn bắt đầu và ngày giờ đóng thi.'); return; }
    if (!opensAtIso || !startDeadlineIso || !closesAtIso) { setError('Vui lòng nhập ngày giờ hợp lệ theo dạng dd/MM/yyyy HH:mm.'); return; }
    if (closesAtIso <= opensAtIso) { setError('Ngày và giờ đóng thi phải sau ngày và giờ mở thi.'); return; }
    if (startDeadlineIso <= opensAtIso || startDeadlineIso > closesAtIso) { setError('Hạn bắt đầu phải sau giờ mở thi và không được sau giờ đóng thi.'); return; }
    operation.current = true; setBusy(true); setError(''); setNotice('');
    try { const { data } = await api.put(`${base}/schedule`, fields); setWarnings(list(data.warnings)); setNotice('Đã lưu lịch thi theo giờ Việt Nam.'); setRevision(value => value + 1); }
    catch (e) { setError(errorText(e)); } finally { operation.current = false; setBusy(false); }
  }
  if (schedule.loading && !schedule.data) return <Loading />;
  return <div className="exam-schedule-layout"><section className="panel exam-section"><div className="exam-section-heading"><div><h2>Lịch thi của cuộc thi</h2><p>Lịch dùng chung cho các đề. Thời lượng làm bài được đặt riêng ở từng đề thi.</p></div></div><form className="exam-form schedule-form" onSubmit={save} noValidate><Notice>{error || schedule.error}</Notice><Notice kind="success">{notice}</Notice><Notice kind="info">Nhập giờ Việt Nam theo dạng <strong>dd/MM/yyyy HH:mm</strong> (Asia/Ho_Chi_Minh, UTC+7), kể cả khi thiết bị đang ở múi giờ khác.</Notice><div className="field"><label htmlFor="schedule-opens">Ngày và giờ mở thi</label><input id="schedule-opens" type="text" inputMode="numeric" placeholder="dd/MM/yyyy HH:mm" maxLength={16} required value={fields.opensAtLocal} onChange={e => change('opensAtLocal', e.target.value)} disabled={busy} /></div><div className="field"><label htmlFor="schedule-start-deadline">Hạn bắt đầu</label><input id="schedule-start-deadline" type="text" inputMode="numeric" placeholder="dd/MM/yyyy HH:mm" maxLength={16} required value={fields.startDeadlineLocal} onChange={e => change('startDeadlineLocal', e.target.value)} disabled={busy} /><p className="exam-hint">Sau mốc này, thí sinh không được bắt đầu bài mới.</p></div><div className="field"><label htmlFor="schedule-closes">Ngày và giờ đóng thi</label><input id="schedule-closes" type="text" inputMode="numeric" placeholder="dd/MM/yyyy HH:mm" maxLength={16} required value={fields.closesAtLocal} onChange={e => change('closesAtLocal', e.target.value)} disabled={busy} /><p className="exam-hint">Thời gian làm bài thực tế không vượt quá mốc đóng thi.</p></div>{lateExams.length > 0 && <Notice kind="warning"><div><strong>Người bắt đầu sát hạn có thể nhận ít thời gian hơn thời lượng đã đặt.</strong><ul>{lateExams.map(exam => <li key={exam.id}>{exam.name}: đặt {exam.durationMinutes} phút, nhưng bắt đầu sát hạn chỉ còn khoảng {Math.max(0, available)} phút trước khi đóng thi.</li>)}</ul></div></Notice>}{warnings.length > 0 && <div className="exam-schedule-warnings"><h3>Lưu ý về thời gian làm bài</h3><ul>{warnings.map((warning, index) => <li key={index}>{messageText(warning)}</li>)}</ul></div>}<button type="submit" className="button button-primary" disabled={busy || Boolean(schedule.error)}>{busy ? 'Đang lưu...' : 'Lưu lịch thi'}</button></form></section><aside className="exam-schedule-guide"><h3>Ba mốc cần thống nhất</h3><ol><li><strong>Mở thi</strong><span>Bắt đầu cho phép vào làm bài.</span></li><li><strong>Hạn bắt đầu</strong><span>Thời điểm cuối được bắt đầu bài mới.</span></li><li><strong>Đóng thi</strong><span>Mọi bài làm đều chịu giới hạn giờ đóng thi.</span></li></ol><p>Thời gian phải theo thứ tự: mở thi &lt; hạn bắt đầu ≤ đóng thi. Hệ thống kiểm tra lại các mốc trên máy chủ trước khi lưu.</p></aside></div>;
}
