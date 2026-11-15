import {useEffect,useState} from 'react';
import {api} from './api.js';
import {formatVietnamDateTime} from './dateTime.js';
export default function ReviewQueue({navigate}) {
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{const c=new AbortController();setLoading(true);setError('');api.get('/organizer/review-queue',{signal:c.signal}).then(({data})=>{if(!c.signal.aborted)setRows(data);}).catch(()=>{if(!c.signal.aborted)setError('Không tải được danh sách chờ duyệt.');}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[revision]);
 return <section className="panel exam-section"><div className="exam-section-heading"><div><h2>Đề thi chờ duyệt</h2><p>Kiểm tra nội dung, trả lại kèm lý do hoặc duyệt phiên bản để tổ chức thi.</p></div><button type="button" className="button button-secondary" onClick={()=>setRevision(n=>n+1)}>Tải lại</button></div>{loading?<p role="status">Đang tải…</p>:error?<p role="alert">{error}</p>:!rows.length?<p>Không có đề đang chờ duyệt.</p>:<div className="exam-list">{rows.map(row=><article key={row.id} className="exam-list-row"><div><span className="exam-status">Chờ duyệt</span><h3>{row.name}</h3><p>{row.competitionName}</p><small>{formatVietnamDateTime(row.submittedAtUtc)} · Bản sửa {row.draftRevision}</small></div><button type="button" className="button button-primary" onClick={()=>navigate(`/ban-to-chuc/cuoc-thi/${row.competitionId}/de-thi/${row.id}`)}>Kiểm tra và duyệt</button></article>)}</div>}</section>;
}
