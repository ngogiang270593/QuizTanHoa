import { useEffect, useId, useRef, useState } from 'react';
import { formatVietnamDateTime, parseVietnamDateTimeInput } from './dateTime.js';
import './DateTimePicker.css';

const pad = value => String(value).padStart(2, '0');
const weekdays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
function read(value) {
  const iso = parseVietnamDateTimeInput(value) || parseVietnamDateTimeInput(formatVietnamDateTime(new Date().toISOString()));
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)), hour: Number(iso.slice(11, 13)), minute: Number(iso.slice(14, 16)), second: Number(iso.slice(17, 19)) };
}
const display = p => `${pad(p.day)}/${pad(p.month)}/${String(p.year).padStart(4, '0')} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;

export default function DateTimePicker({ id, label, value, onChange, disabled, required = false }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(() => read(value));
  const [view, setView] = useState(() => ({ year: draft.year, month: draft.month }));
  const root = useRef(null), trigger = useRef(null), popup = useRef(null);
  const popupId = useId();
  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector('[aria-pressed="true"]')?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function toggle() {
    if (!open) { const current = read(value); setDraft(current); setView({ year: current.year, month: current.month }); }
    setOpen(current => !current);
  }
  function month(offset) {
    const date = new Date(Date.UTC(view.year, view.month - 1 + offset, 1));
    if (date.getUTCFullYear() >= 1900 && date.getUTCFullYear() <= 9999) setView({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  }
  function apply() { onChange(display(draft)); setOpen(false); trigger.current?.focus(); }
  const offset = (new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(view.year, view.month, 0)).getUTCDate();
  const valid = parseVietnamDateTimeInput(display(draft));
  return <div ref={root} className="date-time-picker" onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <div className="dtp-input"><input id={id} type="text" inputMode="text" autoComplete="off" placeholder="dd/MM/yyyy HH:mm:ss" maxLength={19} required={required} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} aria-invalid={Boolean(value && !parseVietnamDateTimeInput(value))} /><button ref={trigger} type="button" disabled={disabled} aria-label={`Chọn ${label}`} aria-expanded={open} aria-controls={popupId} aria-haspopup="dialog" onClick={toggle}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2m-8 3h2" /></svg></button></div>
    {open && <div ref={popup} id={popupId} className="dtp-popup" role="dialog" aria-label={`Chọn ${label}`}>
      <div className="dtp-heading"><strong>{label}</strong><span>Giờ Việt Nam · UTC+7</span></div>
      <div className="dtp-month"><button type="button" aria-label="Tháng trước" onClick={() => month(-1)}>‹</button><label><span className="visually-hidden">Tháng</span><select value={view.month} onChange={e => setView(current => ({ ...current, month: Number(e.target.value) }))}>{Array.from({length:12}, (_, i) => <option key={i} value={i + 1}>Tháng {i + 1}</option>)}</select></label><label><span className="visually-hidden">Năm</span><select value={view.year} onChange={e => setView(current => ({ ...current, year: Number(e.target.value) }))}>{[...new Set([...Array.from({length:301}, (_, i) => 1900 + i), view.year])].sort((a,b)=>a-b).map(year => <option key={year} value={year}>{year}</option>)}</select></label><button type="button" aria-label="Tháng sau" onClick={() => month(1)}>›</button></div>
      <div className="dtp-calendar">{weekdays.map(day => <span className="dtp-weekday" key={day}>{day}</span>)}{Array.from({length:offset}, (_, i) => <span key={`blank-${i}`} />)}{Array.from({length:days}, (_, i) => { const day = i + 1, selected = draft.day === day && draft.month === view.month && draft.year === view.year; return <button type="button" key={day} className={selected ? 'selected' : ''} aria-label={`${pad(day)}/${pad(view.month)}/${view.year}`} aria-pressed={selected} onClick={() => setDraft(current => ({ ...current, day, month: view.month, year: view.year }))}>{day}</button>; })}</div>
      <div className="dtp-time">{[['hour','Giờ',23],['minute','Phút',59],['second','Giây',59]].map(([key, title, max]) => <label key={key}>{title}<select value={draft[key]} onChange={e => setDraft(current => ({ ...current, [key]: Number(e.target.value) }))}>{Array.from({length:max + 1}, (_, i) => <option key={i} value={i}>{pad(i)}</option>)}</select></label>)}</div>
      <output className="dtp-preview">{display(draft)}</output><div className="dtp-actions"><button type="button" className="text-button" onClick={() => { const current = read(''); setDraft(current); setView({year:current.year,month:current.month}); }}>Hiện tại</button><button type="button" className="text-button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Hủy</button><button type="button" className="button button-primary" disabled={!valid} onClick={apply}>Áp dụng</button></div>
    </div>}
  </div>;
}
