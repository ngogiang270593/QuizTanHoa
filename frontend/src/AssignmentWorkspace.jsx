import CandidatePortal,{CandidateFlowProgress} from './CandidatePortal.jsx';
import {useAccess} from './AccessContext.jsx';
import { useEffect, useRef, useState } from 'react';
import { api, isConnectionError } from './api.js';
import './AssignmentWorkspace.css';
import './AssignmentResults.css';
import CandidateAttempt from './CandidateAttempt.jsx';
import { useAttemptTab } from './attemptTab.js';
import { formatVietnamDateTime } from './dateTime.js';

const ADMIN_ROOT = '/ban-to-chuc/cuoc-thi';
const CANDIDATE_ROOT = '/thi-sinh/cuoc-thi';
const STATUS_NAMES = { Draft: 'Nháp', Published: 'Đã công bố', Ended: 'Đã kết thúc' };
const ATTEMPT_NAMES = { NotStarted: 'Chưa bắt đầu', InProgress: 'Đang làm bài', Submitted: 'Đã nộp bài', Expired: 'Đã hết thời gian' };
const asList = value => Array.isArray(value) ? value : [];
const AWARD_ICON_ASSETS={first:'/awards/giai-nhat.png',second:'/awards/giai-nhi.png',third:'/awards/giai-ba.png'};
function AwardIcon({icon,className}) { const src=AWARD_ICON_ASSETS[icon];return src?<img className={className||'award-icon-image'} src={src} alt="" aria-hidden="true"/>:<span className={className} aria-hidden="true">🏆</span>; }
const issueText = value => typeof value === 'string' ? value : value?.message || '';
const elapsedTime = value => {
  if (value == null) return '—';
  const totalSeconds = Math.floor(value / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
};

function errorText(error, fallback = 'Chưa thực hiện được thao tác. Vui lòng thử lại.') {
  if (isConnectionError(error)) return 'Không thể kết nối máy chủ. Lựa chọn của bạn vẫn được giữ lại; vui lòng thử lại.';
  const data = error.response?.data;
  const details = Array.isArray(data?.errors) ? data.errors.map(issueText) : data?.errors && typeof data.errors === 'object' ? Object.values(data.errors).flat().map(issueText) : [];
  return details.filter(Boolean).join(' ') || data?.message || (error.response?.status === 403 ? 'Bạn không có quyền thực hiện thao tác này.' : fallback);
}

function Notice({ children, kind = 'error' }) {
  return children ? <div className={`notice assignment-notice assignment-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div> : null;
}

function Loading() {
  return <div className="assignment-loading" role="status"><span className="loading-spinner" aria-hidden="true" />Đang tải dữ liệu...</div>;
}

function DateText({ value }) {
  if (!value) return <>Chưa cấu hình</>;
  return <>{formatVietnamDateTime(value)}</>;
}

function useData(url, revision = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: '', status: 0 });
  useEffect(() => {
    const controller = new AbortController();
    setState(current => ({ ...current, loading: true, error: '', status: 0 }));
    api.get(url, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: '', status: 200 });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ data: null, loading: false, error: errorText(error), status: error.response?.status || 0 });
    });
    return () => controller.abort();
  }, [url, revision]);
  return state;
}

function LocalLink({ to, navigate, children, className = '' }) {
  return <a href={to} className={className} onClick={event => {
    if (!navigate || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); navigate(to);
  }}>{children}</a>;
}

export function CompetitionPublication({ competitionId, revision = 0, onPublished }) {
  const base = `/organizer/competitions/${competitionId}`;
  const [attempt, setAttempt] = useState(0);
  const publication = useData(`${base}/publication`, `${revision}-${attempt}`);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  async function publish() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`${base}/publish`, undefined, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setNotice('Đã công khai cuộc thi. Thí sinh được phân đề có thể xem cuộc thi trong tài khoản của mình.');
      setAttempt(value => value + 1);
      onPublished?.('Published');
    } catch (failure) {
      if (!controller.signal.aborted) { setError(errorText(failure, 'Chưa thể công khai cuộc thi. Vui lòng kiểm tra các điều kiện bên dưới.')); setAttempt(value => value + 1); }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (request.current === controller) request.current = null;
    }
  }
  const state = publication.data;
  const published = state?.status === 'Published';
  const ended = state?.status === 'Ended';
  return <section className="panel assignment-publication" aria-label="Công khai cuộc thi">
    <div className="assignment-section-heading"><div><span className="eyebrow">CÔNG BỐ CUỘC THI</span><h2>{published ? 'Cuộc thi đã công bố' : ended ? 'Cuộc thi đã kết thúc' : 'Sẵn sàng cho thí sinh'}</h2><p>Cuộc thi chỉ hiển thị cho tài khoản đã được phân đề sau khi công bố.</p></div><button className="button button-primary" type="button" onClick={publish} disabled={busy || publication.loading || !state || published || ended}>{busy ? 'Đang công bố...' : published ? 'Đã công bố' : ended ? 'Đã kết thúc' : 'Công khai cuộc thi'}</button></div>
    <Notice>{error || publication.error}</Notice><Notice kind="success">{notice}</Notice>
    {publication.loading && !state ? <Loading /> : state && <><div className="assignment-publication-stats"><span className={`competition-status competition-status-${state.status?.toLowerCase()}`}>{STATUS_NAMES[state.status] || state.status}</span><span>{state.approvedExamCount ?? 0} đề đã duyệt</span><span>{state.assignmentCount ?? 0} thí sinh đã phân công</span>{state.publishedAtUtc && <span>Công bố: <DateText value={state.publishedAtUtc} /></span>}</div>{!published && !ended && <>{state.canPublish ? <Notice kind="success">Đã có lịch hợp lệ, đề đã duyệt và thí sinh được phân đề. Có thể công khai cuộc thi.</Notice> : <div className="assignment-publication-checks"><strong>Cần hoàn tất trước khi công bố:</strong><ul>{asList(state.errors).map((issue, index) => <li key={index}>{issueText(issue)}</li>)}</ul></div>}</>}</>}
  </section>;
}

export default function AssignmentWorkspace({ competitionId, navigate }) {
  const base = `/organizer/competitions/${competitionId}`;
  const [revision, setRevision] = useState(0);
  const options = useData(`${base}/assignment-options`, revision);
  const assigned = useData(`${base}/assignments`, revision);
  const [selected, setSelected] = useState([]);
  const [examId, setExamId] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [editExam, setEditExam] = useState('');
  const [revoking, setRevoking] = useState(null);
  const [resultsRevision, setResultsRevision] = useState(0);
  const [sessionAction, setSessionAction] = useState(null);
  const [sessionReason, setSessionReason] = useState('');
  const [allowRetake, setAllowRetake] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  const accounts = asList(options.data?.accounts);
  const exams = asList(options.data?.approvedExams);
  const assignments = asList(assigned.data);
  const assignedIds = new Set(assignments.map(row => row.userId));
  useEffect(() => {
    if (exams.length && !exams.some(exam => String(exam.id) === String(examId))) setExamId(String(exams[0].id));
    else if (!exams.length) setExamId('');
  }, [options.data]);
  useEffect(() => {
    if (assigned.data) setSelected(current => current.filter(id => !assignedIds.has(id)));
  }, [assigned.data]);
  function toggle(id) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); setError(''); setNotice(''); }
  async function run(name, action) {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(name); setError(''); setNotice('');
    try { await action(controller.signal); if (!controller.signal.aborted) { setRevision(value => value + 1); setResultsRevision(value => value + 1); } }
    catch (failure) { if (!controller.signal.aborted) setError(errorText(failure)); }
    finally { if (!controller.signal.aborted) setBusy(''); if (request.current === controller) request.current = null; }
  }
  async function assign(event) {
    event.preventDefault();
    if (!selected.length || !examId) { setError('Vui lòng chọn ít nhất một tài khoản và một đề thi.'); return; }
    await run('assign', async signal => {
      await api.post(`${base}/assignments`, { userIds: selected, examId: Number(examId) }, { signal });
      if (!signal.aborted) { setNotice(`Đã phân đề cho ${selected.length} tài khoản.`); setSelected([]); navigate(`/ban-to-chuc/cuoc-thi/${competitionId}/trinh-duyet`); }
    });
  }
  async function saveChange(row) {
    if (!editExam) { setError('Vui lòng chọn đề nháp hoặc đã duyệt để thay đổi phân công.'); return; }
    await run(`edit-${row.userId}`, async signal => {
      await api.put(`${base}/assignments/${row.userId}`, { examId: Number(editExam) }, { signal });
      if (!signal.aborted) { setEditing(null); setNotice('Đã cập nhật đề được phân công.'); }
    });
  }
  async function revoke(row) {
    await run(`revoke-${row.userId}`, async signal => {
      await api.delete(`${base}/assignments/${row.userId}`, { signal });
      if (!signal.aborted) { setRevoking(null); setNotice('Đã thu hồi phân công trước khi thí sinh bắt đầu.'); }
    });
  }
  async function transferSession(row) {
    if (!sessionReason.trim()) { setError('Vui lòng ghi lý do xác minh và chuyển phiên.'); return; }
    const retake = allowRetake;
    if (!window.confirm(retake
      ? 'Lượt hiện tại sẽ bị đánh dấu không tính kết quả và máy chủ cấp một lượt mới. Chỉ xác nhận nếu thể lệ cho phép thi lại.'
      : 'Quyền làm bài sẽ chuyển sang phiên đăng nhập mới nhất đang hoạt động của thí sinh. Phiên hiện tại mất quyền ngay.')) return;
    await run(`transfer-${row.userId}`, async signal => {
      const { data } = await api.post(`${base}/assignments/${row.userId}/attempt-session`, {
        reason: sessionReason.trim(),
        allowRetake: retake,
      }, { signal });
      if (!signal.aborted) {
        setSessionAction(null);
        setSessionReason('');
        setAllowRetake(false);
        setNotice(data.message);
      }
    });
  }
  const matches = accounts.filter(account => `${account.fullName} ${account.username} ${account.department || ''}`.toLocaleLowerCase('vi-VN').includes(query.toLocaleLowerCase('vi-VN').trim()));
  const loading = options.loading || assigned.loading;
  return <div className="assignment-workspace">
    <Notice>{error || options.error || assigned.error}</Notice><Notice kind="success">{notice}</Notice>
    <section className="panel assignment-section"><div className="assignment-section-heading"><div><span className="eyebrow">BƯỚC 2</span><h2>Phân công dự thi</h2><p>Chọn thí sinh và gán đề nháp hoặc đã duyệt. Đề nháp sẽ được gắn phiên bản sau khi duyệt.</p></div><span className="badge-neutral">{assignments.length} phân công</span></div>
      {loading && !options.data ? <Loading /> : <form className="assignment-form" onSubmit={assign}>
        <div className="field"><label htmlFor="assignment-exam">Đề được phân công</label><select id="assignment-exam" value={examId} onChange={event => { setExamId(event.target.value); setError(''); }} disabled={Boolean(busy) || !exams.length}><option value="">Chọn đề thi</option>{exams.map(exam => <option value={exam.id} key={exam.id}>{exam.name} · {exam.isApproved ? `đã duyệt, phiên bản ${exam.versionNumber}` : 'đề nháp, sẽ gắn phiên bản khi được duyệt'}{exam.isDemo ? ' · Minh họa' : ''}</option>)}</select>{!exams.length && <p className="assignment-hint">Chưa có đề nháp hoặc đã duyệt để phân công.</p>}</div>
        <div className="assignment-picker-heading"><label htmlFor="assignment-search">Tài khoản thí sinh đang hoạt động</label><span>{selected.length} đã chọn</span></div><input id="assignment-search" className="assignment-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm theo họ tên, tên đăng nhập hoặc bộ phận" disabled={Boolean(busy)} />
        <div className="assignment-account-picker" role="group" aria-label="Chọn thí sinh">{!accounts.length ? <p className="assignment-empty">Chưa có tài khoản thí sinh đang hoạt động.</p> : !matches.length ? <p className="assignment-empty">Không tìm thấy tài khoản phù hợp.</p> : matches.map(account => <label key={account.id} className={`assignment-account-choice ${assignedIds.has(account.id) ? 'already-assigned' : ''}`}><input id={`assignment-user-${account.id}`} type="checkbox" checked={selected.includes(account.id)} disabled={Boolean(busy) || loading || assignedIds.has(account.id)} onChange={() => toggle(account.id)} /><span><strong>{account.fullName || account.username}</strong><small>@{account.username} · {account.department || 'Chưa cập nhật bộ phận'}</small>{account.isDemo && <span className="demo-label">Tài khoản minh họa</span>}</span>{assignedIds.has(account.id) && <em>Đã phân công</em>}</label>)}</div>
        <p className="assignment-hint">Trước khi trình duyệt cần có lịch thi và ít nhất một phân công. Mỗi tài khoản chỉ có một phân công trong cuộc thi này. Tài khoản vẫn có thể được phân vào các cuộc thi khác.</p>{!exams.length&&<a className="button button-secondary" href={`/ban-to-chuc/cuoc-thi/${competitionId}/de-thi`} onClick={event=>{event.preventDefault();navigate(`/ban-to-chuc/cuoc-thi/${competitionId}/de-thi`);}}>Chưa có đề thi? Tạo đề trước</a>}<button className="button button-primary" type="submit" disabled={Boolean(busy) || loading || Boolean(options.error || assigned.error) || !exams.length}>{busy === 'assign' ? 'Đang phân công...' : 'Phân công dự thi'}</button>
      </form>}
    </section>
    <div className="exam-actions"><button type="button" className="button button-secondary" onClick={()=>navigate(`/ban-to-chuc/cuoc-thi/${competitionId}/lich-thi`)}>Quay lại: Lịch thi</button>{assignments.length>0&&<button type="button" className="button button-secondary" disabled={loading} onClick={()=>navigate(`/ban-to-chuc/cuoc-thi/${competitionId}/trinh-duyet`)}>Tiếp tục: Cơ cấu giải</button>}</div>
    <section className="panel assignment-section"><div className="assignment-section-heading"><div><h2>Danh sách phân công</h2><p>Có thể đổi đề hoặc thu hồi trước khi thí sinh bắt đầu làm bài.</p></div></div>
      {assigned.loading && !assigned.data ? <Loading /> : !assignments.length ? <div className="assignment-empty"><strong>Chưa có phân công dự thi</strong><p>Chọn tài khoản và đề đã duyệt ở biểu mẫu phía trên.</p></div> : <div className="assignment-list" data-testid="assignment-list">{assignments.map(row => <article className="assignment-row" key={row.userId} data-user-id={row.userId}>
        <div className="assignment-person"><h3>{row.fullName || row.username}</h3><p>@{row.username}</p><span className="assignment-department">{row.department || 'Chưa cập nhật bộ phận'}</span>{row.isDemo && <span className="demo-label">Minh họa</span>}{row.isActive === false && <span className="assignment-inactive">Tài khoản đã khóa</span>}</div>
        <div className="assignment-exam-summary"><span className="assignment-label">ĐỀ ĐƯỢC GÁN</span><strong>{row.examName || 'Chưa được gán đề hợp lệ'}</strong>{row.awaitingApproval ? <small>Đề nháp · chưa có phiên bản được duyệt</small> : row.versionNumber && <small>Phiên bản đã duyệt {row.versionNumber}</small>}<span className={`assignment-attempt assignment-attempt-${row.attemptStatus?.toLowerCase()}`}>{row.attemptStatusLabel || ATTEMPT_NAMES[row.attemptStatus] || 'Chưa bắt đầu'}</span></div>
        <div className="assignment-row-actions">{editing === row.userId ? <><label className="visually-hidden" htmlFor={`assignment-edit-exam-${row.userId}`}>Đổi đề cho {row.fullName || row.username}</label><select id={`assignment-edit-exam-${row.userId}`} value={editExam} onChange={event => setEditExam(event.target.value)} disabled={Boolean(busy)}><option value="">Chọn đề đã duyệt</option>{exams.map(exam => <option key={exam.id} value={exam.id}>{exam.name} · phiên bản {exam.versionNumber}</option>)}</select><div className="assignment-actions"><button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => saveChange(row)}>Lưu phân công</button><button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => setEditing(null)}>Hủy đổi đề</button></div></> : revoking === row.userId ? <><p>Thu hồi phân công của tài khoản này?</p><div className="assignment-actions"><button type="button" className="button assignment-button-danger" disabled={Boolean(busy)} onClick={() => revoke(row)}>Xác nhận thu hồi</button><button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => setRevoking(null)}>Hủy thu hồi</button></div></> : <><div className="assignment-actions"><button type="button" className="button button-secondary" disabled={Boolean(busy) || !row.canChange || !exams.length} onClick={() => { setEditing(row.userId); setEditExam(exams.some(exam => exam.id === row.examId) ? String(row.examId) : ''); setRevoking(null); setNotice(''); setError(''); }}>Đổi đề</button><button type="button" className="button button-quiet" disabled={Boolean(busy) || !row.canChange} onClick={() => { setRevoking(row.userId); setEditing(null); setNotice(''); setError(''); }}>Thu hồi</button></div>{!row.canChange && <small className="assignment-locked">Đã bắt đầu làm bài hoặc cuộc thi đã kết thúc; không thể đổi hay thu hồi.</small>}</>}
          {row.attemptStatus !== 'NotStarted' && <div className="assignment-session-actions">
            {sessionAction === row.userId ? <><p>Máy chủ chuyển sang phiên đăng nhập mới nhất đang hoạt động của thí sinh. Ghi lý do; phiên cũ sẽ mất quyền ngay.</p><label htmlFor={`session-reason-${row.userId}`}>Lý do xác minh và chuyển phiên</label><textarea id={`session-reason-${row.userId}`} rows="3" maxLength="1000" value={sessionReason} onChange={event => setSessionReason(event.target.value)} disabled={Boolean(busy)} /><label className="assignment-retake-choice"><input type="checkbox" checked={allowRetake} onChange={event => setAllowRetake(event.target.checked)} disabled={Boolean(busy)} />Cấp lượt thay thế, đánh dấu lượt cũ không tính kết quả (chỉ khi thể lệ cho phép thi lại)</label><div className="assignment-actions"><button type="button" className="button assignment-button-danger" disabled={Boolean(busy) || !sessionReason.trim()} onClick={() => transferSession(row)}>{busy === `transfer-${row.userId}` ? 'Đang chuyển...' : allowRetake ? 'Xác nhận cấp lượt mới' : 'Xác nhận chuyển phiên'}</button><button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => { setSessionAction(null); setSessionReason(''); setAllowRetake(false); }}>Hủy</button></div></> : <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => { setSessionAction(row.userId); setSessionReason(''); setAllowRetake(false); setEditing(null); setRevoking(null); setNotice(''); setError(''); }}>Chuyển phiên / xử lý sự cố</button>}
          </div>}
        </div>
      </article>)}</div>}
    </section>
    <CompetitionPublication competitionId={competitionId} revision={revision} />
    <CompetitionResultsPanel competitionId={competitionId} revision={resultsRevision} />
  </div>;
}

function CompetitionResultsPanel({ competitionId, revision }) {
  const {can}=useAccess();
  const base = `/organizer/competitions/${competitionId}/results`;
  const [rankingGroup, setRankingGroup] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const query = rankingGroup ? `?rankingGroupName=${encodeURIComponent(rankingGroup)}` : '';
  const results = useData(`${base}${query}`, revision);
  const rows = asList(results.data?.rows);
  async function exportExcel() {
    if (busy) return;
    setBusy('export'); setError('');
    try {
      const { data } = await api.get(`${base}/excel${query}`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `KetQua_${rankingGroup || 'TatCaNhom'}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(errorText(failure, 'Không thể xuất tệp kết quả.')); }
    finally { setBusy(''); }
  }
  const score = value => value == null ? '—' : new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
  const status = { Submitted: 'Đã nộp', Invalidated: 'Đã loại', InProgress: 'Đang làm', Expired: 'Hết hạn', NotStarted: 'Chưa bắt đầu' };
  return <section className="panel assignment-section assignment-results" aria-label="Kết quả và xếp hạng">
    <div className="assignment-section-heading"><div><h2>Kết quả và xếp hạng</h2><p>X&#7871;p theo s&#7889; c&#226;u &#273;&#250;ng cao nh&#7845;t, r&#7891;i th&#7901;i gian nhanh nh&#7845;t. Ch&#7881; c&#7847;n r&#224; so&#225;t &#273;&#7891;ng h&#7841;ng n&#7871;u n&#243; &#7843;nh h&#432;&#7903;ng &#273;&#7871;n su&#7845;t gi&#7843;i.</p></div>{can('operate')&&<button className="button button-secondary" type="button" onClick={exportExcel} disabled={Boolean(busy) || results.loading || !results.data}>{busy === 'export' ? 'Đang xuất...' : 'Xuất Excel'}</button>}</div>
    <Notice>{error || results.error}</Notice>
    {results.loading && !results.data ? <Loading /> : results.data && <>
      <label className="assignment-results-filter">Nhóm đề / nhóm xếp hạng
        <select value={rankingGroup} onChange={event => setRankingGroup(event.target.value)} disabled={Boolean(busy)}>
          <option value="">Tất cả nhóm đề</option>
          {asList(results.data.rankingGroups).map(name => <option value={name} key={name}>{name}</option>)}
        </select>
      </label>
      <p className="assignment-hint">Nếu số câu đúng và thời gian làm bài bằng nhau, thí sinh đồng hạng. Điểm vẫn được hiển thị để Ban Tổ chức đối chiếu; câu đúng được chấm theo snapshot đề đã phát.</p>
      {!rows.length ? <div className="assignment-empty">Chưa có lượt thi hoặc phân công trong nhóm này.</div> : <div className="assignment-results-wrap"><table className="assignment-results-table" data-testid="competition-results">
        <thead><tr><th>H&#7841;ng</th><th>Giải</th><th>M&#227; th&#237; sinh</th><th>H&#7885; t&#234;n</th><th>B&#7897; ph&#7853;n</th><th>Nh&#243;m &#273;&#7873;</th><th>S&#7889; c&#226;u &#273;&#250;ng</th><th>Th&#7901;i gian</th><th>Tr&#7841;ng th&#225;i</th><th>H&#7907;p l&#7879;</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={row.attemptId ?? `assignment-${row.candidateCode}-${index}`}><td>{row.rank ?? "-"}</td><td>{row.awardName ? <><AwardIcon icon={row.awardIcon}/> {row.awardName}</> : '—'}</td><td>{row.candidateCode}</td><td>{row.fullName}</td><td>{row.department || "-"}</td><td>{row.fieldGroupName || "-"}</td><td>{row.correctAnswersCount ?? "-"}</td><td>{elapsedTime(row.durationMilliseconds)}</td><td>{status[row.attemptStatus] || row.attemptStatus}</td><td>{row.isValid ? "OK" : "-"}</td></tr>)}</tbody>
      </table></div>}
    </>}
  </section>;
}

export function AwardReviewWorkspace({ competitionId }) {
  const {can}=useAccess();
  const base = `/organizer/competitions/${competitionId}/awards`;
  const [revision, setRevision] = useState(0);
  const resource = useData(base, revision);
  const awardCatalog = useData('/organizer/award-catalog',revision);
  const [categories, setCategories] = useState([]);
  const [newGroup, setNewGroup] = useState('');
  const [newAwardName, setNewAwardName] = useState('');
  const [newQuantity, setNewQuantity] = useState('1');
  const [selected, setSelected] = useState({});
  const [proposalRows, setProposalRows] = useState([]);
  const [individualScoresPublished, setIndividualScoresPublished] = useState(false);
  const [tieReviewConfirmed, setTieReviewConfirmed] = useState(false);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [approvalReason, setApprovalReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const state = resource.data;
  const locked = !can('operate') || state?.status === 'Published' || state?.competitionStatus === 'Ended';
  const resultRows = asList(state?.results);
  const awardNames = groupName => categories.filter(item => item.rankingGroupName === groupName);
  useEffect(() => {
    if (!state) return;
    setCategories(asList(state.categories));
    setProposalRows(asList(state.proposedNominees));
    setSelected(Object.fromEntries(asList(state.nominees).map(item => [item.attemptId, {
      attemptId: item.attemptId, awardName: item.awardName, awardIcon:item.awardIcon||'trophy', rankingGroupName: item.rankingGroupName,
    }])));
    setIndividualScoresPublished(Boolean(state.individualScoresPublished));
    setTieReviewConfirmed(Boolean(state.tieReviewConfirmed));
    setAdjustmentReason(state.adjustmentReason || '');
  }, [state?.revision]);

  function addCategory(event) {
    event.preventDefault();
    const preset=asList(awardCatalog.data).find(icon=>icon.name===newAwardName);
    if (!newGroup || !preset || !Number(newQuantity)) return;
    setCategories(current => [...current, { rankingGroupName: newGroup, awardName: preset.name, icon:preset.key, quantity: Number(newQuantity) }]);
    setNewAwardName('');
    setNewQuantity('1');
  }

  async function run(name, action) {
    if (busy) return;
    setBusy(name); setError(''); setNotice('');
    try { await action(); }
    catch (failure) { setError(errorText(failure)); }
    finally { setBusy(''); }
  }

  async function generateProposal() {
    if (!categories.length) { setError('Hãy cấu hình ít nhất một hạng giải trước khi lập danh sách.'); return; }
    await run('proposal', async () => {
      const { data } = await api.post(`${base}/proposal`, { categories });
      setProposalRows(asList(data.nominees));
      setSelected(Object.fromEntries(asList(data.nominees).map(item => [item.attemptId, {
        attemptId: item.attemptId, awardName: item.awardName, awardIcon:item.awardIcon||'trophy', rankingGroupName: item.rankingGroupName,
      }])));
      setTieReviewConfirmed(false);
      setNotice(`Đã lập danh sách dự kiến gồm ${asList(data.nominees).length} lượt thi.`);
    });
  }

  async function saveDraft() {
    await run('save', async () => {
      const nominees = Object.values(selected).filter(item => item.awardName);
      await api.put(`${base}/draft`, {
        revision: state?.revision || 0,
        individualScoresPublished,
        tieReviewConfirmed,
        categories,
        nominees,
        adjustmentReason: adjustmentReason.trim() || null,
      });
      setNotice('Đã lưu danh sách dự kiến.');
      setRevision(value => value + 1);
    });
  }

  async function approve() {
    await run('approve', async () => {
      await api.post(`${base}/approve`, { revision: state.revision, reason: approvalReason.trim() || null });
      setNotice('Đã ghi nhận người duyệt và thời điểm duyệt.');
      setRevision(value => value + 1);
    });
  }

  async function publish() {
    if (!window.confirm('Công bố danh sách đạt giải đã duyệt cho thí sinh?')) return;
    await run('publish', async () => {
      await api.post(`${base}/publish`);
      setNotice('Đã công bố danh sách đạt giải.');
      setRevision(value => value + 1);
    });
  }

  async function endCompetition() {
    if (!window.confirm('Kết thúc cuộc thi? Thao tác này không thể hoàn tác.')) return;
    await run('end', async () => {
      await api.post(`/organizer/competitions/${competitionId}/end`);
      setNotice('Đã kết thúc cuộc thi.');
      setRevision(value => value + 1);
    });
  }

  async function exportExcel() {
    await run('export', async () => {
      const { data } = await api.get(`${base}/excel`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `KetQuaXetGiai_${competitionId}.xlsx`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  function updateNominee(row, awardName) {
    setSelected(current => {
      const next = { ...current };
      if (!awardName) delete next[row.attemptId];
      else { const category=awardNames(row.rankingGroupName).find(item=>item.awardName===awardName); next[row.attemptId] = { attemptId: row.attemptId, awardName, awardIcon:category?.icon||'trophy', rankingGroupName: row.rankingGroupName }; }
      return next;
    });
  }

  if (resource.loading && !state) return <Loading />;
  if (resource.error && !state) return <section className="panel assignment-section"><Notice>{resource.error}</Notice></section>;
  if (!can('operate')) return <div className="assignment-workspace"><div className="notice" role="status">Quyền Duyệt chỉ xem kết quả cuộc thi.</div><CompetitionResultsPanel competitionId={competitionId} revision={revision} /></div>;
  const proposedTie = proposalRows.some(item => item.boundaryTie);
  const byAttempt = new Map(proposalRows.map(item => [item.attemptId, item]));
  return <div className="assignment-workspace">
    <Notice>{error || resource.error || awardCatalog.error}</Notice><Notice kind="success">{notice}</Notice>
    <section className="panel assignment-section award-review-panel">
      <div className="assignment-section-heading"><div><span className="eyebrow">XÉT GIẢ</span><h2>{state?.status === 'Published' ? 'Danh sách giải đã công bố' : state?.status === 'Approved' ? 'Danh sách giải đã duyệt' : 'Cấu hình giải và lập danh sách dự kiến'}</h2><p>Thứ hạng lấy từ bảng kết quả theo nhóm xếp hạng đã cấu hình.</p></div><span className="competition-status">{state?.status === 'Published' ? 'Đã công bố' : state?.status === 'Approved' ? 'Đã duyệt' : 'Dự kiến'}</span></div>
      <div className="assignment-award-settings">
        <label className="assignment-results-tiebreak"><input type="checkbox" checked={individualScoresPublished} onChange={event => setIndividualScoresPublished(event.target.checked)} disabled={Boolean(busy) || locked} /><span>Công bố điểm cá nhân cho thí sinh</span></label>
        <form className="assignment-award-category-form" onSubmit={addCategory}>
          <label>Nhóm xếp hạng<select value={newGroup} onChange={event => setNewGroup(event.target.value)} disabled={Boolean(busy) || locked}><option value="">Chọn nhóm</option>{asList(state?.results).map(row => row.rankingGroupName).filter((value, index, values) => value && values.indexOf(value) === index).map(group => <option key={group}>{group}</option>)}</select></label>
          <label>Danh mục giải<select value={newAwardName} onChange={event=>setNewAwardName(event.target.value)} disabled={Boolean(busy)||locked||awardCatalog.loading}><option value="">{awardCatalog.loading?'Đang tải giải…':'Chọn giải'}</option>{asList(awardCatalog.data).map(icon=><option key={icon.id} value={icon.name}>{icon.name}</option>)}</select></label>
          <label>Số lượng<input type="number" min="1" max="1000" value={newQuantity} onChange={event => setNewQuantity(event.target.value)} disabled={Boolean(busy) || locked} /></label>
          <button className="button button-secondary" type="submit" disabled={Boolean(busy) || locked}>Thêm hạng giải</button>
        </form>
        {categories.length > 0 && <div className="assignment-award-categories">{categories.map((category, index) => <div key={`${category.rankingGroupName}-${category.awardName}-${index}`}><strong><AwardIcon icon={category.icon}/> {category.awardName}</strong><span>{category.rankingGroupName} · {category.quantity} giải</span><button type="button" className="text-button" disabled={Boolean(busy) || locked} onClick={() => setCategories(current => current.filter((_, itemIndex) => itemIndex !== index))}>Gỡ</button></div>)}</div>}
        <label className="assignment-award-reason">Lý do nếu điều chỉnh danh sách so với bảng xếp hạng<textarea rows="2" maxLength="1000" value={adjustmentReason} onChange={event => setAdjustmentReason(event.target.value)} disabled={Boolean(busy) || locked} placeholder="Bắt buộc nếu thay đổi danh sách tự động" /></label>
        <div className="assignment-actions"><button type="button" className="button button-secondary" disabled={Boolean(busy) || locked || categories.length === 0} onClick={generateProposal}>{busy === 'proposal' ? 'Đang lập...' : 'Lập danh sách dự kiến'}</button><button type="button" className="button button-primary" disabled={Boolean(busy) || locked || !categories.length} onClick={saveDraft}>{busy === 'save' ? 'Đang lưu...' : 'Lưu danh sách dự kiến'}</button></div>
      </div>
      {proposedTie && <Notice kind="info">Có đồng hạng tại vị trí xét thưởng. Rà soát thể lệ và điều chỉnh danh sách nếu cần; xác nhận đã xử lý trước khi duyệt.</Notice>}
      {resultRows.length === 0 ? <div className="assignment-empty">Chưa có kết quả để xét giải.</div> : <div className="assignment-results-wrap"><table className="assignment-results-table" data-testid="award-review-results"><thead><tr><th>Hạng</th><th>Mã thí sinh</th><th>Họ tên</th><th>Bộ phận</th><th>Nhóm xếp hạng</th><th>Số câu đúng</th><th>Thời gian làm bài</th><th>Tổng điểm</th><th>Sự cố</th><th>Giải dự kiến</th></tr></thead><tbody>
        {resultRows.map((row, index) => {
          const nominee = selected[row.attemptId];
          const proposal = byAttempt.get(row.attemptId);
          const tie = proposal?.boundaryTie || state?.nominees?.some(item => item.attemptId === row.attemptId && item.boundaryTie);
          return <tr key={row.attemptId ?? `${row.candidateCode}-${index}`}>
            <td>{row.rank ?? '—'}</td><td>{row.candidateCode}</td><td>{row.fullName}</td><td>{row.department || '—'}</td><td>{row.rankingGroupName || '—'}</td><td>{row.correctAnswersCount ?? '—'}</td><td>{elapsedTime(row.durationMilliseconds)}</td><td>{row.totalScore ?? '—'}</td>
            <td>{row.hadIncident ? <span className="assignment-award-warning">Có sự cố</span> : '—'}{tie && <span className="assignment-award-warning">Đồng hạng tại ngưỡng</span>}</td>
            <td><span className="assignment-award-choice"><AwardIcon icon={nominee?.awardIcon||proposal?.awardIcon||awardNames(row.rankingGroupName).find(item=>item.awardName===nominee?.awardName)?.icon}/><select aria-label={`Giải dự kiến cho ${row.fullName || row.candidateCode}`} value={nominee?.awardName || ''} disabled={Boolean(busy) || locked || !row.isValid || !row.attemptId} onChange={event => updateNominee(row, event.target.value)}>
              <option value="">Không chọn</option>{awardNames(row.rankingGroupName).map(item => <option key={item.awardName} value={item.awardName}>{item.awardName}</option>)}
            </select></span></td>
          </tr>;
        })}
      </tbody></table></div>}
      <label className="assignment-award-confirm"><input type="checkbox" checked={tieReviewConfirmed} onChange={event => setTieReviewConfirmed(event.target.checked)} disabled={Boolean(busy) || locked} />Đã rà soát và xử lý các trường hợp đồng hạng tại vị trí xét thưởng theo thể lệ</label>
      <label className="assignment-award-reason">Ghi chú duyệt<textarea rows="2" maxLength="1000" value={approvalReason} onChange={event => setApprovalReason(event.target.value)} disabled={Boolean(busy) || state?.status !== 'Draft'} /></label>
      <div className="assignment-actions">
        <button type="button" className="button button-secondary" disabled={!can('operate') || !can('approve') || Boolean(busy) || state?.status !== 'Draft' || !state?.revision} onClick={approve}>{busy === 'approve' ? 'Đang duyệt...' : 'Duyệt danh sách'}</button>
        <button type="button" className="button button-primary" disabled={!can('operate') || Boolean(busy) || state?.status !== 'Approved' || state?.competitionStatus === 'Draft'} onClick={publish}>{busy === 'publish' ? 'Đang công bố...' : 'Công bố danh sách đạt giải'}</button>
        {can('operate')&&<button type="button" className="button button-secondary" disabled={Boolean(busy) || state?.status !== 'Published'} onClick={exportExcel}>{busy === 'export' ? 'Đang xuất...' : 'Xuất Excel'}</button>}
        <button type="button" className="button assignment-button-danger" disabled={!can('operate') || Boolean(busy) || state?.competitionStatus !== 'Published' || state?.status !== 'Published'} onClick={endCompetition}>{busy === 'end' ? 'Đang kết thúc...' : 'Kết thúc cuộc thi'}</button>
      </div>
      {state?.approvedAtUtc && <p className="assignment-hint">Duyệt lúc <DateText value={state.approvedAtUtc} /> · mã người duyệt {state.approvedByUserId}</p>}
      {state?.publishedAtUtc && <p className="assignment-hint">Công bố lúc <DateText value={state.publishedAtUtc} /> · mã người công bố {state.publishedByUserId}</p>}
      {asList(state?.audit).length > 0 && <details className="assignment-award-audit"><summary>Lịch sử xét giải</summary><ul>{state.audit.map((item, index) => <li key={`${item.action}-${index}`}><strong>{item.action}</strong> · {item.actorName} · <DateText value={item.occurredAtUtc} /> · {item.reason}</li>)}</ul></details>}
    </section>
  </div>;
}

export function isCandidateWorkspacePath(path) { return ['/thi-sinh/lich-thi','/thi-sinh/ket-qua'].includes(path) || /^\/thi-sinh\/cuoc-thi(?:\/\d+(?:\/(?:de-thi|huong-dan|lam-bai))?)?$/.test(path); }

function AssignedExam({ competition, showLink = true, navigate }) {
  const exam = competition.assignedExam;
  if (!exam) return <Notice kind="info">Chưa có thông tin đề được giao hợp lệ.</Notice>;
  return <section className="candidate-assigned-exam"><span className="eyebrow">ĐỀ ĐƯỢC GIAO</span><h3>{exam.name}</h3><p>{exam.fieldGroupName || 'Chưa cập nhật lĩnh vực'}</p><div className="candidate-exam-facts"><span>{exam.durationMinutes} phút</span><span>{exam.targetQuestionCount} câu</span><span>Phiên bản {exam.versionNumber}</span></div>{exam.isDemo && <span className="demo-label">Đề minh họa</span>}{showLink && <LocalLink className="button button-secondary" to={`${CANDIDATE_ROOT}/${competition.id}/de-thi`} navigate={navigate}>Xem đề được giao</LocalLink>}</section>;
}

function ScheduleDetails({ competition }) {
  return <dl className="competition-schedule"><div><dt>Mở thi</dt><dd><DateText value={competition.opensAtUtc} /></dd></div><div><dt>Hạn bắt đầu</dt><dd><DateText value={competition.startDeadlineUtc} /></dd></div><div><dt>Đóng thi</dt><dd><DateText value={competition.closesAtUtc} /></dd></div></dl>;
}

export function CandidateCompetitionList({ navigate }) {
  const [revision, setRevision] = useState(0);
  const competitions = useData('/candidate/competitions', revision);
  const rows = asList(competitions.data);
  return <section className="panel candidate-competitions"><div className="panel-heading"><div><h2>Cuộc thi của tôi</h2><p>Các cuộc thi đã công bố và có đề được phân cho tài khoản của bạn.</p></div></div>{competitions.loading ? <Loading /> : competitions.error ? <div className="assignment-section"><Notice>{competitions.error}</Notice><button className="button button-secondary" onClick={() => setRevision(value => value + 1)}>Thử lại</button></div> : !rows.length ? <div className="assignment-empty"><h3>Chưa có cuộc thi được phân tham gia</h3><p>Cuộc thi sẽ xuất hiện khi Ban Tổ chức phân đề và công bố.</p></div> : <div className="candidate-competition-list" data-testid="candidate-competitions">{rows.map(competition => <article className="candidate-competition" key={competition.id}><div className="competition-row-badges"><span className={`competition-status ${competition.status === 'Ended' ? 'competition-status-ended' : 'competition-status-published'}`}>{competition.status === 'Ended' ? 'Đã kết thúc' : 'Đã công bố'}</span>{competition.isDemo && <span className="demo-label">Dữ liệu minh họa</span>}</div><h3>{competition.name}</h3>{competition.description && <p className="competition-plain-text">{competition.description}</p>}<AssignedExam {...{ competition, navigate }} /><ScheduleDetails competition={competition} /><p className="assignment-attempt">{competition.attemptStatusLabel || ATTEMPT_NAMES[competition.attemptStatus] || 'Chưa bắt đầu'}</p><LocalLink className="button button-primary" to={`${CANDIDATE_ROOT}/${competition.id}/huong-dan`} navigate={navigate}>{competition.status === 'Ended' ? 'Xem kết quả' : 'Vào thi'}</LocalLink></article>)}</div>}</section>;
}

export function CandidateWorkspace({ path, navigate }) {
  const attemptTab = useAttemptTab();
  const match = path.match(/^\/thi-sinh\/cuoc-thi\/(\d+)(?:\/(de-thi|huong-dan|lam-bai))?$/);
  if (!match) return <CandidatePortal key={path} navigate={navigate} view={path === '/thi-sinh/ket-qua' ? 'results' : path === '/thi-sinh/lich-thi' ? 'schedule' : 'all'} />;
  if (match[2] === 'lam-bai') return <CandidateAttempt key={match[1]} competitionId={match[1]} navigate={navigate} attemptTab={attemptTab} />;
  return <CandidateDetail key={`${match[1]}-${match[2] || ''}`} competitionId={match[1]} examOnly={match[2] === 'de-thi'} guide={match[2] === 'huong-dan'} navigate={navigate} attemptTab={attemptTab} />;
}

function CandidateDetail({ competitionId, examOnly, guide, navigate, attemptTab }) {
  const [revision, setRevision] = useState(0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const resource = useData(`/candidate/competitions/${competitionId}${examOnly ? '/exam' : ''}`, revision);
  const awardResource = useData(`/candidate/competitions/${competitionId}/awards`, revision);
  async function begin() {
    if (starting) return;
    setStarting(true); setStartError('');
    try {
      const { data } = await api.post(`/candidate/competitions/${competitionId}/attempt/start`, undefined, {
        headers: { 'X-Quiz-Attempt-Tab': attemptTab.tabId },
      });
      if (['InProgress', 'Submitted', 'Expired'].includes(data.attemptStatus)) navigate(`${CANDIDATE_ROOT}/${competitionId}/lam-bai`);
      else setStartError(data.attemptStatus === 'Submitted' ? 'Bài thi này đã được nộp.' : data.attemptStatus === 'Expired' ? 'Lượt thi đã hết thời gian.' : data.message || 'Chưa thể bắt đầu lượt thi.');
    } catch (failure) {
      setStartError(isConnectionError(failure) ? 'Không thể kết nối máy chủ. Chưa bắt đầu lượt thi; vui lòng thử lại.' : failure.response?.data?.message || 'Chưa thể bắt đầu lượt thi. Vui lòng thử lại.');
    } finally { setStarting(false); }
  }
  if (resource.loading) return <Loading />;
  if (resource.error) return <section className="panel assignment-section"><Notice>{resource.status === 404 || resource.status === 403 ? 'Bạn chưa được phân công hoặc cuộc thi chưa công bố. Không thể truy cập nội dung này.' : resource.error}</Notice><div className="assignment-actions"><LocalLink to={CANDIDATE_ROOT} navigate={navigate} className="button button-secondary">Về Cuộc thi của tôi</LocalLink>{resource.status !== 404 && resource.status !== 403 && <button className="button button-secondary" onClick={() => setRevision(value => value + 1)}>Thử lại</button>}</div></section>;
  const competition = resource.data || {};
  const active = competition.attemptStatus === 'InProgress';
  const submitted = competition.attemptStatus === 'Submitted';
  const expired = competition.attemptStatus === 'Expired';
  return <div className="candidate-detail"><LocalLink className="text-button candidate-back" to={CANDIDATE_ROOT} navigate={navigate}>← Cuộc thi của tôi</LocalLink><CandidateFlowProgress current={submitted || expired || competition.status === 'Ended' ? 'results' : active ? 'attempt' : guide ? 'guide' : 'schedule'}/><section className="panel assignment-section"><div className="competition-row-badges"><span className={`competition-status ${competition.status === 'Ended' ? 'competition-status-ended' : 'competition-status-published'}`}>{competition.status === 'Ended' ? 'Đã kết thúc' : 'Đã công bố'}</span>{competition.isDemo && <span className="demo-label">Dữ liệu minh họa</span>}</div><h2>{competition.name}</h2>{!examOnly && competition.description && <p className="competition-plain-text">{competition.description}</p>}<AssignedExam competition={competition} navigate={navigate} showLink={!examOnly} /><p className="assignment-attempt">{competition.attemptStatusLabel || ATTEMPT_NAMES[competition.attemptStatus] || 'Chưa bắt đầu'}</p>{!examOnly && <Notice kind="info">{active ? 'Bạn đã bắt đầu lượt thi. Có thể tiếp tục với phiên hiện tại.' : submitted ? 'Bài thi đã được nộp. Bạn có thể xem trạng thái, không thể làm lại.' : competition.canStart ? 'Đọc kỹ thể lệ và thông tin đề trước khi bắt đầu.' : competition.startBlockedReason || 'Chưa thể bắt đầu làm bài. Vui lòng theo dõi lịch thi.'}</Notice>}<ScheduleDetails competition={competition} /><p className="assignment-hint">Thời gian hiển thị theo Asia/Ho_Chi_Minh (UTC+7).</p>{!examOnly && competition.rules && <section className="candidate-rules"><h3>Thể lệ cuộc thi</h3><p className="competition-plain-text">{competition.rules}</p></section>}{!examOnly && <CandidateAwardsPanel resource={awardResource} />}{guide && <><div className="candidate-guide-note"><strong>Hướng dẫn dự thi</strong><p>Thời gian làm bài chỉ bắt đầu khi máy chủ xác nhận. Câu trả lời được lưu trên máy chủ sau mỗi thay đổi; chỉ trạng thái <strong>Đã lưu</strong> mới xác nhận đã đồng bộ.</p><p>Thứ tự câu hỏi và phương án được xáo trộn riêng cho lượt thi. Điểm và đáp án sẽ hiển thị theo lịch công bố của Ban Tổ chức.</p></div>{competition.status === 'Ended' ? <Notice kind="info">Cuộc thi đã kết thúc. Thông tin điểm và giải thưởng được hiển thị theo trạng thái công bố.</Notice> : <>{startError && <Notice>{startError}</Notice>}<button className="button button-primary" type="button" onClick={begin} disabled={!attemptTab.ready || starting || (!competition.canStart && !active && !submitted && !expired)}>{starting ? 'Đang xác nhận...' : active ? 'Tiếp tục làm bài' : submitted || expired ? 'Xem trạng thái bài thi' : 'Bắt đầu'}</button></>}</>}{examOnly && <LocalLink className="button button-secondary" to={`${CANDIDATE_ROOT}/${competition.id}/huong-dan`} navigate={navigate}>Về hướng dẫn dự thi</LocalLink>}</section></div>;
}

function CandidateAwardsPanel({ resource }) {
  if (resource.loading && !resource.data) return <div className="candidate-awards" aria-live="polite">Đang kiểm tra công bố điểm và giải...</div>;
  if (resource.error || !resource.data) return null;
  const score = resource.data.individualScore;
  const awards = asList(resource.data.awards);
  const attemptSummary = resource.data.attemptSummary;
  return <section className="candidate-awards" aria-label="Điểm và giải thưởng" data-testid="candidate-awards">
    <h3>Kết quả cá nhân</h3>
    {!resource.data.individualScorePublished ? <p>Điểm cá nhân chưa được Ban Tổ chức công bố.</p> : score ? <p>Tổng điểm <strong>{score.totalScore ?? '—'}</strong> · Hạng <strong>{score.rank ?? '—'}</strong></p> : <p>Chưa có lượt thi hợp lệ đã nộp để hiển thị điểm.</p>}
    {attemptSummary && <div className="attempt-result-summary"><p>S&#7889; c&#226;u &#273;&#250;ng: <strong>{attemptSummary.correctAnswersCount}</strong></p><p>Th&#7901;i gian ho&#224;n th&#224;nh: <strong>{elapsedTime(attemptSummary.durationMilliseconds)}</strong></p></div>}
    <h3>Danh sách đạt giải</h3>
    {!resource.data.awardsPublished ? <p>Danh sách đạt giải chưa được Ban Tổ chức công bố.</p> : !awards.length ? <p>Danh sách đã được công bố; chưa có thí sinh đạt giải.</p> : <div className="assignment-results-wrap"><table className="assignment-results-table"><thead><tr><th>Giải</th><th>Mã thí sinh</th><th>Họ tên</th><th>Bộ phận</th><th>Nhóm xếp hạng</th><th>Hạng</th></tr></thead><tbody>{awards.map((item, index) => <tr key={`${item.candidateCode}-${item.awardName}-${index}`}><td><AwardIcon icon={item.awardIcon}/> {item.awardName}</td><td>{item.candidateCode}</td><td>{item.fullName}</td><td>{item.department || '—'}</td><td>{item.rankingGroupName}</td><td>{item.rank}</td></tr>)}</tbody></table></div>}
  </section>;
}

