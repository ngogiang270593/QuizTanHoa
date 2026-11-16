import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isConnectionError } from './api.js';
import './CandidateAttempt.css';
import { formatVietnamDateTime } from './dateTime.js';

const ROOT = '/thi-sinh/cuoc-thi';

function message(error, fallback) {
  if (isConnectionError(error)) return 'Không thể kết nối máy chủ. Câu trả lời chưa được xác nhận lưu; hãy kiểm tra kết nối và thử lại.';
  return error.response?.data?.message || fallback;
}

function formatTime(value) {
  if (!value) return '—';
  return formatVietnamDateTime(value);
}

function formatElapsed(value) {
  if (value == null) return '?';
  const seconds = Math.floor(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}

function Loading() {
  return <div className="attempt-loading" role="status"><span className="loading-spinner" aria-hidden="true" />Đang tải lượt thi...</div>;
}

export default function CandidateAttempt({ competitionId, navigate, attemptTab }) {
  const [attempt, setAttempt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [syncStatus, setSyncStatus] = useState('saved');
  const [syncError, setSyncError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const { tabId, ready: tabReady } = attemptTab;
  const [leaseLost, setLeaseLost] = useState(false);
  const queues = useRef(new Map());
  const revisions = useRef(new Map());
  const activeSaves = useRef(new Set());
  const failedSaves = useRef(new Set());
  const questionsRef = useRef([]);
  const expiredReloaded = useRef(false);
  const attemptUrl = `/candidate/competitions/${competitionId}/attempt`;
  const attemptConfig = useMemo(() => ({ headers: { 'X-Quiz-Attempt-Tab': tabId || '' } }), [tabId]);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(attemptUrl, { signal, ...attemptConfig });
      if (signal.aborted) return;
      setAttempt(data);
      setLeaseLost(false);
      questionsRef.current = data.questions || [];
      setSelectedId(current => data.questions?.some(question => question.id === current) ? current : data.questions?.[0]?.id ?? null);
      setServerOffset(Date.parse(data.serverNowUtc) - Date.now());
      activeSaves.current.clear();
      failedSaves.current.clear();
      setSyncStatus('saved');
      setSyncError('');
    } catch (failure) {
      if (!signal.aborted) setError(failure.response?.status === 404 ? 'Bạn chưa được phân công hoặc cuộc thi chưa công bố. Không thể truy cập lượt thi này.' : message(failure, 'Không thể tải lượt thi. Vui lòng thử lại.'));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [attemptUrl, tabId]);

  useEffect(() => {
    if (!tabReady) return undefined;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load, tabReady]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const start = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.post(`${attemptUrl}/start`, undefined, attemptConfig);
      setAttempt(data);
      setLeaseLost(false);
      questionsRef.current = data.questions || [];
      setSelectedId(data.questions?.[0]?.id ?? null);
      setServerOffset(Date.parse(data.serverNowUtc) - Date.now());
      activeSaves.current.clear();
      failedSaves.current.clear();
      setSyncStatus('saved');
      setSyncError('');
    } catch (failure) {
      setError(message(failure, 'Chưa thể bắt đầu lượt thi. Vui lòng thử lại.'));
    }
  }, [attemptConfig, attemptUrl]);

  const updateQuestion = useCallback((questionId, patch) => {
    const updated = questionsRef.current.map(question => question.id === questionId ? { ...question, ...patch } : question);
    questionsRef.current = updated;
    setAttempt(current => current ? { ...current, questions: updated, answeredCount: updated.filter(question => question.answer).length } : current);
    const revision = (revisions.current.get(questionId) || 0) + 1;
    revisions.current.set(questionId, revision);
    activeSaves.current.add(questionId);
    setSyncStatus('saving');
    setSyncError('');
    const previous = queues.current.get(questionId) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const value = updated.find(question => question.id === questionId);
      await api.put(`${attemptUrl}/questions/${questionId}`, {
        answer: value.answer || null,
        isMarked: value.isMarked,
      }, attemptConfig);
      if (revisions.current.get(questionId) === revision) {
        activeSaves.current.delete(questionId);
        failedSaves.current.delete(questionId);
        setSyncStatus(activeSaves.current.size ? 'saving' : failedSaves.current.size ? 'unsynced' : 'saved');
        if (!failedSaves.current.size) setSyncError('');
      }
    }).catch(failure => {
      if (revisions.current.get(questionId) === revision) {
        activeSaves.current.delete(questionId);
        failedSaves.current.add(questionId);
        setSyncStatus(activeSaves.current.size ? 'saving' : 'unsynced');
        setSyncError(message(failure, 'Máy chủ chưa xác nhận lưu câu trả lời. Vui lòng thử lại.'));
      }
      throw failure;
    });
    queues.current.set(questionId, pending);
    void pending.catch(() => {});
  }, [attemptConfig, attemptUrl]);

  function retrySync() {
    for (const question of questionsRef.current) {
      updateQuestion(question.id, { answer: question.answer, isMarked: question.isMarked });
    }
  }

  useEffect(() => {
    if (attempt?.attemptStatus !== 'InProgress') return undefined;
    let active = true;
    const renew = async () => {
      try {
        await api.post(`${attemptUrl}/lease`, undefined, attemptConfig);
        if (active) setLeaseLost(false);
      } catch (failure) {
        if (active && [401, 403, 409].includes(failure.response?.status)) {
          setLeaseLost(true);
          setError(message(failure, 'Bài thi đang được mở ở tab hoặc phiên khác.'));
        }
      }
    };
    void renew();
    const heartbeat = setInterval(renew, attempt.leaseHeartbeatMilliseconds || 10000);
    return () => { active = false; clearInterval(heartbeat); };
  }, [attempt?.attemptId, attempt?.attemptStatus, attemptConfig, attemptUrl]);

  useEffect(() => {
    const retryWhenOnline = () => {
      for (const question of questionsRef.current) {
        if (failedSaves.current.has(question.id)) updateQuestion(question.id, { answer: question.answer, isMarked: question.isMarked });
      }
    };
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  }, [updateQuestion]);

  const countdown = attempt?.deadlineAtUtc
    ? Math.max(0, Math.ceil((Date.parse(attempt.deadlineAtUtc) - (now + serverOffset)) / 1000))
    : 0;
  const timerText = countdown >= 3600
    ? `${Math.floor(countdown / 3600).toString().padStart(2, '0')}:${Math.floor((countdown % 3600) / 60).toString().padStart(2, '0')}:${(countdown % 60).toString().padStart(2, '0')}`
    : `${Math.floor(countdown / 60).toString().padStart(2, '0')}:${(countdown % 60).toString().padStart(2, '0')}`;
  const timedOut = attempt?.attemptStatus === 'InProgress' && countdown === 0;

  useEffect(() => {
    if (!timedOut || expiredReloaded.current) return;
    expiredReloaded.current = true;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [timedOut, load]);

  async function submit() {
    const questions = questionsRef.current;
    const unanswered = questions.filter(question => !question.answer).length;
    if (!window.confirm(`Còn ${unanswered} câu chưa trả lời. Bạn có chắc chắn muốn nộp bài không? Sau khi nộp, không thể sửa câu trả lời.`)) return;
    setError('');
    setSyncError('');
    try {
      await Promise.all([...queues.current.values()]);
      const { data } = await api.post(`${attemptUrl}/submit`, undefined, attemptConfig);
      setAttempt(data);
      setLeaseLost(false);
      questionsRef.current = data.questions || [];
      setSyncStatus('saved');
      setServerOffset(Date.parse(data.serverNowUtc) - Date.now());
    } catch (failure) {
      setError(message(failure, 'Chưa thể nộp bài. Câu trả lời vẫn được giữ để bạn thử lại.'));
    }
  }

  if (loading && !attempt) return <section className="panel attempt-panel"><Loading /></section>;
  if (error && !attempt) return <section className="panel attempt-panel"><div className="attempt-message attempt-error" role="alert">{error}</div><button className="button button-secondary" onClick={() => { const controller = new AbortController(); void load(controller.signal); }}>Thử tải lại</button><button className="button button-secondary" onClick={() => navigate(ROOT)}>Về Cuộc thi của tôi</button></section>;
  if (!attempt) return null;

  const questions = attempt.questions || [];
  const activeQuestion = questions.find(question => question.id === selectedId) || questions[0];
  const answeredCount = questions.filter(question => question.answer).length;
  const status = timedOut ? 'Expired' : attempt.attemptStatus;
  const editable = status === 'InProgress' && !timedOut && !leaseLost;

  return <div className="candidate-attempt">
    <button className="text-button attempt-back" type="button" onClick={() => navigate(`${ROOT}/${competitionId}/huong-dan`)}>← Về hướng dẫn cuộc thi</button>
    <section className="panel attempt-panel">
      {status === 'NotStarted' ? <>
        <h2>Sẵn sàng bắt đầu làm bài</h2>
        <p>Thời lượng đề: <strong>{attempt.assignedExam?.durationMinutes || '—'} phút</strong>. Đồng hồ đếm ngược chỉ bắt đầu sau khi máy chủ xác nhận; tải lại trang không làm đặt lại thời gian.</p>
        {error && <div className="attempt-message attempt-error" role="alert">{error}</div>}
        <button className="button button-primary" type="button" onClick={start} disabled={!attempt.canStart}>{attempt.canStart ? 'Bắt đầu' : attempt.startBlockedReason || 'Chưa thể bắt đầu'}</button>
      </> : status === 'Submitted' && attempt.submittedAtUtc === attempt.deadlineAtUtc ? <>
        <h2>Đã hết thời gian làm bài</h2><p>Máy chủ đã tự chốt các câu trả lời được lưu đúng hạn lúc <strong>{formatTime(attempt.submittedAtUtc)}</strong>.</p>{attempt.correctAnswersCount != null && <div className="attempt-result-summary"><p>S&#7889; c&#226;u &#273;&#250;ng: <strong>{attempt.correctAnswersCount}/{attempt.totalQuestionCount}</strong></p><p>Th&#7901;i gian ho&#224;n th&#224;nh: <strong>{formatElapsed(attempt.durationMilliseconds)}</strong></p></div>}
        <p>Điểm và đáp án sẽ hiển thị theo lịch công bố của Ban Tổ chức.</p><button className="button button-secondary" onClick={() => navigate(ROOT)}>Về Cuộc thi của tôi</button>
      </> : status === 'Submitted' ? <>
        <div className="attempt-complete-icon" aria-hidden="true">✓</div><h2>Đã nộp bài thành công</h2>
        <p>Thời điểm nộp: <strong>{formatTime(attempt.submittedAtUtc)}</strong></p>{attempt.correctAnswersCount != null && <div className="attempt-result-summary"><p>S&#7889; c&#226;u &#273;&#250;ng: <strong>{attempt.correctAnswersCount}/{attempt.totalQuestionCount}</strong></p><p>Th&#7901;i gian ho&#224;n th&#224;nh: <strong>{formatElapsed(attempt.durationMilliseconds)}</strong></p></div>}
        <p>Bài thi đã được máy chủ chốt. Điểm và đáp án sẽ hiển thị theo lịch công bố của Ban Tổ chức.</p>
        <button className="button button-secondary" onClick={() => navigate(ROOT)}>Về Cuộc thi của tôi</button>
      </> : status === 'Expired' ? <>
        <h2>Đã hết thời gian làm bài</h2><p>Lượt thi đã kết thúc theo thời hạn do máy chủ xác nhận. Thời điểm bắt đầu: {formatTime(attempt.startedAtUtc)}.</p>
        <button className="button button-secondary" onClick={() => navigate(ROOT)}>Về Cuộc thi của tôi</button>
      </> : <>
        <div className="attempt-header"><div><span className="eyebrow">ĐANG LÀM BÀI</span><h2>Lượt thi</h2></div><div className={`attempt-timer ${countdown <= 300 ? 'attempt-timer-urgent' : ''}`} role="timer" aria-label={`Thời gian còn lại ${timerText}`}><span>Thời gian còn lại</span><strong>{timerText}</strong></div></div>
        <div className="attempt-progress"><span>Đã trả lời <strong>{answeredCount}/{questions.length}</strong> câu</span><span className={`attempt-sync attempt-sync-${syncStatus}`} role="status">{syncStatus === 'saved' ? 'Đã lưu' : syncStatus === 'saving' ? 'Đang đồng bộ...' : 'Chưa đồng bộ'}</span>{syncStatus === 'unsynced' && <button className="text-button" type="button" onClick={retrySync}>Thử đồng bộ lại</button>}</div>
        {(error || syncError) && <div className="attempt-message attempt-error" role="alert">{error || syncError}</div>}
        <div className="attempt-layout">
          <nav className="attempt-question-nav" aria-label="Danh sách câu hỏi">{questions.map(question => <button key={question.id} type="button" className={`attempt-question-jump ${question.id === activeQuestion?.id ? 'active' : ''} ${question.answer ? 'answered' : ''} ${question.isMarked ? 'marked' : ''}`} onClick={() => setSelectedId(question.id)} aria-label={`Câu ${question.position}${question.answer ? ', đã trả lời' : ', chưa trả lời'}${question.isMarked ? ', cần xem lại' : ''}`}>{question.position}{question.isMarked && <span aria-hidden="true">★</span>}</button>)}</nav>
          {activeQuestion && <article className="attempt-question"><span className="attempt-question-number">Câu {activeQuestion.position}</span><h3>{activeQuestion.content}</h3><fieldset disabled={!editable}><legend className="visually-hidden">Chọn một phương án trả lời</legend>{activeQuestion.options.map(option => <label className={`attempt-option ${activeQuestion.answer === option.key ? 'selected' : ''}`} key={option.key}><input type="radio" name={`question-${activeQuestion.id}`} value={option.key} checked={activeQuestion.answer === option.key} onChange={() => updateQuestion(activeQuestion.id, { answer: option.key })} /><span><strong>{option.key}</strong>{option.text}</span></label>)}</fieldset><label className="attempt-mark"><input type="checkbox" checked={activeQuestion.isMarked} disabled={!editable} onChange={event => updateQuestion(activeQuestion.id, { isMarked: event.target.checked })} />Đánh dấu câu cần xem lại</label><div className="attempt-question-actions"><button type="button" className="button button-secondary" onClick={() => setSelectedId(questions[Math.max(0, questions.findIndex(question => question.id === activeQuestion.id) - 1)]?.id)} disabled={questions[0]?.id === activeQuestion.id}>Câu trước</button><button type="button" className="button button-secondary" onClick={() => setSelectedId(questions[Math.min(questions.length - 1, questions.findIndex(question => question.id === activeQuestion.id) + 1)]?.id)} disabled={questions[questions.length - 1]?.id === activeQuestion.id}>Câu tiếp</button></div></article>}
        </div>
        <div className="attempt-footer"><span>Thời hạn: {formatTime(attempt.deadlineAtUtc)}</span><button type="button" className="button button-primary" onClick={submit} disabled={!editable || syncStatus !== 'saved'}>Nộp bài</button></div>
      </>}
    </section>
  </div>;
}
