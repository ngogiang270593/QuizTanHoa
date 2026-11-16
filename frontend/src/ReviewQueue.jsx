import {useEffect,useState} from 'react';
import {api} from './api.js';
import {formatVietnamDateTime} from './dateTime.js';
import {ExamEditor} from './ExamWorkspace.jsx';
import './ReviewQueue.css';

export default function ReviewQueue({navigate}) {
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[selected,setSelected]=useState(null);
 useEffect(()=>{const c=new AbortController();setLoading(true);setError('');api.get('/organizer/review-queue',{signal:c.signal}).then(({data})=>{if(!c.signal.aborted)setRows(data);}).catch(()=>{if(!c.signal.aborted)setError('Không tải được danh sách chờ duyệt.');}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[revision]);
 useEffect(()=>{if(!selected)return;const escape=event=>{if(event.key==='Escape')setSelected(null);};document.addEventListener('keydown',escape);const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.removeEventListener('keydown',escape);document.body.style.overflow=previous;};},[selected]);
 function finish(){setSelected(null);setRevision(n=>n+1);}
 return <>
  <section className="panel exam-section"><div className="exam-section-heading"><div><h2>Đề thi chờ duyệt</h2><p>Kiểm tra nội dung, trả lại kèm lý do hoặc duyệt phiên bản để tổ chức thi.</p></div><button type="button" className="button button-secondary" onClick={()=>setRevision(n=>n+1)}>Tải lại</button></div>{loading?<p role="status">Đang tải…</p>:error?<p role="alert">{error}</p>:!rows.length?<p>Không có đề đang chờ duyệt.</p>:<div className="exam-list">{rows.map(row=><article key={row.id} className="exam-list-row"><div><span className="exam-status">Chờ duyệt</span><h3>{row.name}</h3><p>{row.competitionName}</p><small>{formatVietnamDateTime(row.submittedAtUtc)} · Bản sửa {row.draftRevision}</small></div><button type="button" className="button button-primary" onClick={()=>setSelected(row)}>Kiểm tra và duyệt</button></article>)}</div>}</section>
  {selected&&<div className="review-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setSelected(null);}}><section className="review-modal" role="dialog" aria-modal="true" aria-label={`Kiểm tra đề ${selected.name}`}><div className="review-modal-heading"><div><span className="eyebrow">ĐỀ THI CHỜ DUYỆT</span><h2>{selected.name}</h2><p>{selected.competitionName}</p></div><button className="button button-secondary" type="button" onClick={()=>setSelected(null)}>Thoát</button></div><div className="review-modal-content"><ExamEditor key={`${selected.competitionId}-${selected.id}`} base={`/organizer/competitions/${selected.competitionId}`} competitionId={selected.competitionId} examId={selected.id} navigate={navigate} reviewOnly onClose={()=>setSelected(null)} onDecisionComplete={finish}/></div></section></div>}
 </>;
}