import {useAccess} from './AccessContext.jsx';
import ExamReviewActions,{REVIEW_LABELS} from './ExamReviewActions.jsx';
import DateTimePicker from './DateTimePicker.jsx';
import { useEffect, useRef, useState } from 'react';
import QuestionLibraryPicker from './QuestionLibraryPicker.jsx';
import { api, isConnectionError } from './api.js';
import { emptyQuestion, QuestionForm, QuestionCard } from './QuestionEditor.jsx';
export { emptyQuestion, QuestionForm } from './QuestionEditor.jsx';
import './ExamWorkspace.css';
import {questionTopicLabel} from './questionLibrary.mjs';
import AssignmentWorkspace, { AwardReviewWorkspace } from './AssignmentWorkspace.jsx';
import { formatVietnamDateTime, parseVietnamDateTimeInput } from './dateTime.js';

const ROOT = '/ban-to-chuc/cuoc-thi';

const TYPE_NAMES = { SingleChoice: 'Một đáp án đúng', TrueFalse: 'Đúng / Sai' };
const DEFAULT_CONFIG = { name: '', fieldGroupId: '', durationMinutes: 30, targetQuestionCount: 30, commonQuestionCount: 10, specializedQuestionCount: 20 };
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

export function isExamWorkspacePath(path) { return /^\/ban-to-chuc\/cuoc-thi\/\d+\/(de-thi(?:\/\d+)?|lich-thi|phan-cong|trinh-duyet|xet-giai)$/.test(path); }

export function CompetitionTabs({ competitionId, path, navigate }) {
  const {can}=useAccess();
  const base = `${ROOT}/${competitionId}`;
  if (path.endsWith('/xet-giai')) return <nav className="competition-tabs" aria-label="Các bước cuộc thi"><a href={`${base}/trinh-duyet`} onClick={event=>{event.preventDefault();navigate(`${base}/trinh-duyet`);}}>← Quay lại trình duyệt</a></nav>;
  const steps = [
    {label:'Thông tin', url:`${base}/chinh-sua`, allowed:true},
    {label:'Lịch thi', url:`${base}/lich-thi`, allowed:can('operate')},
    {label:'Phân công', url:`${base}/phan-cong`, allowed:can('operate')},
    {label:'Trình duyệt', url:`${base}/trinh-duyet`, allowed:can('submit')||can('approve')},
  ];
  const index = path.endsWith('/chinh-sua') ? 0 : path.endsWith('/lich-thi') ? 1 : path.endsWith('/phan-cong') ? 2 : 3;
  return <nav className="competition-tabs" aria-label="Tiến độ cuộc thi"><ol>{steps.map((step,i)=> <li key={step.url} className={`${i===index?'current':i<index?'completed':'upcoming'} ${step.allowed?'':'restricted'}`}>
    {step.allowed&&i<=index ? <a href={step.url} aria-current={i===index?'step':undefined} onClick={event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();navigate(step.url);}}><span className="competition-step-number">{i<index?'✓':i+1}</span><span>{step.label}</span></a> : <span aria-disabled="true"><span className="competition-step-number">{i+1}</span><span>{step.label}</span></span>}
  </li>)}</ol></nav>;
}
export default function ExamWorkspace({ path, navigate }) {
  const {can} = useAccess();
  const match = path.match(/^\/ban-to-chuc\/cuoc-thi\/(\d+)\/(de-thi|lich-thi|phan-cong|trinh-duyet|xet-giai)(?:\/(\d+))?$/);
  const competitionId = match?.[1];
  const base = `/organizer/competitions/${competitionId}`;
  const competition = useResource(base);
  if (competition.loading) return <Loading />;
  if (competition.error) return <Notice>{competition.error}</Notice>;
  if(match[3]&&!['draft','submit','approve'].some(can))return <Notice>Tài khoản tổ chức thi chỉ xem thông tin đề đã duyệt tại Phân công dự thi.</Notice>;
  if(['lich-thi','phan-cong'].includes(match[2])&&!can('operate'))return <Notice>Tài khoản chưa được cấp quyền tổ chức thi.</Notice>;
  if(match[2]==='phan-cong'&&!can('operate'))return <Notice>Tài khoản chưa được cấp quyền tổ chức thi.</Notice>;
  if(match[2]==='trinh-duyet'&&!can('submit')&&!can('approve'))return <Notice>Tài khoản chưa được cấp quyền trình duyệt đề.</Notice>;
  if(match[2]==='xet-giai'&&!can('operate')&&!can('approve'))return <Notice>Tài khoản chưa được cấp quyền xem kết quả.</Notice>;
  return <div className="exam-workspace"><div className="exam-parent"><span>CUỘC THI</span><strong>{competition.data?.name}</strong>{competition.data?.isDemo && <span className="demo-label">Dữ liệu minh họa</span>}</div><CompetitionTabs {...{ competitionId, path, navigate }} />{match[2] === 'phan-cong' ? <AssignmentWorkspace key={`assignment-${competitionId}`} competitionId={competitionId} navigate={navigate} /> : match[2] === 'trinh-duyet' ? <ReviewSubmissionWorkspace key={`review-${competitionId}`} competitionId={competitionId} navigate={navigate} /> : match[2] === 'xet-giai' ? <AwardReviewWorkspace key={`awards-${competitionId}`} competitionId={competitionId} /> : match[2] === 'lich-thi' ? <Schedule key={`schedule-${competitionId}`} base={base} navigate={navigate} /> : match[3] ? <ExamEditor key={`${competitionId}-${match[3]}`} base={base} competitionId={competitionId} examId={match[3]} navigate={navigate} /> : <ExamList key={`list-${competitionId}`} {...{ base, competitionId, navigate }} />}</div>;
}

function ReviewSubmissionWorkspace({ competitionId, navigate }) {
  const {can}=useAccess(),base=`/organizer/competitions/${competitionId}`;
  const [revision,setRevision]=useState(0),[previews,setPreviews]=useState({}),[busy,setBusy]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const exams=useResource(`${base}/exams`,revision),schedule=useResource(`${base}/schedule`,revision),assignments=useResource(`${base}/assignments`,revision);
  useEffect(()=>{if(!Array.isArray(exams.data)){setPreviews({});return;}const controller=new AbortController();setPreviews({});Promise.all(exams.data.map(async exam=>{try{const {data}=await api.get(`${base}/exams/${exam.id}/preview`,{signal:controller.signal});return [exam.id,data.validation||{}];}catch(e){return [exam.id,{canApprove:false,errors:[e.response?.data?.message||'Không tải được kết quả kiểm tra đề.']}];}})).then(rows=>{if(!controller.signal.aborted)setPreviews(Object.fromEntries(rows));});return()=>controller.abort();},[base,exams.data]);
  const s=schedule.data||{},scheduleReady=Boolean(s.opensAtUtc&&s.startDeadlineUtc&&s.closesAtUtc&&Date.parse(s.opensAtUtc)<Date.parse(s.startDeadlineUtc)&&Date.parse(s.startDeadlineUtc)<=Date.parse(s.closesAtUtc));
  const assignmentReady=list(assignments.data).length>0;
  async function submit(exam){if(busy)return;setBusy(exam.id);setError('');setNotice('');try{await api.post(`${base}/exams/${exam.id}/submit-review`,{draftRevision:exam.draftRevision});setNotice(`Đã gửi đề “${exam.name}” chờ duyệt.`);setRevision(value=>value+1);}catch(e){setError(errorText(e));}finally{setBusy(null);}}
  return <section className="panel exam-section"><div className="exam-section-heading"><div><span className="eyebrow">BƯỚC 4</span><h2>Kiểm tra và trình duyệt</h2><p>Gửi đề sau khi đã có lịch thi, phân công và đề đạt điều kiện nội dung.</p></div>{can('approve')&&<button type="button" className="button button-secondary" onClick={()=>navigate('/ban-to-chuc/cho-duyet')}>Mở hàng chờ duyệt</button>}</div>
    <Notice>{error||exams.error||schedule.error||assignments.error}</Notice><Notice kind="success">{notice}</Notice>
    <div className="exam-review-readiness"><div className={scheduleReady?'ready':''}><strong>{scheduleReady?'✓':'1'}</strong><span>{scheduleReady?'Đã có lịch thi hợp lệ':'Cần tạo lịch thi'}</span></div><div className={assignmentReady?'ready':''}><strong>{assignmentReady?'✓':'2'}</strong><span>{assignmentReady?'Đã có phân công':'Cần phân công ít nhất một thí sinh'}</span></div></div>
    {!scheduleReady&&<button type="button" className="button button-secondary" onClick={()=>navigate(`${base}/lich-thi`)}>Đi tới xếp lịch</button>}{scheduleReady&&!assignmentReady&&<button type="button" className="button button-secondary" onClick={()=>navigate(`${base}/phan-cong`)}>Đi tới phân công</button>}
    {exams.loading&&!exams.data?<Loading/>:!list(exams.data).length?<div className="competition-empty"><h3>Chưa có đề thi</h3><p>Tạo đề và câu hỏi trước khi gửi duyệt.</p><button type="button" className="button button-secondary" onClick={()=>navigate(`${base}/de-thi`)}>Tạo đề thi</button></div>:<div className="exam-review-submit-list">{list(exams.data).map(exam=>{const validation=previews[exam.id],pending=exam.reviewStatus==='PendingReview',approved=exam.isApproved;return <article key={exam.id}><div><span className={`exam-status ${approved?'approved':''}`}>{approved?'Đã duyệt':pending?'Chờ duyệt':'Nháp'}</span><h3>{exam.name}</h3><p>{exam.targetQuestionCount} câu theo cấu hình · {exam.questionCount??'—'} câu hiện có · sửa lần {exam.draftRevision}</p>{validation&&!validation.canApprove&&list(validation.errors).length>0&&<ul className="exam-validation-errors">{list(validation.errors).map((issue,index)=><li key={index}>{messageText(issue)}</li>)}</ul>}</div><div className="exam-actions"><button type="button" className="button button-secondary" onClick={()=>navigate(`${base}/de-thi/${exam.id}`)}>Mở đề</button>{can('submit')&&!pending&&!approved&&<button type="button" className="button button-primary" disabled={Boolean(busy)||!scheduleReady||!assignmentReady||!validation?.canApprove} onClick={()=>submit(exam)}>{busy===exam.id?'Đang gửi...':'Gửi chờ duyệt'}</button>}</div></article>;})}</div>}
  </section>;
}

function ConfigFields({ fields, setFields, groups, disabled }) {
  const change = (key, value) => setFields(current => ({ ...current, [key]: value }));
  return <div className="exam-config-fields"><div className="field exam-wide"><label htmlFor="exam-name">Tên đề thi <span className="required-mark">*</span></label><input id="exam-name" maxLength={300} required value={fields.name} onChange={e => change('name', e.target.value)} disabled={disabled} placeholder="Ví dụ: Đề thi lĩnh vực kinh tế và hạ tầng" /></div><div className="field exam-wide"><label htmlFor="exam-field-group">Nhóm lĩnh vực <span className="required-mark">*</span></label><select id="exam-field-group" required value={fields.fieldGroupId} onChange={e => change('fieldGroupId', e.target.value)} disabled={disabled}><option value="">Chọn nhóm lĩnh vực</option>{list(groups).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div><div className="field"><label htmlFor="exam-duration">Th&#7901;i l&#432;&#7907;ng &#273;&#7873; thi (ph&#250;t)</label><p className="exam-hint">Th&#7901;i l&#432;&#7907;ng chung c&#7911;a cu&#7897;c thi s&#7869; &#273;&#432;&#7907;c &#432;u ti&#234;n n&#7871;u &#273;&#227; thi&#7871;t l&#7853;p.</p><input id="exam-duration" type="number" min="1" max="480" required value={fields.durationMinutes} onChange={e => change('durationMinutes', e.target.value)} disabled={disabled} /></div><div className="field"><label htmlFor="exam-target-count">Tổng số câu</label><input id="exam-target-count" type="number" min="1" max="500" required value={fields.targetQuestionCount} onChange={e => change('targetQuestionCount', e.target.value)} disabled={disabled} /></div></div>;
}

function configBody(fields) {
  return { name: fields.name.trim(), fieldGroupId: Number(fields.fieldGroupId), durationMinutes: Number(fields.durationMinutes), targetQuestionCount: Number(fields.targetQuestionCount) };
}
function configError(fields) {
  const value = configBody(fields);
  if (!value.name) return 'Vui lòng nhập tên đề thi.';
  if (!value.fieldGroupId) return 'Vui lòng chọn nhóm lĩnh vực.';
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 1 || value.durationMinutes > 480) return 'Thời lượng làm bài phải từ 1 đến 480 phút.';
  if (!Number.isInteger(value.targetQuestionCount) || value.targetQuestionCount < 1 || value.targetQuestionCount > 500) return 'Tổng số câu phải từ 1 đến 500.';
  return '';
}

function ExamList({ base, competitionId, navigate }) {
  const {can}=useAccess();
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
  return <><section className="panel exam-section"><div className="exam-section-heading"><div><h2>Đề thi theo lĩnh vực</h2><p>Tạo nhiều đề trong cùng cuộc thi, với thời lượng và cơ cấu câu hỏi riêng.</p></div><button className="button button-primary" disabled={!can('draft')} onClick={() => { setCreating(true); setError(''); }}>Tạo đề thi</button></div>{creating && <form className="exam-form exam-create-form" onSubmit={create}><h3>Tạo đề thi</h3><Notice kind="info">Cấu hình ban đầu: 30 câu, 30 phút. Bạn có thể thay đổi; hệ thống không tạo sẵn câu hỏi.</Notice><Notice>{error}</Notice><ConfigFields {...{ fields, setFields }} groups={groups.data} disabled={busy} /><div className="exam-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu đề thi'}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => setCreating(false)}>Hủy</button></div></form>}{exams.loading ? <Loading /> : exams.error || groups.error ? <Notice>{exams.error || groups.error}</Notice> : !list(exams.data).length ? <div className="competition-empty"><h3>Chưa có đề thi</h3><p>Bắt đầu bằng một đề thi theo nhóm lĩnh vực được phân công.</p></div> : <div className="exam-list">{list(exams.data).map(exam => <article key={exam.id} className="exam-list-row"><div><div className="exam-badges"><span className={`exam-status ${exam.isApproved ? 'approved' : ''}`}>{exam.isApproved ? 'Đã duyệt' : REVIEW_LABELS[exam.reviewStatus]||'Bản nháp'}</span>{exam.isDemo && <span className="demo-label">Minh họa</span>}</div><h3>{exam.name}</h3><p>{exam.fieldGroupName || list(groups.data).find(group => group.id === exam.fieldGroupId)?.name} · {exam.targetQuestionCount} câu · {exam.durationMinutes} phút</p></div><button className="button button-secondary" onClick={() => navigate(`${ROOT}/${competitionId}/de-thi/${exam.id}`)}>Mở đề thi</button></article>)}</div>}</section>{can('draft') && <FieldGroups base={base} groups={list(groups.data)} onChanged={() => setRevision(value => value + 1)} />}</>;
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

export function ExamEditor({ base, competitionId, examId, navigate, reviewOnly = false, onClose, onDecisionComplete }) {
  const {can}=useAccess();
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
  const [selectedQuestions, setSelectedQuestions] = useState([]);
  const [confirmBulkRemove, setConfirmBulkRemove] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef(false);
  useEffect(() => { if (exam.data && !configDirty) setFields({ ...DEFAULT_CONFIG, ...exam.data }); }, [exam.data, configDirty]);
  useEffect(() => { if (!questions.loading && !questions.error) setSelectedQuestions(ids => ids.filter(id => list(questions.data).some(q => q.id === id))); }, [questions.data, questions.loading, questions.error]);
  function changedConfig(update) { setConfigDirty(true); setNotice(''); setError(''); setPreview(null); setFields(update); }
  function reload() { setRevision(value => value + 1); }
  async function addBankQuestions(rows, options) {
    if (operation.current) throw new Error('Đang xử lý, vui lòng chờ.');
    operation.current = true; setBusy('bank'); setError('');
    try {
      const { data } = await api.post(`${endpoint}/questions/from-bank`, { questionIds: rows.map(q => q.id), syncCounts: options.syncCounts });
      setShowBankImport(false); setPreview(null); setNotice(`Đã thêm ${data.length} câu hỏi vào bản nháp.`); reload();
    } finally { operation.current = false; setBusy(''); }
  }
  async function removeSelectedQuestions() {
    await run('bulk-remove', async () => {
      const ids = selectedQuestions.filter(id => list(questions.data).some(q => q.id === id));
      const { data } = await api.post(`${endpoint}/questions/remove-many`, { questionIds: ids, syncCounts: true });
      setSelectedQuestions([]); setConfirmBulkRemove(false); setPreview(null); setNotice(`Đã bỏ ${data.removedCount} câu khỏi đề. Câu hỏi trong ngân hàng vẫn được giữ nguyên.`); reload();
    });
  }
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
    await run('delete', async () => { await api.post(`${endpoint}/questions/remove-many`, { questionIds: [id], syncCounts: true }); setDeleteId(null); setPreview(null); setNotice('Đã bỏ câu hỏi khỏi bản nháp và khớp lại số câu.'); reload(); });
  }
  async function showPreview() {
    await run('preview', async () => { const { data } = await api.get(`${endpoint}/preview`); setPreview(data); setVersionPreview(null); });
  }
  async function loadVersion(id) {
    await run('version', async () => { const { data } = await api.get(`${endpoint}/versions/${id}`); setVersionPreview(data); setPreview(null); });
  }
  if (exam.loading && !exam.data) return <Loading />;
  if (exam.error) return <Notice>{exam.error}</Notice>;
  const record = exam.data || {};
  const unsaved = configDirty || questionDirty;
  const locked = reviewOnly || !can('draft') || record.reviewStatus === 'PendingReview';
  return <>
    <div className="exam-editor-top"><div>{!reviewOnly&&<button className="text-button" onClick={() => navigate(`${ROOT}/${competitionId}/de-thi`)}>← Danh sách đề thi</button>}<h2>{record.name}</h2><div className="exam-badges"><span className={`exam-status ${record.isApproved ? 'approved' : ''}`}>{record.isApproved ? 'Đã duyệt bản hiện tại' : REVIEW_LABELS[record.reviewStatus]||'Bản nháp'}</span><span>Chỉnh sửa lần {record.draftRevision || 1}</span>{record.isDemo && <span className="demo-label">Minh họa</span>}</div></div><div className="exam-actions"><button className="button button-secondary" disabled={Boolean(busy) || unsaved} onClick={showPreview}>Xem trước đề</button>{reviewOnly&&<button className="button button-secondary" type="button" onClick={onClose}>Đóng</button>}</div></div>
    {!question && <Notice>{error}</Notice>}<Notice kind="success">{notice}</Notice>{unsaved && <Notice kind="info">Có nội dung chưa lưu. Vui lòng lưu cấu hình hoặc câu hỏi trước khi xem trước và duyệt đề.</Notice>}
    {record.currentApprovedVersionId && !record.isApproved && <Notice kind="info">Bản nháp đã thay đổi sau lần duyệt trước. Phiên bản đã duyệt vẫn được giữ nguyên để các bài thi đã phát tiếp tục tham chiếu đúng nội dung.</Notice>}
    <ExamReviewActions record={record} endpoint={endpoint} onChanged={reload} onComplete={onDecisionComplete} unsaved={unsaved}/>
    <fieldset className="permission-readonly" disabled={locked}><section className="panel exam-section"><details className="exam-config-details" open><summary>Cấu hình đề thi</summary><form className="exam-form" onSubmit={saveConfig}><p className="exam-hint">Cấu hình thời lượng và tổng số câu; nội dung câu hỏi được quản lý theo chủ đề.</p><ConfigFields fields={fields} setFields={changedConfig} groups={groups.data} disabled={Boolean(busy)} /><button type="submit" className="button button-secondary" disabled={Boolean(busy)}>{busy === 'config' ? 'Đang lưu...' : 'Lưu cấu hình'}</button></form></details></section>
    <section className="panel exam-section"><div className="exam-section-heading"><div><h2>Câu hỏi của đề</h2><p>{list(questions.data).length} / {record.targetQuestionCount} câu · đáp án và điểm được kiểm tra khi duyệt.</p></div><div className="exam-actions"><button className="button button-secondary" disabled={Boolean(busy) || unsaved} onClick={() => { setShowImport(value => !value); setShowBankImport(false); }}>Nhập từ Excel</button><button className="button button-secondary" disabled={Boolean(busy) || unsaved} onClick={() => { setShowBankImport(value => !value); setShowImport(false); }}>Thêm từ ngân hàng</button><button className="button button-primary" disabled={Boolean(busy) || Boolean(question)} onClick={() => { setQuestion(emptyQuestion()); setQuestionDirty(false); setError(''); setPreview(null); }}>Thêm câu hỏi</button></div></div>
      {showImport && <ExcelImport endpoint={endpoint} disabled={Boolean(busy) || unsaved} onImported={() => { setShowImport(false); setPreview(null); setNotice('Đã nhập các câu hỏi hợp lệ vào bản nháp.'); reload(); }} />}
      {showBankImport && <QuestionLibraryPicker context="Thêm câu hỏi vào đề" confirmLabel="Thêm vào đề" excludedIds={list(questions.data).map(q => q.bankQuestionId).filter(Boolean)} maximum={Math.min(400, Math.max(0, 500 - list(questions.data).length))} showSyncCounts onConfirm={addBankQuestions} onCancel={() => setShowBankImport(false)} />}
      <Notice>{questions.error || groups.error}</Notice>
      {question && <QuestionForm key={question.id || 'new'} question={question} context="Câu hỏi của đề" error={error} saving={busy === 'question'} disabled={Boolean(busy)} onDirty={() => { setQuestionDirty(true); setError(''); setNotice(''); setPreview(null); }} onSave={saveQuestion} onCancel={() => { setQuestion(null); setQuestionDirty(false); setError(''); }} />}
      {list(questions.data).length > 0 && <div className="eq-bulk-toolbar"><label><input type="checkbox" checked={list(questions.data).slice(0, 400).every(q => selectedQuestions.includes(q.id))} disabled={Boolean(busy) || unsaved} onChange={e => { setSelectedQuestions(e.target.checked ? list(questions.data).slice(0, 400).map(q => q.id) : []); setConfirmBulkRemove(false); }} /> {list(questions.data).length > 400 ? "Chọn 400 câu đầu" : "Chọn tất cả"}</label><span>{selectedQuestions.filter(id => list(questions.data).some(q => q.id === id)).length} câu đã chọn</span><button type="button" className="button button-secondary exam-danger" disabled={!selectedQuestions.length || Boolean(busy) || unsaved} onClick={() => setConfirmBulkRemove(true)}>Bỏ câu đã chọn</button><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => { setSelectedQuestions([]); setConfirmBulkRemove(false); }}>Bỏ chọn</button></div>}
      {confirmBulkRemove && <div className="eq-remove-confirm" role="alert"><p>Bỏ {selectedQuestions.length} câu khỏi bản nháp? Câu trong ngân hàng và phiên bản đã duyệt vẫn được giữ nguyên. Số câu được tự khớp khi đề còn câu hỏi.</p><button type="button" className="button button-secondary exam-danger" disabled={Boolean(busy)} onClick={removeSelectedQuestions}>Xác nhận bỏ</button><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => setConfirmBulkRemove(false)}>Hủy</button></div>}
      {questions.loading ? <Loading /> : !list(questions.data).length ? <div className="competition-empty"><h3>Chưa có câu hỏi</h3><p>Thêm câu hỏi hoặc nhập từ mẫu Excel, sau đó xem trước để kiểm tra đề thi.</p></div> : <ol className="question-card-list">{list(questions.data).map((item, index) => <QuestionCard key={item.id} question={item} index={index} selectable selected={selectedQuestions.includes(item.id)} onSelectionChange={checked => { setSelectedQuestions(ids => checked ? [...new Set([...ids, item.id])].slice(0, 400) : ids.filter(id => id !== item.id)); setConfirmBulkRemove(false); }} disabled={Boolean(busy) || Boolean(question) || configDirty} busy={Boolean(busy)} confirming={deleteId === item.id} onEdit={() => { setQuestion({ ...item, options: list(item.options).map(option => ({ ...option })), correctAnswer: item.correctAnswer || '' }); setQuestionDirty(false); setError(''); }} onDelete={() => setDeleteId(item.id)} onConfirmDelete={() => removeQuestion(item.id)} onCancelDelete={() => setDeleteId(null)} />)}</ol>}
    </section>
    </fieldset>
    {preview && <Preview data={preview} onClose={() => setPreview(null)} />}
    {versionPreview && <Preview data={versionPreview.snapshot || {}} version={versionPreview} onClose={() => setVersionPreview(null)} />}
    <details className="panel exam-section exam-version-history"><summary>Phiên bản đã duyệt ({list(versions.data).length})</summary><div className="exam-history-content"><p>Mỗi lần duyệt lưu một phiên bản cố định. Chỉnh sửa bản nháp không thay đổi nội dung phiên bản đã phát cho bài thi.</p><Notice>{versions.error}</Notice>{versions.loading ? <Loading /> : !list(versions.data).length ? <p>Chưa có phiên bản đã duyệt.</p> : list(versions.data).map(version => <div className="exam-version-row" key={version.id}><div><strong>Phiên bản {version.versionNumber}</strong><span><DateText value={version.approvedAtUtc} /></span><small>Mã đối chiếu: {version.hashSha256}</small></div><button className="button button-secondary" disabled={Boolean(busy) || unsaved} onClick={() => loadVersion(version.id)}>Xem phiên bản</button></div>)}</div></details>
  </>;
}


function Preview({ data, version, onClose }) {
  const exam = data.exam || data;
  const questions = list(data.questions || exam.questions);
  const validation = data.validation || {};
  return <div className="exam-preview-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="panel exam-section exam-preview" id="exam-preview" role="dialog" aria-modal="true" aria-label="Bản xem trước đề"><div className="exam-section-heading"><div><h2>{version ? `Phiên bản đã duyệt ${version.versionNumber}` : 'Bản xem trước đề'}</h2><p>{version ? 'Nội dung cố định đã được lưu khi duyệt; các chỉnh sửa bản nháp không tác động đến phiên bản này.' : 'Nội dung từ bản nháp đã lưu. Đáp án chỉ hiển thị trong khu vực Ban Tổ chức.'}</p></div><button className="button button-secondary" onClick={onClose}>Đóng xem trước</button></div><div className="exam-preview-content"><h3>{exam.name}</h3><p>{exam.durationMinutes} phút · {questions.length} câu · {questions.reduce((sum, question) => sum + Number(question.points || 0), 0)} điểm</p>{version && <div className="exam-version-hash">Mã đối chiếu SHA-256: <code>{version.hashSha256}</code></div>}{!version && <><Notice kind={validation.canApprove ? 'success' : 'info'}>{validation.canApprove ? 'Đề đáp ứng các điều kiện để duyệt.' : 'Đề chưa đủ điều kiện duyệt. Vui lòng sửa các mục dưới đây.'}</Notice>{list(validation.errors).length > 0 && <ul className="exam-validation-errors" role="alert">{validation.errors.map((issue, index) => <li key={index}>{issue.questionNumber ? `Câu ${issue.questionNumber}: ` : ''}{messageText(issue)}</li>)}</ul>}{list(validation.warnings).length > 0 && <ul className="exam-validation-warnings">{validation.warnings.map((issue, index) => <li key={index}>{messageText(issue)}</li>)}</ul>}</>}{!questions.length ? <p>Đề chưa có câu hỏi.</p> : <ol className="exam-preview-questions">{questions.map((question, index) => <li key={question.id || index}><div className="question-item-heading"><strong>Câu {index + 1}</strong><span>{TYPE_NAMES[question.type]} · {questionTopicLabel(question)} · {question.points} điểm</span></div><p className="exam-plain">{question.content || 'Chưa có nội dung'}</p><ul className="exam-preview-options">{list(question.options).map(option => <li key={option.key} className={option.key === question.correctAnswer ? 'correct-answer' : ''}><strong>{option.key === 'True' ? 'Đúng' : option.key === 'False' ? 'Sai' : option.key}.</strong> {option.text || 'Chưa nhập phương án'}</li>)}</ul><p className="exam-preview-answer"><strong>Đáp án đúng:</strong> {question.correctAnswer ? question.correctAnswer === 'True' ? 'Đúng' : question.correctAnswer === 'False' ? 'Sai' : question.correctAnswer : 'Chưa chọn đáp án'}</p>{question.explanation && <p className="exam-plain"><strong>Giải thích:</strong> {question.explanation}</p>}{question.source && <p className="exam-plain"><strong>Nguồn đối chiếu:</strong> {question.source}</p>}{question.requiresSourceReview && <p className={question.sourceReviewed ? 'exam-reviewed' : 'exam-warning-text'}>{question.sourceReviewed ? 'Đã đối chiếu nguồn' : 'Chưa đối chiếu nguồn'}</p>}</li>)}</ol>}</div></section></div>;
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
  return <div className="exam-import"><div className="exam-section-heading"><div><h3>Nhập câu hỏi từ Excel</h3><p>Tải mẫu và điền sheet <strong>CauHoi</strong>. Sheet hướng dẫn và ví dụ minh họa không được nhập vào đề.</p></div><button className="button button-secondary" disabled={Boolean(busy) || disabled} onClick={download}>{busy === 'download' ? 'Đang tải...' : 'Tải mẫu Excel'}</button></div><Notice>{error}</Notice><div className="field"><label htmlFor="exam-import-file">Tệp câu hỏi (.xlsx, tối đa 5 MB và 500 dòng)</label><input id="exam-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy) || disabled} onChange={event => choose(event.target.files?.[0])} /></div><div className="exam-actions"><button className="button button-secondary" disabled={!file || Boolean(busy) || disabled} onClick={() => upload(false)}>{busy === 'preview' ? 'Đang đọc dữ liệu...' : 'Xem trước dữ liệu Excel'}</button>{preview && <button className="button button-primary" disabled={!preview.canImport || Boolean(busy) || disabled} onClick={() => upload(true)}>{busy === 'commit' ? 'Đang nhập...' : `Nhập ${preview.validRows ?? preview.totalRows} câu hỏi`}</button>}</div>{preview && <div className="exam-import-preview"><h4>Xem trước dữ liệu Excel</h4><p>{preview.totalRows} dòng dữ liệu · {preview.validRows} dòng hợp lệ. {preview.canImport ? 'Có thể nhập toàn bộ dữ liệu.' : 'Sửa các dòng báo lỗi trong Excel rồi tải lại tệp.'}</p>{list(preview.errors).length > 0 && <ul className="exam-validation-errors">{preview.errors.map((issue, index) => <li key={index}>{messageText(issue)}</li>)}</ul>}<div className="exam-import-rows">{list(preview.rows).map((row, index) => <article key={row.rowNumber || index} className={list(row.errors).length ? 'has-errors' : ''}><div className="question-item-heading"><strong>Dòng {row.rowNumber}</strong><span>{list(row.errors).length ? 'Cần sửa' : 'Hợp lệ'}</span></div><p className="exam-plain">{row.question?.content || row.content || 'Chưa có nội dung'}</p>{row.question && <small>{TYPE_NAMES[row.question.type]} · {questionTopicLabel(row.question)} · {row.question.points} điểm · Đáp án: {row.question.correctAnswer || 'Chưa chọn'}</small>}{list(row.errors).length > 0 && <ul className="exam-validation-errors">{row.errors.map((issue, item) => <li key={item}>{messageText(issue)}</li>)}</ul>}{list(row.warnings).length > 0 && <ul className="exam-validation-warnings">{row.warnings.map((issue, item) => <li key={item}>{messageText(issue)}</li>)}</ul>}</article>)}</div></div>}</div>;
}

function utcToLocalInput(value) {
  if (!value) return '';
  const formatted = formatVietnamDateTime(value);
  return formatted === '—' ? '' : formatted.slice(0, 16);
}

function Schedule({ base, navigate }) {
  const [revision, setRevision] = useState(0);
  const schedule = useResource(`${base}/schedule`, revision);
  const exams = useResource(`${base}/exams`);
  const [fields, setFields] = useState({ durationMinutes: 30, opensAtLocal: '', startDeadlineLocal: '', closesAtLocal: '' });
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [warnings, setWarnings] = useState([]); const [busy, setBusy] = useState(false); const [hasSavedSchedule, setHasSavedSchedule] = useState(false); const operation = useRef(false);
  useEffect(() => {
    if (schedule.data) { const value = schedule.data; setFields({ durationMinutes: value.durationMinutes ?? 30, opensAtLocal: value.opensAtLocal || utcToLocalInput(value.opensAtUtc), startDeadlineLocal: value.startDeadlineLocal || utcToLocalInput(value.startDeadlineUtc), closesAtLocal: value.closesAtLocal || utcToLocalInput(value.closesAtUtc) }); setWarnings(list(value.warnings)); setHasSavedSchedule(Boolean(value.opensAtUtc&&value.startDeadlineUtc&&value.closesAtUtc)); }
  }, [schedule.data]);
  function change(key, value) { setFields(current => ({ ...current, [key]: value })); setHasSavedSchedule(false); setNotice(''); setError(''); setWarnings([]); }
  const opensAtIso = parseVietnamDateTimeInput(fields.opensAtLocal);
  const startDeadlineIso = parseVietnamDateTimeInput(fields.startDeadlineLocal);
  const closesAtIso = parseVietnamDateTimeInput(fields.closesAtLocal);
  const available = startDeadlineIso && closesAtIso ? (Date.parse(`${closesAtIso}+07:00`) - Date.parse(`${startDeadlineIso}+07:00`)) / 60000 : null;
  const lateExams = available !== null && available >= 0 && Number(fields.durationMinutes) > available ? [{ id: 'competition-duration', name: 'Thoi luong chung cua cuoc thi', durationMinutes: Number(fields.durationMinutes) }] : [];
  async function save(event) {
    event.preventDefault(); if (operation.current) return;
    if (!Number.isInteger(Number(fields.durationMinutes)) || Number(fields.durationMinutes) < 1 || Number(fields.durationMinutes) > 480) { setError('Thoi luong lam bai phai tu 1 den 480 phut.'); return; }
    if (!fields.opensAtLocal || !fields.startDeadlineLocal || !fields.closesAtLocal) { setError('Vui lòng nhập đủ ngày và giờ mở thi, hạn bắt đầu và ngày giờ đóng thi.'); return; }
    if (!opensAtIso || !startDeadlineIso || !closesAtIso) { setError('Vui lòng nhập ngày giờ hợp lệ theo dạng dd/MM/yyyy HH:mm.'); return; }
    if (closesAtIso <= opensAtIso) { setError('Ngày và giờ đóng thi phải sau ngày và giờ mở thi.'); return; }
    if (startDeadlineIso <= opensAtIso || startDeadlineIso > closesAtIso) { setError('Hạn bắt đầu phải sau giờ mở thi và không được sau giờ đóng thi.'); return; }
    operation.current = true; setBusy(true); setError(''); setNotice('');
    try { const { data } = await api.put(`${base}/schedule`, fields); setWarnings(list(data.warnings)); setHasSavedSchedule(true); setNotice('Đã lưu lịch thi theo giờ Việt Nam.'); setRevision(value => value + 1); navigate(`${ROOT}/${base.split('/').pop()}/phan-cong`); }
    catch (e) { setError(errorText(e)); } finally { operation.current = false; setBusy(false); }
  }
  if (schedule.loading && !schedule.data) return <Loading />;
  return <div className="exam-schedule-layout"><section className="panel exam-section"><div className="exam-section-heading"><div><h2>Bước 1 · Lịch thi</h2><p>C&#7845;u h&#236;nh th&#7901;i l&#432;&#7907;ng l&#224;m b&#224;i chung v&#224; c&#225;c m&#7889;c m&#7903;, &#273;&#243;ng thi cho cu&#7897;c thi.</p></div></div><form className="exam-form schedule-form" onSubmit={save} noValidate><Notice>{error || schedule.error}</Notice><Notice kind="success">{notice}</Notice><Notice kind="info">Nhập giờ Việt Nam theo dạng <strong>dd/MM/yyyy HH:mm</strong> (Asia/Ho_Chi_Minh, UTC+7), kể cả khi thiết bị đang ở múi giờ khác. Th&#7901;i l&#432;&#7907;ng ph&#250;t &#273;&#432;&#7907;c &#225;p d&#7909;ng cho m&#7885;i &#273;&#7873;; k&#7871;t qu&#7843; &#432;u ti&#234;n s&#7889; c&#226;u &#273;&#250;ng, sau &#273;&#243; l&#224; th&#7901;i gian ho&#224;n th&#224;nh.</Notice><div className="field"><label htmlFor="schedule-duration">Th&#7901;i l&#432;&#7907;ng l&#224;m b&#224;i m&#7895;i l&#432;&#7907;t (ph&#250;t)</label><input id="schedule-duration" type="number" min="1" max="480" step="1" required value={fields.durationMinutes} onChange={event=>change("durationMinutes",Number(event.target.value))} disabled={busy}/><p className="exam-hint">&#193;p d&#7909;ng th&#7889;ng nh&#7845;t cho t&#7845;t c&#7843; &#273;&#7873; trong cu&#7897;c thi; l&#432;&#7907;t thi k&#7871;t th&#250;c khi h&#7871;t gi&#7901; &#273;&#243;ng thi.</p></div><div className="field"><label htmlFor="schedule-opens">Ngày và giờ mở thi</label><DateTimePicker id="schedule-opens" label="Ngày và giờ mở thi" required value={fields.opensAtLocal} onChange={value => change('opensAtLocal', value)} disabled={busy} /></div><div className="field"><label htmlFor="schedule-start-deadline">Hạn bắt đầu</label><DateTimePicker id="schedule-start-deadline" label="Hạn bắt đầu" required value={fields.startDeadlineLocal} onChange={value => change('startDeadlineLocal', value)} disabled={busy} /><p className="exam-hint">Sau mốc này, thí sinh không được bắt đầu bài mới.</p></div><div className="field"><label htmlFor="schedule-closes">Ngày và giờ đóng thi</label><DateTimePicker id="schedule-closes" label="Ngày và giờ đóng thi" required value={fields.closesAtLocal} onChange={value => change('closesAtLocal', value)} disabled={busy} /><p className="exam-hint">Thời gian làm bài thực tế không vượt quá mốc đóng thi.</p></div>{lateExams.length > 0 && <Notice kind="warning"><div><strong>Người bắt đầu sát hạn có thể nhận ít thời gian hơn thời lượng đã đặt.</strong><ul>{lateExams.map(exam => <li key={exam.id}>{exam.name}: đặt {exam.durationMinutes} phút, nhưng bắt đầu sát hạn chỉ còn khoảng {Math.max(0, available)} phút trước khi đóng thi.</li>)}</ul></div></Notice>}{warnings.length > 0 && <div className="exam-schedule-warnings"><h3>Lưu ý về thời gian làm bài</h3><ul>{warnings.map((warning, index) => <li key={index}>{messageText(warning)}</li>)}</ul></div>}<div className="exam-actions"><button type="submit" className="button button-primary" disabled={busy || Boolean(schedule.error)}>{busy ? 'Đang lưu...' : 'Lưu lịch thi'}</button></div></form></section><aside className="exam-schedule-guide"><h3>Ba mốc cần thống nhất</h3><ol><li><strong>Mở thi</strong><span>Bắt đầu cho phép vào làm bài.</span></li><li><strong>Hạn bắt đầu</strong><span>Thời điểm cuối được bắt đầu bài mới.</span></li><li><strong>Đóng thi</strong><span>Mọi bài làm đều chịu giới hạn giờ đóng thi.</span></li></ol><p>Thời gian phải theo thứ tự: mở thi &lt; hạn bắt đầu ≤ đóng thi. Hệ thống kiểm tra lại các mốc trên máy chủ trước khi lưu.</p></aside></div>;
}
