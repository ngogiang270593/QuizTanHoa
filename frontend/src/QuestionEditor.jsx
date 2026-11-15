import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { answerLabel, createQuestionDraft, emptyQuestion, QUESTION_TYPES, questionErrors, questionPayload, trueFalseOptions } from './questionDraft.mjs';
import './QuestionEditor.css';
import {api} from './api.js';
import {questionTopicLabel} from './questionLibrary.mjs';

export { emptyQuestion } from './questionDraft.mjs';

export function QuestionIcon({ name, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'check' ? <path d="m5 12 4 4 10-10" /> : name === 'close' ? <path d="m6 6 12 12M18 6 6 18" /> : name === 'plus' ? <path d="M12 5v14M5 12h14" /> : name === 'edit' ? <><path d="m16 3 5 5L9 20l-6 1 1-6L16 3Z" /><path d="m14 5 5 5" /></> : name === 'trash' ? <><path d="M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6m4-6v6" /></> : <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>;
}

export function QuestionForm({ question, onSave, onCancel, onDirty = () => {}, disabled = false, saving = false, error = '', context = 'Câu hỏi của đề' }) {
  const [fields, setFields] = useState(() => createQuestionDraft(question));
  const [topics, setTopics] = useState([]);
  const [topicError, setTopicError] = useState('');
  useEffect(() => { const c = new AbortController(); api.get('/organizer/topics', {signal:c.signal}).then(({data}) => {if(!c.signal.aborted)setTopics(data);}).catch(() => {if(!c.signal.aborted)setTopicError('Không tải được chủ đề. Vui lòng đóng và mở lại biểu mẫu.');}); return () => c.abort(); }, []);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [extraOpen, setExtraOpen] = useState(Boolean(question.explanation || question.source || question.requiresSourceReview || question.sourceReviewed));
  const dialog = useRef(null), form = useRef(null), errorBox = useRef(null), cancelDiscard = useRef(null);
  const initial = useRef(JSON.stringify(createQuestionDraft(question)));
  const typeDrafts = useRef({});
  const latest = useRef({});
  const operation = useRef(false);
  const titleId = useId(), descriptionId = useId();
  const dirty = JSON.stringify(fields) !== initial.current;
  const locked = disabled || saving || submitting;
  latest.current = { dirty, locked, onCancel };

  useEffect(() => {
    const node = dialog.current, previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.showModal();
    const frame = requestAnimationFrame(() => form.current?.querySelector('#question-content')?.focus());
    const beforeUnload = event => { if (latest.current.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      cancelAnimationFrame(frame); window.removeEventListener('beforeunload', beforeUnload);
      if (node.open) node.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => { if (error || submitError) errorBox.current?.focus(); }, [error, submitError]);
  useEffect(() => { if (discarding) cancelDiscard.current?.focus(); }, [discarding]);

  function close() {
    if (latest.current.locked) return;
    if (latest.current.dirty) setDiscarding(true); else latest.current.onCancel();
  }
  function change(key, value) {
    if (locked) return;
    setFields(current => ({ ...current, [key]: value, ...(['sourceReviewed', 'points', 'group', 'isScenario', 'requiresSourceReview'].includes(key) ? {} : { sourceReviewed: false }) }));
    setErrors({}); setSubmitError(''); onDirty();
  }
  function changeType(type) {
    if (locked || type === fields.type) return;
    typeDrafts.current[fields.type] = { options: fields.options.map(o => ({ ...o })), correctAnswer: fields.correctAnswer };
    const stored = typeDrafts.current[type] || (type === 'TrueFalse' ? { options: trueFalseOptions(), correctAnswer: '' } : { options: emptyQuestion().options, correctAnswer: '' });
    setFields(current => ({ ...current, type, ...stored, sourceReviewed: false }));
    setErrors({}); setSubmitError(''); onDirty();
  }
  function changeOption(key, text) { change('options', fields.options.map(option => option.key === key ? { ...option, text } : option)); }
  function addOption() {
    const key = ['A', 'B', 'C', 'D', 'E', 'F'].find(key => !fields.options.some(option => option.key === key));
    if (key && fields.options.length < 6) change('options', [...fields.options, { key, text: '' }]);
  }
  function removeOption(key) {
    if (locked || fields.options.length <= 2) return;
    setFields(current => ({ ...current, options: current.options.filter(option => option.key !== key), correctAnswer: current.correctAnswer === key ? '' : current.correctAnswer, sourceReviewed: false }));
    setErrors({}); setSubmitError(''); onDirty();
  }
  async function submit(event, draft = false) {
    event?.preventDefault();
    if (locked || operation.current) return;
    const nextErrors = draft ? {} : questionErrors(fields);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      requestAnimationFrame(() => {
        const field = [...form.current.querySelectorAll('[data-question-field]')].find(input => nextErrors[input.dataset.questionField]);
        if (field) field.focus(); else form.current.querySelector('#question-answer input')?.focus();
      });
      return;
    }
    operation.current = true; setSubmitting(true); setSubmitError('');
    try { await onSave(questionPayload(fields)); }
    catch (failure) { setSubmitError(failure.response?.data?.message || 'Chưa lưu được câu hỏi. Nội dung đang nhập vẫn được giữ lại.'); }
    finally { operation.current = false; setSubmitting(false); }
  }
  const checks = questionErrors(fields);
  const optionsComplete = !Object.keys(checks).some(key => key === 'options' || key.startsWith('option:'));
  const serverError = error || submitError;
  const fieldError = key => errors[key] && <span className="qe-field-error" id={`qe-error-${key.replace(/[^\w-]/g, '-')}`}>{errors[key]}</span>;
  const description = key => errors[key] ? `qe-error-${key.replace(/[^\w-]/g, '-')}` : undefined;

  return createPortal(<dialog ref={dialog} className="question-editor-dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (discarding) setDiscarding(false); else close(); }}
    onClick={event => { if (event.target !== dialog.current) return; const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); }}>
    <form ref={form} className="qe-form" onSubmit={submit} noValidate onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.current.requestSubmit(); } }}>
      <header className="qe-header"><div className="qe-heading-icon"><QuestionIcon name="edit" size={22} /></div><div className="qe-heading"><span>{context}</span><h2 id={titleId}>{fields.id ? 'Chỉnh sửa câu hỏi' : 'Tạo câu hỏi mới'}</h2><p id={descriptionId}>Soạn nội dung, chọn đáp án đúng và kiểm tra trước khi lưu.</p></div><button type="button" className="qe-close" aria-label="Đóng trình soạn câu hỏi" disabled={locked} onClick={close}><QuestionIcon name="close" size={22} /></button></header>
      {discarding && <div className="qe-discard" role="alert"><div><strong>Bạn có thay đổi chưa lưu</strong><p>Đóng sẽ bỏ nội dung vừa chỉnh sửa trong lần này.</p></div><button ref={cancelDiscard} type="button" className="button button-secondary" onClick={() => setDiscarding(false)}>Tiếp tục soạn</button><button type="button" className="button button-primary" onClick={() => onCancel()}>Bỏ thay đổi</button></div>}
      <div className="qe-body">
        <div className="qe-main">
          {serverError && <div ref={errorBox} tabIndex={-1} className="qe-server-error" role="alert">{serverError}</div>}
          {Object.keys(errors).length > 0 && <div className="qe-validation" role="alert">Còn {Object.keys(errors).length} mục cần hoàn thiện. Bạn có thể sửa các mục bên dưới hoặc lưu nháp để tiếp tục sau.</div>}
          <section className="qe-section"><div className="qe-section-title"><span>01</span><h3>Nội dung câu hỏi</h3></div>
            <fieldset className="qe-type-options"><legend>Loại câu hỏi</legend>{Object.entries(QUESTION_TYPES).map(([value, label]) => <label className={fields.type === value ? 'selected' : ''} key={value}><input type="radio" name="question-type" value={value} checked={fields.type === value} disabled={locked} onChange={() => changeType(value)} /><span>{label}</span></label>)}</fieldset>
            <div className="qe-field"><div className="qe-label-row"><label htmlFor="question-content">{fields.type === 'TrueFalse' ? 'Nội dung phát biểu' : 'Nội dung câu hỏi'} <span>*</span></label><small>{fields.content.length.toLocaleString('vi-VN')} / 5.000</small></div><textarea id="question-content" data-question-field="content" rows={4} maxLength={5000} value={fields.content} onChange={event => change('content', event.target.value)} disabled={locked} aria-invalid={Boolean(errors.content)} aria-describedby={description('content')} placeholder={fields.type === 'TrueFalse' ? 'Nhập phát biểu cần đánh giá là đúng hay sai…' : 'Nhập nội dung câu hỏi rõ ràng, dễ hiểu…'} />{fieldError('content')}</div>
            <div className="qe-config-row"><div className="qe-field"><label htmlFor="question-points">Điểm câu hỏi <span>*</span></label><input id="question-points" data-question-field="points" type="number" min="0.01" max="1000" step="any" inputMode="decimal" value={fields.points} onChange={event => change('points', event.target.value)} disabled={locked} aria-invalid={Boolean(errors.points)} aria-describedby={description('points')} />{fieldError('points')}</div></div>
            <label className="qe-checkbox"><input type="checkbox" checked={Boolean(fields.isScenario)} disabled={locked} onChange={event => change('isScenario', event.target.checked)} /><span>Đánh dấu là câu hỏi tình huống</span></label>
          </section>
          <section className="qe-section"><div className="qe-section-title"><span>02</span><h3>{fields.type === 'TrueFalse' ? 'Chọn đáp án cho phát biểu' : 'Phương án & đáp án đúng'}</h3></div><p className="qe-section-hint">{fields.type === 'TrueFalse' ? 'Chọn Đúng hoặc Sai để xác định đáp án của câu hỏi.' : 'Nhập các phương án, rồi chọn nút tròn tại phương án đúng. Chỉ có một đáp án đúng.'}</p>
            <fieldset id="question-answer" className={fields.type === 'TrueFalse' ? 'qe-truefalse' : 'qe-options'} aria-describedby={description('answer')}><legend className="qe-visually-hidden">Chọn một đáp án đúng</legend>
              {fields.options.map((option, index) => <div className={`qe-option ${fields.correctAnswer === option.key ? 'is-correct' : ''} ${errors[`option:${option.key}`] ? 'has-error' : ''}`} key={option.key}>
                <div className="qe-option-head"><label className="qe-answer-choice"><input id={`question-answer-${option.key}`} data-question-field="answer" type="radio" name="question-correct-answer" value={option.key} checked={fields.correctAnswer === option.key} onChange={() => change('correctAnswer', option.key)} disabled={locked} /><span className="qe-option-key">{answerLabel(option.key)}</span><span className="qe-choice-caption">{fields.correctAnswer === option.key ? <><QuestionIcon name="check" size={14} /> Đáp án đúng</> : fields.type === 'TrueFalse' ? 'Chọn đáp án này' : 'Chọn làm đáp án đúng'}</span></label>{fields.type !== 'TrueFalse' && fields.options.length > 2 && <button type="button" className="qe-remove-option" aria-label={`Xóa phương án ${option.key}`} title={`Xóa phương án ${option.key}`} disabled={locked} onClick={() => removeOption(option.key)}><QuestionIcon name="close" size={16} /></button>}</div>
                {fields.type !== 'TrueFalse' && <><label className="qe-visually-hidden" htmlFor={`question-option-${option.key}`}>Nội dung phương án {option.key}</label><textarea id={`question-option-${option.key}`} data-question-field={`option:${option.key}`} rows={2} maxLength={2000} placeholder={`Nhập nội dung phương án ${option.key}…`} value={option.text} disabled={locked} onChange={event => changeOption(option.key, event.target.value)} aria-invalid={Boolean(errors[`option:${option.key}`])} aria-describedby={description(`option:${option.key}`)} />{fieldError(`option:${option.key}`)}</>}
              </div>)}
            </fieldset>
            {fieldError('options')}{fieldError('answer')}
            <div className="qe-answer-summary" aria-live="polite"><span>Đáp án đúng: <strong>{answerLabel(fields.correctAnswer)}</strong></span>{fields.type === 'SingleChoice' && <button type="button" className="qe-add-option" disabled={locked || fields.options.length >= 6} onClick={addOption}><QuestionIcon name="plus" size={15} />Thêm phương án <small>({fields.options.length}/6)</small></button>}</div>
          </section>
          <div className="qe-field"><label htmlFor="question-topic">Chủ đề</label><select id="question-topic" value={fields.topic || ''} disabled={locked || Boolean(topicError)} onChange={event => change('topic', event.target.value)}><option value="">Chưa phân chủ đề</option>{fields.topic && !topics.some(t => t.name === fields.topic) && <option value={fields.topic}>{fields.topic}</option>}{topics.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}</select>{topicError ? <small role="alert">{topicError}</small> : <small>Quản lý chủ đề tại Danh mục → Chủ đề.</small>}</div><details className="qe-extra" open={extraOpen} onToggle={event => { if (event.currentTarget.open !== extraOpen) setExtraOpen(event.currentTarget.open); }}><summary>Giải thích & nguồn tham khảo <span>Không bắt buộc</span></summary><div className="qe-extra-body"><div className="qe-field"><label htmlFor="question-explanation">Giải thích đáp án</label><textarea id="question-explanation" rows={3} maxLength={5000} value={fields.explanation} onChange={event => change('explanation', event.target.value)} disabled={locked} placeholder="Giải thích vì sao phương án đã chọn là đúng…" /></div><div className="qe-field"><label htmlFor="question-source">Nguồn đối chiếu</label><textarea id="question-source" rows={2} maxLength={2000} value={fields.source} onChange={event => change('source', event.target.value)} disabled={locked} placeholder="Tên văn bản, điều khoản hoặc tài liệu tham khảo…" /></div><label className="qe-checkbox"><input type="checkbox" checked={Boolean(fields.requiresSourceReview)} disabled={locked} onChange={event => change('requiresSourceReview', event.target.checked)} /><span>Cần đối chiếu nguồn</span></label><label className="qe-checkbox"><input type="checkbox" checked={Boolean(fields.sourceReviewed)} disabled={locked || !fields.source.trim()} onChange={event => change('sourceReviewed', event.target.checked)} /><span>Đã kiểm tra và đối chiếu nguồn</span></label></div></details>
        </div>
        <aside className="qe-preview" aria-label="Xem trước câu hỏi"><div className="qe-preview-heading"><QuestionIcon name="eye" size={18} /><strong>Xem trước</strong><span>Ban Tổ chức</span></div><div className="qe-preview-card"><div className="qe-preview-tags"><span>{QUESTION_TYPES[fields.type]}</span><span>{fields.points || 0} điểm</span></div><h3>{fields.content.trim() || 'Nội dung câu hỏi sẽ hiển thị tại đây…'}</h3><ul>{fields.options.map(option => <li className={fields.correctAnswer === option.key ? 'selected' : ''} key={option.key}><span>{answerLabel(option.key)}</span><p>{fields.type === 'TrueFalse' ? (option.key === 'True' ? 'Phát biểu đúng' : 'Phát biểu sai') : option.text.trim() || 'Chưa nhập phương án'}</p>{fields.correctAnswer === option.key && <QuestionIcon name="check" size={15} />}</li>)}</ul><div className="qe-preview-answer">Đáp án: <strong>{answerLabel(fields.correctAnswer)}</strong></div></div><div className="qe-checklist"><strong>Kiểm tra nhanh</strong>{[[!checks.content, 'Đã có nội dung câu hỏi'], [optionsComplete, 'Phương án đã đầy đủ'], [!checks.answer, 'Đã chọn đáp án đúng']].map(([done, label]) => <div className={done ? 'done' : ''} key={label}><span>{done ? <QuestionIcon name="check" size={12} /> : '·'}</span>{label}</div>)}</div><p className="qe-preview-note">Đáp án đúng chỉ hiển thị trong khu vực Ban Tổ chức. Thí sinh không nhìn thấy đáp án này khi làm bài.</p></aside>
      </div>
      <footer className="qe-footer"><div className="qe-save-state"><span className={dirty ? 'dirty' : ''} />{locked ? 'Đang lưu câu hỏi…' : dirty ? 'Có thay đổi chưa lưu' : 'Nội dung chưa thay đổi'}<small>Ctrl + Enter để lưu</small></div><div className="qe-footer-actions"><button type="button" className="button button-secondary" disabled={locked} onClick={close}>Hủy</button><button type="button" className="qe-draft-button" title="Lưu nội dung đang nhập để hoàn thiện sau" disabled={locked || !dirty} onClick={event => submit(event, true)}>Lưu nháp</button><button className="button button-primary" type="submit" disabled={locked}><QuestionIcon name="check" />{locked ? 'Đang lưu…' : 'Lưu câu hỏi'}</button></div></footer>
    </form>
  </dialog>, document.body);
}

export function QuestionCard({ question, index, linkedCount, disabled, busy, confirming, onEdit, onDelete, onConfirmDelete, onCancelDelete, selectable, selected, onSelectionChange }) {
  return <li className={`question-card ${selected ? "qc-selected" : ""}`}><div className="qc-header"><div className="qc-tags">{selectable && <input type="checkbox" aria-label={`Chọn câu ${index + 1}`} checked={Boolean(selected)} disabled={disabled} onChange={event => onSelectionChange(event.target.checked)} />}<strong>CÂU {index + 1}</strong><span>{QUESTION_TYPES[question.type] || question.type}</span><span>{questionTopicLabel(question)}</span>{question.isScenario && <span>Tình huống</span>}</div><span className="qc-points">{question.points} điểm</span></div><p className="qc-content">{question.content || 'Chưa nhập nội dung câu hỏi'}</p><details className="qc-details"><summary>Xem nội dung và phương án <span className={question.correctAnswer ? 'qc-correct' : 'qc-incomplete'}>{question.correctAnswer ? `Đáp án: ${answerLabel(question.correctAnswer)}` : 'Chưa chọn đáp án'}</span></summary><div>{question.content?.length > 160 && <p className="qc-full-content">{question.content}</p>}<ul>{(question.options || []).map(option => <li className={option.key === question.correctAnswer ? 'correct' : ''} key={option.key}><strong>{answerLabel(option.key)}</strong><span>{option.text || 'Chưa nhập nội dung'}</span>{option.key === question.correctAnswer && <QuestionIcon name="check" size={16} />}</li>)}</ul></div></details><div className="qc-footer"><span>{linkedCount != null ? `${linkedCount} bản nháp liên kết` : question.correctAnswer ? 'Đã có đáp án đúng' : 'Cần hoàn thiện câu hỏi'}</span><div className="qc-actions">{confirming ? <><span>Xóa câu hỏi này?</span><button type="button" className="qc-delete-confirm" disabled={busy} onClick={onConfirmDelete}>Xác nhận xóa</button><button type="button" disabled={busy} onClick={onCancelDelete}>Hủy</button></> : <><button type="button" disabled={disabled} onClick={onEdit}><QuestionIcon name="edit" size={15} />Sửa câu hỏi</button><button type="button" className="qc-delete" disabled={disabled} onClick={onDelete}><QuestionIcon name="trash" size={15} />Xóa</button></>}</div></div></li>;
}
