import { useCallback, useEffect, useRef, useState } from 'react';
import $ from 'jquery';
import installSelect2 from 'select2';
import 'select2/dist/css/select2.min.css';
installSelect2(window, $);
import { api, isConnectionError, isSessionRejected, isUnauthorized, TOKEN_KEY } from './api.js';
import { CandidateCompetitions, CompetitionsPage } from './Competitions.jsx';
import ExamWorkspace, { isExamWorkspacePath } from './ExamWorkspace.jsx';
import { CandidateWorkspace, isCandidateWorkspacePath } from './AssignmentWorkspace.jsx';
import {AccessProvider} from './AccessContext.jsx';
import {hasAccess,ACCESS_LABELS,workflowPermissions} from '../../shared/access.mjs';
import {accountGroup,accountHome,accountMenu,canOpenAccountPath,GROUP_LABELS} from '../../shared/accountGroups.mjs';
import SystemAdminWorkspace from './SystemAdminWorkspace.jsx';
import UserAccessEditor,{AccessFields} from './UserAccessEditor.jsx';
import WorkflowHub from './WorkflowHub.jsx';
import CandidatePortal from './CandidatePortal.jsx';
import {workflowSections,isWorkflowPath,canOpenWorkflow,EDITORIAL_PATH,DELIVERY_PATH,OPERATIONS_PATH,RESULTS_PATH,APPROVED_PATH} from '../../shared/workflowNavigation.mjs';
import ReviewQueue from './ReviewQueue.jsx';
import CatalogWorkspace from './CatalogWorkspace.jsx';
import DepartmentSelect from './DepartmentSelect.jsx';
import {unitNameKey} from '../../shared/organizationUnits.mjs';
import QuestionBankWorkspace from './QuestionBankWorkspace.jsx';
import GovernmentMasthead from './GovernmentMasthead.jsx';
import './government-theme.css';
import './form-controls.css';
import './accounts.css';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const ROLE_NAMES = { Organizer: 'Biên tập – Duyệt', Candidate: 'Thi' };
const homeFor = accountHome;

function Icon({ name, size = 20, ...props }) {
  const shapes = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M9 12h12m-4-4 4 4-4 4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    book: <><path d="M4 3h13a3 3 0 0 1 3 3v15H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM3 17h17M8 7h7M8 11h5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
    edit: <><path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4 4 16.5Z" /><path d="m14.8 5.7 3.5 3.5" /></>,
    trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{shapes[name] || shapes.info}</svg>;
}

function Brand({ light = false }) {
  return <div className={`brand ${light ? 'brand-light' : ''}`}><span aria-hidden="true">★</span><div><strong>XÃ TÂN HÒA</strong><span>HỘI THI NGHIỆP VỤ</span></div></div>;
}

function Loading({ children }) {
  return <span className="loading"><span className="loading-spinner" aria-hidden="true" />{children}</span>;
}

function readUser(data) {
  if (!data || typeof data.username !== 'string' || !data.username.trim() || !ROLE_NAMES[data.role]) throw new Error('Thông tin tài khoản không hợp lệ. Vui lòng liên hệ Ban Tổ chức.');
  return { id:data.id,workflowPermissions:data.workflowPermissions,processIds:data.processIds,assignedProcesses:data.assignedProcesses,processPermissionKeys:data.processPermissionKeys,accessLabel:data.accessLabel, department:data.department||'', username: data.username, fullName: data.fullName || '', role: data.role, isDemo: data.isDemo === true, isActive: data.isActive !== false, mustChangePassword: data.mustChangePassword === true, expiresAt: data.expiresAt };
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname.replace(/\/$/, '') || '/');
  useEffect(() => {
    const handle = () => setPath(window.location.pathname.replace(/\/$/, '') || '/');
    window.addEventListener('popstate', handle);
    return () => window.removeEventListener('popstate', handle);
  }, []);
  const navigate = useCallback((next, replace = false) => {
    if (window.location.pathname !== next) window.history[replace ? 'replaceState' : 'pushState']({}, '', next);
    setPath(window.location.pathname.replace(/\/$/, '') || '/'); window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  return [path, navigate];
}

function VietnamClock({ offset = 0, compact = false }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const date = new Date(now + offset);
  const time = new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
  const day = new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  return <div data-testid="vn-clock" className={`vietnam-clock ${compact ? 'compact' : ''}`}><span><Icon name="clock" size={16} /><strong>{time}</strong><span className="clock-zone">Giờ Việt Nam</span></span><small>{day}</small></div>;
}

function PageError({ children, retry }) {
  return <div className="notice notice-error" role="alert"><Icon name="info" /><div>{children}{retry && <button className="text-button" onClick={retry}>Thử lại</button>}</div></div>;
}

function Login({ username, setUsername, password, setPassword, submitting, handleLogin, loginError, config, configError, retryConfig, checkingSession, sessionError, retrySession, logout, clockOffset }) {
  const [showPassword, setShowPassword] = useState(false);
  return <div className="login-shell"><GovernmentMasthead /><div className="login-page">
    <section className="login-intro" aria-label="Giới thiệu hội thi"><Brand /><div className="intro-content"><span className="eyebrow light-eyebrow"><span /> HỘI THI TRỰC TUYẾN</span><h1>Vững nghiệp vụ.<br /><em>Tận tâm phục vụ.</em></h1><p>Không gian học tập và dự thi dành cho cán bộ, công chức xã Tân Hòa. Cùng nâng cao chuyên môn, trách nhiệm và chất lượng phục vụ Nhân dân.</p><div className="intro-divider" /><div className="intro-values"><span><Icon name="book" /> Nâng cao chuyên môn</span><span><Icon name="shield" /> Trách nhiệm công vụ</span></div><div className="heritage-caption"><span />HỌC TẬP · RÈN LUYỆN · CỐNG HIẾN</div></div><div className="intro-footer"><span>HỘI THI NGHIỆP VỤ</span><span>XÃ TÂN HÒA</span></div></section>
    <main className="login-main" id="main-content"><div className="login-top"><span>CỔNG THÔNG TIN HỘI THI</span><VietnamClock offset={clockOffset} compact /></div><section className="login-card" aria-labelledby="login-title"><span className="login-icon"><Icon name="shield" size={26} /></span><span className="eyebrow">CHÀO MỪNG ĐẾN VỚI QUIZ TÂN HÒA</span><h2 id="login-title">Đăng nhập hệ thống</h2><p className="muted login-description">Sử dụng tài khoản được cấp để truy cập<br className="desktop-break" /> không gian hội thi của bạn.</p>
      {checkingSession ? <div className="session-state" role="status"><Loading>Đang xác thực phiên đăng nhập...</Loading></div> : sessionError ? <div className="session-state"><PageError retry={retrySession}>{sessionError}</PageError><button className="button button-secondary full-width" onClick={() => logout()}>Đăng xuất</button></div> : <form onSubmit={handleLogin} aria-busy={submitting}>{loginError && <div id="login-error" className="notice notice-error" role="alert"><Icon name="info" /><span>{loginError}</span></div>}<div className="field"><label htmlFor="username">Tên đăng nhập</label><div className="input-wrap"><Icon name="user" /><input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={100} placeholder="Nhập tên đăng nhập" value={username} onChange={(event) => setUsername(event.target.value)} disabled={submitting} aria-describedby={loginError ? 'login-error' : undefined} /></div></div><div className="field"><label htmlFor="password">Mật khẩu</label><div className="input-wrap"><Icon name="lock" /><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required placeholder="Nhập mật khẩu của bạn" value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} aria-describedby={loginError ? 'login-error' : undefined} /><button type="button" className={`password-toggle ${showPassword ? 'is-visible' : ''}`} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={showPassword} disabled={submitting}><Icon name="eye" size={19} /></button></div></div><div className="login-help"><Icon name="info" size={15} /><span>Chưa có tài khoản? Vui lòng liên hệ Ban Tổ chức.</span></div><button type="submit" className="button button-primary full-width login-submit" disabled={submitting}>{submitting ? <Loading>Đang đăng nhập...</Loading> : <>Đăng nhập <Icon name="arrow" size={19} /></>}</button></form>}
      <div className="login-security"><Icon name="shield" size={15} /><span>Quyền truy cập theo tài khoản được cấp</span></div>{config?.demoEnabled && !checkingSession && !sessionError && <div className="demo-box"><span className="demo-label">TÀI KHOẢN MINH HỌA</span><p>Dùng để trải nghiệm các nhóm tài khoản. Đây là dữ liệu minh họa.</p><div className="demo-options">{(config.demoAccounts || []).map((account) => <button type="button" key={account.username} disabled={submitting} onClick={() => { setUsername(account.username); setPassword('TanHoa@2026!'); }}><span>{ROLE_NAMES[account.role] || account.role}</span><small>{account.username}</small><Icon name="arrow" size={16} /></button>)}</div><small>Mật khẩu minh họa: <code>TanHoa@2026!</code></small></div>}{configError && <div className="config-warning" role="status">Chưa tải được thông tin hệ thống. <button className="text-button" onClick={retryConfig}>Thử lại</button></div>}</section><footer className="login-footer"><span>© Hội thi nghiệp vụ xã Tân Hòa</span><span>Múi giờ: {TIME_ZONE} (UTC+7)</span></footer></main>
  </div></div>;
}

function NavItem({ icon, children, to, path, navigate, disabled = false }) {
  const selected = path === to || ((to === '/ban-to-chuc/cuoc-thi' || to === '/thi-sinh/cuoc-thi') && path.startsWith(`${to}/`));
  return disabled ? <div className="nav-item nav-disabled"><Icon name={icon} /><span>{children}</span><small>Sắp có</small></div> : <a href={to} className={`nav-item ${selected ? 'nav-active' : ''}`} aria-current={selected ? 'page' : undefined} onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(to); }}><Icon name={icon} /><span>{children}</span>{selected && <span className="active-dot" />}</a>;
}

export function Shell({ user, path, navigate, logout, loggingOut, logoutError, clockOffset, children }) {
  const organizer = user.role === 'Organizer';
  const profile = path === '/tai-khoan';
  const accounts = path === '/ban-to-chuc/tai-khoan';
  const questionBank = path === '/ban-to-chuc/ngan-hang-cau-hoi';
  const competitionPage = path === '/ban-to-chuc/cuoc-thi' || path.startsWith('/ban-to-chuc/cuoc-thi/');
  const workflowTitles = {[EDITORIAL_PATH]:'Biên tập',[DELIVERY_PATH]:'Duyệt & tổ chức thi',[OPERATIONS_PATH]:'Lịch thi & phân công',[RESULTS_PATH]:'Kết quả & xét giải',[APPROVED_PATH]:'Đề đã duyệt','/thi-sinh/lich-thi':'Lịch thi của tôi','/thi-sinh/ket-qua':'Bài đã nộp & kết quả'};
  const pageTitle = (path==='/quan-tri'?'Tổng quan hệ thống':path==='/quan-tri/xoa-cuoc-thi'?'X\u00f3a cu\u1ed9c thi':path==='/quan-tri/nhat-ky'?'Nhật ký hoạt động':null) || workflowTitles[path] || (path === '/ban-to-chuc/cho-duyet' ? 'Chờ duyệt' : path === '/ban-to-chuc/danh-muc' ? 'Danh mục' : profile ? 'Tài khoản của tôi' : accounts ? 'Danh sách tài khoản' : questionBank ? 'Ngân hàng câu hỏi' : isCandidateWorkspacePath(path) ? path.endsWith('/lam-bai') ? 'Làm bài thi' : path.endsWith('/huong-dan') ? 'Hướng dẫn dự thi' : 'Cuộc thi của tôi' : isExamWorkspacePath(path) ? path.endsWith('/lich-thi') ? 'Lịch thi' : path.endsWith('/phan-cong') ? 'Phân công dự thi' : path.endsWith('/co-cau-giai') ? 'Cơ cấu giải' : path.endsWith('/trinh-duyet') ? 'Trình duyệt đề' : path.endsWith('/xet-giai') ? 'Kết quả & xét giải' : 'Đề thi' : competitionPage ? path.endsWith('/tao') ? 'Tạo cuộc thi' : path.endsWith('/chinh-sua') ? 'Chỉnh sửa cuộc thi' : 'Cuộc thi' : 'Tổng quan');
  return <div className="portal-layout">
    <GovernmentMasthead />
    <a className="skip-link" href="#main-content">Đến nội dung chính</a>
    <aside className="sidebar"><div className="sidebar-brand"><Brand light /></div><div className="workspace-label">{GROUP_LABELS[accountGroup(user)]}</div>
      <nav aria-label="Điều hướng chính">{accountMenu(user).map(row=><NavItem key={row.path} icon={row.icon} to={row.path} path={path} navigate={navigate}>{row.label}</NavItem>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="small-star">✦</span><strong>Vững nghiệp vụ<br />Tận tâm phục vụ</strong><p>Cùng xây dựng đội ngũ cán bộ, công chức chuyên nghiệp.</p></div><div className="sidebar-role"><Icon name="shield" size={17} /><span>{GROUP_LABELS[accountGroup(user)]}</span></div></div>
    </aside>
    <div className="portal-main"><header className="topbar"><div className="breadcrumb">{GROUP_LABELS[accountGroup(user)]}<Icon name="chevron" size={14} /><strong>{pageTitle}</strong></div><div className="topbar-right"><VietnamClock offset={clockOffset} /><span className="topbar-separator" /><button className="avatar avatar-small" onClick={() => navigate('/tai-khoan')} aria-label="Mở tài khoản của tôi">{(user.fullName || user.username).slice(0, 1).toUpperCase()}</button></div></header>
      <main id="main-content" className="page-content"><div className="page-heading"><div><div className="eyebrow">HỘI THI NGHIỆP VỤ XÃ TÂN HÒA</div><h1>{pageTitle}</h1></div><button className="button button-quiet logout-button" onClick={logout} disabled={loggingOut}><Icon name="logout" size={17} />{loggingOut ? 'Đang đăng xuất...' : 'Đăng xuất'}</button></div>{logoutError && <PageError>{logoutError}</PageError>}{user.isDemo && <div className="notice demo-notice"><Icon name="info" size={18} /><span><strong>Chế độ minh họa.</strong> Bạn đang sử dụng tài khoản và dữ liệu minh họa.</span></div>}{children}</main>
      <footer className="portal-footer"><span>© Hội thi nghiệp vụ xã Tân Hòa</span><span>{TIME_ZONE} · UTC+7</span></footer>
    </div>
  </div>;
}

function StatCard({ icon, label, value, description, tone = 'navy' }) {
  return <section className="stat-card"><span className={`stat-icon tone-${tone}`}><Icon name={icon} size={22} /></span><div><span className="stat-label">{label}</span><strong className="stat-value">{value ?? '—'}</strong><small>{description}</small></div></section>;
}

function OrganizerCompetitionSummary({ navigate }) {
  return <section className="panel exam-panel"><div className="panel-heading"><div><h2>Quản lý cuộc thi</h2><p>Chuẩn bị nội dung cho các cuộc thi của xã Tân Hòa.</p></div></div><div className="competition-empty"><span className="competition-empty-icon"><Icon name="calendar" size={30} /></span><h3>Từ ý tưởng đến cuộc thi</h3><p>Tạo cuộc thi mới, soạn mô tả và thể lệ, sau đó mở lại để tiếp tục chỉnh sửa bản nháp.</p><button className="button button-primary" onClick={() => navigate('/ban-to-chuc/cuoc-thi')}>Quản lý cuộc thi <Icon name="arrow" size={17} /></button></div></section>;
}

function Dashboard({ user, data, loading, error, retry, navigate }) {
  const organizer = user.role === 'Organizer';
  return <><section className="welcome-banner"><div className="welcome-copy"><span className="eyebrow light-eyebrow">{ROLE_NAMES[user.role].toLocaleUpperCase('vi-VN')}</span><h2>Chào mừng trở lại,<br /><span>{user.fullName || user.username}.</span></h2><p>{organizer ? 'Sẵn sàng đồng hành cùng cán bộ, công chức trong hành trình nâng cao năng lực nghiệp vụ.' : 'Cùng học hỏi, nâng cao chuyên môn và tự tin thể hiện năng lực nghiệp vụ của bạn.'}</p><p className="welcome-account">@{user.username}</p><div className="welcome-pill"><span className="status-dot" />Tài khoản đang hoạt động</div></div><div className="welcome-art" aria-hidden="true"><div className="art-ring art-ring-one" /><div className="art-ring art-ring-two" /><div className="art-seal"><span>★</span><svg viewBox="0 0 100 90" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 37 50 15l42 22H8ZM15 42h70M20 43v28m15-28v28m15-28v28m15-28v28m15-28v28M12 75h76M7 82h86" /></svg><small>XÃ TÂN HÒA</small></div><span className="art-spark spark-one">✦</span><span className="art-spark spark-two">✧</span></div></section>{error && <PageError retry={retry}>{error}</PageError>}{loading && <div className="data-loading" role="status"><Loading>Đang tải thông tin...</Loading></div>}
    {organizer ? <div className="stats-grid"><StatCard icon="users" label="Tổng số tài khoản" value={data?.userCount} description="Tài khoản trong hệ thống" /><StatCard icon="shield" label="Ban Tổ chức" value={data?.organizerCount} description="Tài khoản tổ chức" tone="teal" /><StatCard icon="user" label="Thí sinh" value={data?.candidateCount} description="Tài khoản dự thi" tone="gold" /></div> : <div className="candidate-summary"><div className="summary-icon"><Icon name="shield" size={24} /></div><div><strong>Không gian dành cho thí sinh</strong><p>Tài khoản của bạn đã sẵn sàng. Thông tin hội thi sẽ được cập nhật tại đây.</p></div><span className="status-label"><Icon name="check" size={14} /> Đã xác thực</span></div>}
    {organizer && data?.demoUserCount > 0 && <p className="demo-count-note"><Icon name="info" size={16} /> Các số liệu tài khoản ở trên bao gồm {data.demoUserCount} tài khoản minh họa.</p>}
    <div className="dashboard-columns">{organizer ? <OrganizerCompetitionSummary navigate={navigate} /> : <CandidateCompetitions />}<div className="dashboard-side"><section className="panel quick-panel"><div className="panel-heading"><h2>Truy cập nhanh</h2></div><button className="quick-link" onClick={() => navigate('/tai-khoan')}><span className="quick-icon"><Icon name="user" /></span><span><strong>Thông tin tài khoản</strong><small>Xem thông tin và quyền truy cập</small></span><Icon name="chevron" size={17} /></button>{organizer && hasAccess(user,'manageUsers') && <button className="quick-link" onClick={() => navigate('/ban-to-chuc/tai-khoan')}><span className="quick-icon"><Icon name="users" /></span><span><strong>Danh sách tài khoản</strong><small>Xem các vai trò trong hệ thống</small></span><Icon name="chevron" size={17} /></button>}</section><section className="note-card"><span className="eyebrow"><Icon name="info" size={16} /> THÔNG TIN CHUNG</span><h3>Thống nhất giờ Việt Nam</h3><p>Thời gian hiển thị và lịch hội thi được sử dụng theo múi giờ Việt Nam (UTC+7).</p><code>{TIME_ZONE}</code></section></div></div><section className="foundation-strip"><span className="foundation-mark"><Icon name="check" size={17} /></span><div><strong>Nền tảng hệ thống đã sẵn sàng</strong><span>Đăng nhập · Phân quyền · Thông tin tài khoản</span></div></section></>;
}

export function Profile({ user, onPasswordChanged }) {
  return <div className="profile-grid"><section className="panel profile-panel"><div className="profile-banner" /><div className="profile-identity"><span className="avatar profile-avatar">{(user.fullName || user.username).slice(0, 1).toUpperCase()}</span><div><h2>{user.fullName || user.username}</h2><p>@{user.username}</p></div><span className="status-label"><span className="status-dot" /> Đang hoạt động</span></div><dl className="profile-details"><div><dt>Họ và tên</dt><dd>{user.fullName || 'Chưa cập nhật'}</dd></div><div><dt>Tên đăng nhập</dt><dd>{user.username}</dd></div><div><dt>Vai trò</dt><dd><span className="role-tag">{GROUP_LABELS[accountGroup(user)]}</span></dd></div><div><dt>Loại tài khoản</dt><dd>{user.isDemo ? 'Tài khoản minh họa' : 'Tài khoản chính thức'}</dd></div><div><dt>Múi giờ sử dụng</dt><dd>{TIME_ZONE} (UTC+7)</dd></div></dl></section>
    <section className="panel permissions-panel"><span className="permission-icon"><Icon name="shield" size={26} /></span><h2>Quyền truy cập của bạn</h2><p>Quyền được cấp theo vai trò <strong>{GROUP_LABELS[accountGroup(user)]}</strong>.</p><ul><li><Icon name="check" size={17} />Xem thông tin tài khoản cá nhân</li><li><Icon name="check" size={17} />Truy cập không gian {user.role === 'Organizer' ? 'tổ chức' : 'dự thi'}</li>{user.role === 'Organizer' ? <>{workflowPermissions(user).map(p=><li key={p}><Icon name="check" size={17}/>{ACCESS_LABELS[p]}</li>)}</> : <li><Icon name="check" size={17} />Xem cuộc thi đã công bố và được phân tham gia</li>}</ul><div className="permission-note"><Icon name="info" size={17} /><span>Cần điều chỉnh thông tin hoặc quyền truy cập? Vui lòng liên hệ người phụ trách hệ thống.</span></div></section>
    <PasswordChange onComplete={onPasswordChanged} />
  </div>;
}

function Accounts({ data, error, loading, retry, currentUser }) {
  const [accessEditing,setAccessEditing] = useState(null);
  const [groupFilter,setGroupFilter]=useState('');
  const groupFilterSelect=useRef(null);
  useEffect(()=>{
    const select=$(groupFilterSelect.current);
    select.select2({width:'100%',language:{noResults:()=> 'Không có nhóm phù hợp.'}});
    select.on('change.accountsFilter',()=>setGroupFilter(select.val()||''));
    return()=>{select.off('.accountsFilter');if(select.hasClass('select2-hidden-accessible'))select.select2('destroy');};
  },[]);
  useEffect(()=>{
    const select=$(groupFilterSelect.current);
    if(select.length&&select.val()!==groupFilter)select.val(groupFilter).trigger('change.select2');
  },[groupFilter]);
  const [departmentFilter,setDepartmentFilter]=useState(()=>new URLSearchParams(window.location.search).get('phongBan')||'');
  const allUsers = Array.isArray(data) ? data : data?.users || [];
  const users = allUsers.filter(u=>(!departmentFilter||unitNameKey(u.department)===unitNameKey(departmentFilter))&&(!groupFilter||accountGroup(u)===groupFilter));
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createFields, setCreateFields] = useState({ username: '', fullName: '', department: '',role:'Candidate',processIds:[] });
  const [deleteId, setDeleteId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [notice, setNotice] = useState('');
  async function create(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setEditError(''); setNotice('');
    try {
      await api.post('/organizer/users', createFields);
      setCreating(false); setCreateFields({ username: '', fullName: '', department: '',role:'Candidate',processIds:[] });
      setNotice('Đã tạo tài khoản. Mật khẩu ban đầu là 123456; thí sinh có thể đổi mật khẩu trong Thông tin tài khoản.');
      retry();
    } catch (requestError) {
      setEditError(requestError.response?.data?.message || 'Chưa thể tạo tài khoản. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (busy || !editing) return;
    setBusy(true); setEditError(''); setNotice('');
    try {
      await api.put(`/organizer/users/${editing.id}`, {
        fullName: editing.fullName,
        department: editing.department, departmentId:editing.departmentId,
        isActive: editing.isActive,
      });
      setEditing(null); setNotice('Đã cập nhật thông tin tài khoản.'); retry();
    } catch (requestError) {
      const data = requestError.response?.data;
      const validationErrors = Object.values(data?.errors || {}).flat().filter(value => typeof value === 'string');
      setEditError(validationErrors.length ? validationErrors.join(' ') : data?.message || 'Chưa thể cập nhật tài khoản. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }
  async function removeCandidate(account) {
    if (busy || deleteId !== account.id) return;
    setBusy(true); setEditError(''); setNotice('');
    try {
      await api.delete(`/organizer/users/${account.id}`);
      setDeleteId(null); setNotice(`Đã xóa tài khoản @${account.username}.`); retry();
    } catch (requestError) {
      setEditError(requestError.response?.data?.message || 'Chưa thể xóa tài khoản. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }
  return <section className="panel accounts-panel">
    <div className="panel-heading"><div><h2>Tài khoản trong hệ thống</h2><p>Quản lý ba nhóm Quản trị hệ thống, Biên tập – Duyệt và Thi. Tài khoản có lịch sử thi được khóa để giữ dữ liệu.</p></div>{!loading && !error && <span className="badge-neutral">{users.length} tài khoản</span>}</div>
    <label className="accounts-group-filter" htmlFor="account-group-filter">Lọc nhóm tài khoản<select id="account-group-filter" ref={groupFilterSelect} value={groupFilter} onChange={e=>setGroupFilter(e.target.value)}><option value="">Tất cả nhóm</option>{Object.entries(GROUP_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    {departmentFilter&&<div className="notice" role="status">Đang xem tài khoản thuộc {departmentFilter}<button type="button" className="text-button" onClick={()=>{setDepartmentFilter('');window.history.replaceState({},'','/ban-to-chuc/tai-khoan');}}>Bỏ lọc phòng ban</button></div>}
    {editError && <PageError>{editError}</PageError>}{notice && <div className="notice exam-notice-success" role="status">{notice}</div>}
    {accessEditing && <UserAccessEditor key={accessEditing.id} account={accessEditing} onSaved={()=>{setAccessEditing(null);setNotice('Đã cập nhật quyền. Tài khoản được cấp quyền cần đăng nhập lại.');retry();}} onCancel={()=>setAccessEditing(null)}/> }
    {!creating && <button className="button button-primary accounts-add-button" type="button" disabled={busy || Boolean(editing)} onClick={() => { setCreating(true); setEditError(''); setNotice(''); }}>Thêm tài khoản</button>}
    {creating && <form className="accounts-row-editor" onSubmit={create}>
      <h3>Tạo tài khoản</h3>
      <div className="bank-filters">
        <label htmlFor="account-new-username">Tên đăng nhập<input id="account-new-username" required maxLength={100} autoCapitalize="none" value={createFields.username} onChange={event => setCreateFields(current => ({ ...current, username: event.target.value }))} disabled={busy} /></label>
        <label htmlFor="account-new-full-name">Họ và tên<input id="account-new-full-name" required maxLength={200} value={createFields.fullName} onChange={event => setCreateFields(current => ({ ...current, fullName: event.target.value }))} disabled={busy} /></label>
        <label htmlFor="account-new-department">Phòng ban<DepartmentSelect id="account-new-department" value={createFields.department} departmentId={createFields.departmentId} onChange={unit=>setCreateFields(current=>({...current,...unit}))} disabled={busy}/></label>
      </div>
      <AccessFields value={createFields} onChange={setCreateFields} disabled={busy}/><p className="table-footer">Mật khẩu ban đầu: <strong>123456</strong>. Thí sinh có thể đổi mật khẩu trong Thông tin tài khoản.</p>
      <div className="exam-actions"><button className="button button-primary" type="submit" disabled={busy||!createFields.processIds?.length}>{busy ? 'Đang tạo...' : 'Tạo tài khoản'}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => { setCreating(false); setEditError(''); }}>Hủy</button></div>
    </form>}
    {error ? <PageError retry={retry}>{error}</PageError> : loading ? <div className="table-loading" role="status"><Loading>Đang tải danh sách tài khoản...</Loading></div> : <>
      <div className="account-list">
        <div className="account-list-heading"><strong>Thông tin tài khoản</strong><strong>Chức năng</strong></div>
        {users.map(account => {
          const isEditing = editing?.id === account.id;
          const information = <div className="account-information">
            {isEditing ? <>
              <strong className="account-name">{account.fullName || account.username}</strong><span className="account-username">@{account.username}</span>
              <label htmlFor="account-full-name">Họ và tên<input id="account-full-name" required maxLength={200} value={editing.fullName} onChange={event => setEditing(current => ({ ...current, fullName: event.target.value }))} disabled={busy} /></label>
              <label htmlFor="account-department">Phòng ban<DepartmentSelect id="account-department" value={editing.department} departmentId={editing.departmentId} onChange={unit=>setEditing(current=>({...current,...unit}))} disabled={busy}/></label>
              <label className="account-active-toggle"><input type="checkbox" checked={editing.isActive} onChange={event => setEditing(current => ({ ...current, isActive: event.target.checked }))} disabled={busy} />Tài khoản đang hoạt động</label>
            </> : <>
              <strong className="account-name">{account.fullName || 'Chưa cập nhật'}</strong><span className="account-username">@{account.username}</span>
              <span>{account.department || 'Chưa cập nhật đơn vị'}</span>
              <div className="account-tags"><span className="role-tag">{GROUP_LABELS[accountGroup(account)]}</span><span className={`account-state ${account.isActive ? '' : 'state-inactive'}`}><span />{account.isActive ? 'Hoạt động' : 'Đã khóa'}</span>{account.isDemo && <span className="demo-label">Minh họa</span>}</div>
            </>}
          </div>;
          const actions = <div className="account-actions" aria-label={`Chức năng tài khoản ${account.username}`}>{!isEditing && <button type="button" className="button button-secondary" disabled={busy || creating || Boolean(editing) || account.id === currentUser.id} title={account.id === currentUser.id ? 'Không tự đổi quyền của tài khoản đang đăng nhập' : undefined} onClick={()=>{setAccessEditing(account);setEditError('');setNotice('');}}>Phân quyền</button>}
            {isEditing ? <>
              <button className="account-icon-button account-save-button" type="submit" disabled={busy} aria-label="Lưu thay đổi" title="Lưu thay đổi"><Icon name="check" /></button>
              <button className="account-icon-button" type="button" disabled={busy} aria-label="Hủy sửa" title="Hủy sửa" onClick={() => { setEditing(null); setEditError(''); }}><Icon name="close" /></button>
            </> : <>
              <button className="account-icon-button" type="button" disabled={busy || Boolean(editing) || creating} aria-label={`Sửa ${account.username}`} title="Sửa" onClick={() => { setEditing({ id: account.id, username: account.username, fullName: account.fullName || '', department: account.department || '', isActive: account.isActive }); setEditError(''); setNotice(''); setDeleteId(null); }}><Icon name="edit" /></button>
              {account.role === 'Candidate' && (deleteId === account.id ? <><button className="account-icon-button account-delete-button" type="button" disabled={busy} aria-label={`Xác nhận xóa ${account.username}`} title="Xác nhận xóa" onClick={() => removeCandidate(account)}><Icon name="check" /></button><button className="account-icon-button" type="button" disabled={busy} aria-label="Hủy xóa" title="Hủy xóa" onClick={() => setDeleteId(null)}><Icon name="close" /></button><span className="account-delete-confirm">Xóa tài khoản?</span></> : <button className="account-icon-button account-delete-button" type="button" disabled={busy || Boolean(editing) || creating} aria-label={`Xóa ${account.username}`} title="Xóa" onClick={() => { setDeleteId(account.id); setEditError(''); setNotice(''); }}><Icon name="trash" /></button>)}
            </>}
          </div>;
          return isEditing
            ? <form className="account-row" key={account.id || account.username} onSubmit={save}>{information}{actions}</form>
            : <article className={`account-row ${deleteId === account.id ? 'account-row-confirming' : ''}`} key={account.id || account.username}>{information}{actions}</article>;
        })}
      </div>
      {users.length === 0 && <p className="table-loading">Chưa có tài khoản để hiển thị.</p>}
      <div className="table-footer"><Icon name="shield" size={16} />Dùng Phân quyền để gán quy trình đã tạo trong Danh mục. Không tự đổi quyền của tài khoản đang đăng nhập. Tài khoản đã phân công hoặc có lượt thi được giữ lịch sử và chỉ có thể khóa.</div>
    </>}
  </section>;
}

function StatusPage({ forbidden, navigate, user }) {
  return <section className="panel status-page"><span className="status-page-icon"><Icon name={forbidden ? 'lock' : 'info'} size={34} /></span><span className="eyebrow">{forbidden ? '403 · GIỚI HẠN TRUY CẬP' : '404 · KHÔNG TÌM THẤY'}</span><h2>{forbidden ? 'Bạn không có quyền truy cập màn hình này' : 'Màn hình không tồn tại'}</h2><p>{forbidden ? `Tài khoản của bạn có vai trò ${GROUP_LABELS[accountGroup(user)]}. Vui lòng trở về không gian phù hợp.` : 'Đường dẫn này chưa có trong hệ thống. Vui lòng kiểm tra lại hoặc về trang tổng quan.'}</p><button className="button button-primary" onClick={() => navigate(homeFor(user))}>Về tổng quan <Icon name="arrow" size={18} /></button></section>;
}

function PasswordChange({ onComplete }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api.post('/Auth/change-password', { currentPassword, newPassword, confirmPassword });
      onComplete();
    } catch (failure) {
      setError(failure.response?.data?.message || 'Chưa thể đổi mật khẩu. Vui lòng kiểm tra thông tin và thử lại.');
    } finally { setBusy(false); }
  }

  return <section className="panel password-change-panel profile-password-panel" aria-labelledby="password-change-title">
    <span className="eyebrow">BẢO MẬT TÀI KHOẢN</span><h2 id="password-change-title">Đổi mật khẩu</h2>
    <p>Bạn có thể đổi mật khẩu tại đây khi cần. Sau khi đổi, vui lòng đăng nhập lại bằng mật khẩu mới.</p>
    {error && <div className="notice notice-error" role="alert"><Icon name="info" /><span>{error}</span></div>}
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="current-password">Mật khẩu hiện tại</label><input id="current-password" type="password" autoComplete="current-password" required maxLength={72} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} disabled={busy} /></div>
      <div className="field"><label htmlFor="new-password">Mật khẩu mới</label><input id="new-password" type="password" autoComplete="new-password" required maxLength={72} value={newPassword} onChange={event => setNewPassword(event.target.value)} disabled={busy} /></div>
      <div className="field"><label htmlFor="confirm-password">Nhập lại mật khẩu mới</label><input id="confirm-password" type="password" autoComplete="new-password" required maxLength={72} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={busy} /></div>
      <p className="password-change-requirements">Ít nhất 12 ký tự, có chữ thường, chữ hoa, chữ số và ký tự đặc biệt. Mật khẩu không được vượt quá 72 byte.</p>
      <div className="assignment-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Đang đổi mật khẩu...' : 'Đổi mật khẩu'}</button></div>
    </form>
  </section>;
}

export default function App() {
  const [path, navigate] = useRoute();
  const initialPath = useRef(path);
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)));
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const [dataState, setDataState] = useState({ data: null, loading: true, error: '' });
  const [dataAttempt, setDataAttempt] = useState(0);
  const loginInProgress = useRef(false);
  const logoutInProgress = useRef(false);
  const sessionRequest = useRef(null);
  const loginRequest = useRef(null);

  const cancelRequests = useCallback(() => {
    sessionRequest.current?.abort(); loginRequest.current?.abort(); sessionRequest.current = null; loginRequest.current = null; loginInProgress.current = false; setSubmitting(false);
  }, []);
  const clearSession = useCallback((message = '') => {
    cancelRequests(); sessionStorage.removeItem(TOKEN_KEY); setUser(null); setPassword(''); setLoginError(message); setSessionError(''); setCheckingSession(false); setLogoutError(''); setDataState({ data: null, loading: false, error: '' }); navigate('/dang-nhap', true);
  }, [cancelRequests, navigate]);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/system/public', { signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return;
      setConfig(data); setConfigError(false);
      const serverTime = Date.parse(data.serverTimeUtc);
      if (Number.isFinite(serverTime)) setClockOffset(serverTime - Date.now());
    }).catch(() => { if (!controller.signal.aborted) setConfigError(true); });
    return () => controller.abort();
  }, [configAttempt]);

  useEffect(() => {
    const controller = new AbortController(); sessionRequest.current = controller;
    if (!sessionStorage.getItem(TOKEN_KEY)) { setCheckingSession(false); return () => controller.abort(); }
    setCheckingSession(true); setSessionError('');
    api.get('/Auth/me', { signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setUser(readUser(data)); }).catch((error) => {
      if (controller.signal.aborted) return;
      if (isSessionRejected(error)) { clearSession('Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.'); return; }
      setSessionError(isConnectionError(error) ? 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối và thử lại.' : 'Không thể xác thực phiên đăng nhập. Vui lòng thử lại.');
    }).finally(() => { if (!controller.signal.aborted) { setCheckingSession(false); if (sessionRequest.current === controller) sessionRequest.current = null; } });
    return () => controller.abort();
  }, [sessionAttempt, clearSession]);

  useEffect(() => {
    const interceptor = api.interceptors.response.use((response) => response, (error) => {
      const token = sessionStorage.getItem(TOKEN_KEY);
      const invalidSession = error.response?.status === 401 || (error.response?.status === 403 && error.config?.url === '/Auth/me');
      if (invalidSession && error.config?.url !== '/Auth/login' && token && error.config?.headers?.Authorization === `Bearer ${token}`) clearSession('Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.');
      return Promise.reject(error);
    });
    return () => api.interceptors.response.eject(interceptor);
  }, [clearSession]);

  useEffect(() => {
    function handleStorage(event) {
      if (event.key !== TOKEN_KEY && event.key !== null) return;
      cancelRequests(); setUser(null); setPassword(''); setSessionError(''); setLoginError(''); setLogoutError(''); setSessionAttempt((attempt) => attempt + 1); setCheckingSession(Boolean(sessionStorage.getItem(TOKEN_KEY)));
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [cancelRequests]);
  useEffect(() => () => { sessionRequest.current?.abort(); loginRequest.current?.abort(); }, []);
  useEffect(() => {
    if (checkingSession || sessionError) return;
    if (!user && path !== '/dang-nhap') navigate('/dang-nhap', true);
    else if (user && path === '/doi-mat-khau') navigate('/tai-khoan', true);
    else if (user && (path === '/' || path === '/dang-nhap')) navigate(homeFor(user), true);
  }, [user, checkingSession, sessionError, path, navigate]);

  const candidatePage = isCandidateWorkspacePath(path);
  let forbidden = Boolean(user && !canOpenAccountPath(user,path));
  const isDashboard = user && path === homeFor(user);
  const isAccounts = path === '/ban-to-chuc/tai-khoan';
  const isCatalog = path === '/ban-to-chuc/danh-muc';
  const isQuestionBank = path === '/ban-to-chuc/ngan-hang-cau-hoi';
  const isCompetitionPage = path === '/ban-to-chuc/cuoc-thi' || path === '/ban-to-chuc/cuoc-thi/tao' || /^\/ban-to-chuc\/cuoc-thi\/\d+\/chinh-sua$/.test(path);
  const isExamPage = isExamWorkspacePath(path);
  const isWorkflow = isWorkflowPath(path);
  if(user?.role==='Organizer') {
    if(isWorkflow&&!canOpenWorkflow(user,path))forbidden=true;
    if(isAccounts&&!hasAccess(user,'manageUsers'))forbidden=true;
    if(isQuestionBank&&!['draft','submit','approve'].some(p=>hasAccess(user,p)))forbidden=true;
    if(isCatalog&&!['draft','submit','approve','operate','manageUsers'].some(p=>hasAccess(user,p)))forbidden=true;
    if(path==='/ban-to-chuc/cho-duyet'&&!hasAccess(user,'approve'))forbidden=true;
  }
  useEffect(() => {
    const controller = new AbortController();
    if (!user || forbidden || !isAccounts) return () => controller.abort();
    setDataState({ data: null, loading: true, error: '' });
    const endpoint = isAccounts ? '/organizer/users' : user.role === 'Organizer' ? '/organizer/overview' : '/candidate/overview';
    api.get(endpoint, { signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setDataState({ data, loading: false, error: '' }); }).catch((error) => {
      if (!controller.signal.aborted) setDataState({ data: null, loading: false, error: error.response?.status === 403 ? 'Bạn không có quyền xem thông tin này. Vui lòng tải lại trang để cập nhật vai trò.' : 'Không thể tải dữ liệu từ máy chủ. Vui lòng thử lại.' });
    });
    return () => controller.abort();
  }, [user, forbidden, isDashboard, isAccounts, dataAttempt]);

  async function handleLogin(event) {
    event.preventDefault(); if (loginInProgress.current) return;
    const account = username.trim();
    if (!account || !password) { setLoginError('Vui lòng nhập đầy đủ tài khoản và mật khẩu.'); return; }
    loginInProgress.current = true;
    const controller = new AbortController(); loginRequest.current = controller; setSubmitting(true); setLoginError('');
    try {
      const { data } = await api.post('/Auth/login', { username: account, password }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const authenticatedUser = readUser(data);
      if (typeof data.token !== 'string' || !data.token.trim()) throw new Error('Máy chủ chưa cấp phiên đăng nhập. Vui lòng thử lại.');
      sessionStorage.setItem(TOKEN_KEY, data.token); setUser(authenticatedUser); setPassword('');
      const wanted = initialPath.current;
      const permitted = canOpenAccountPath(authenticatedUser,wanted);
      navigate(permitted ? wanted : homeFor(authenticatedUser), true); initialPath.current = '/';
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoginError(isUnauthorized(error) ? 'Tài khoản hoặc mật khẩu không đúng.' : error.response?.status === 403 ? 'Tài khoản không có quyền truy cập. Vui lòng liên hệ Ban Tổ chức.' : error.response?.status === 429 ? 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ rồi thử lại.' : isConnectionError(error) ? 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối và thử lại.' : error.response?.data?.message || error.message || 'Đăng nhập không thành công. Vui lòng thử lại.');
    } finally { if (loginRequest.current === controller) { loginRequest.current = null; loginInProgress.current = false; setSubmitting(false); } }
  }

  async function logout() {
    if (logoutInProgress.current) return;
    if (!sessionStorage.getItem(TOKEN_KEY)) { clearSession(); return; }
    logoutInProgress.current = true; setLoggingOut(true); setLogoutError('');
    try { await api.post('/Auth/logout'); clearSession(); }
    catch (error) { if (isSessionRejected(error)) clearSession(); else setLogoutError('Chưa thể kết thúc phiên trên máy chủ. Vui lòng kiểm tra kết nối và đăng xuất lại.'); }
    finally { logoutInProgress.current = false; setLoggingOut(false); }
  }

  if (!user || checkingSession || sessionError) return <Login {...{ username, setUsername, password, setPassword, submitting, handleLogin, loginError, config, configError, checkingSession, sessionError, logout, clockOffset }} retryConfig={() => setConfigAttempt((attempt) => attempt + 1)} retrySession={() => setSessionAttempt((attempt) => attempt + 1)} />;
  const retry = () => setDataAttempt((attempt) => attempt + 1);
  return <AccessProvider user={user}><Shell {...{ user, path, navigate, logout, loggingOut, logoutError, clockOffset }}>{forbidden ? <StatusPage forbidden {...{ user, navigate }} /> : path.startsWith('/quan-tri') ? <SystemAdminWorkspace path={path} navigate={navigate}/> : path === '/tai-khoan' ? <Profile user={user} onPasswordChanged={() => clearSession('Đổi mật khẩu thành công. Vui lòng đăng nhập bằng mật khẩu mới.')} /> : isWorkflow ? <WorkflowHub key={path} path={path} user={user} navigate={navigate}/> : path === '/ban-to-chuc/cho-duyet' ? <ReviewQueue navigate={navigate}/> : isAccounts ? <Accounts {...dataState} retry={retry} currentUser={user} /> : isCatalog ? <CatalogWorkspace navigate={navigate} /> : isQuestionBank ? <QuestionBankWorkspace /> : candidatePage ? <CandidateWorkspace {...{ path, navigate }} /> : isExamPage ? <ExamWorkspace {...{ path, navigate }} /> : isCompetitionPage ? <CompetitionsPage {...{ path, navigate, user }} /> : isDashboard || path === '/' || path === '/dang-nhap' ? user.role==='Organizer' ? <WorkflowHub path="/ban-to-chuc" user={user} navigate={navigate}/> : <CandidatePortal navigate={navigate}/> : <StatusPage user={user} navigate={navigate} />}</Shell></AccessProvider>;
}
