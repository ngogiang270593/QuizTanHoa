import {useEffect,useState} from 'react';
import {api} from './api.js';
import './AwardCatalog.css';

const ICONS=[{key:'first',name:'Cúp vàng',src:'/awards/giai-nhat.png'},{key:'second',name:'Cúp bạc',src:'/awards/giai-nhi.png'},{key:'third',name:'Cúp đồng',src:'/awards/giai-ba.png'}];
export default function AwardCatalog(){
 const [items,setItems]=useState([]),[name,setName]=useState(''),[icon,setIcon]=useState('first'),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function load(){setLoading(true);setError('');try{const {data}=await api.get('/organizer/award-catalog');setItems(Array.isArray(data)?data:[]);}catch(e){setError(e.response?.data?.message||'Không tải được danh mục giải thưởng.');}finally{setLoading(false);}}
 useEffect(()=>{load();},[]);
 function edit(item){setEditing(item.id);setName(item.name);setIcon(item.icon);setNotice('');setError('');}
 function reset(){setEditing(null);setName('');setIcon('first');}
 async function save(event){event.preventDefault();if(busy||!name.trim())return;setBusy(true);setError('');setNotice('');try{if(editing)await api.put(`/organizer/award-catalog/${editing}`,{name:name.trim(),icon});else await api.post('/organizer/award-catalog',{name:name.trim(),icon});setNotice(editing?'Đã cập nhật giải thưởng.':'Đã thêm giải thưởng.');reset();await load();}catch(e){setError(e.response?.data?.message||'Không lưu được giải thưởng.');}finally{setBusy(false);}}
 async function remove(item){if(busy||!window.confirm(`Xóa “${item.name}” khỏi danh mục giải thưởng? Dữ liệu giải đã lưu ở các cuộc thi không bị thay đổi.`))return;setBusy(true);setError('');setNotice('');try{await api.delete(`/organizer/award-catalog/${item.id}`);if(editing===item.id)reset();setNotice('Đã xóa khỏi danh mục giải thưởng.');await load();}catch(e){setError(e.response?.data?.message||'Không xóa được giải thưởng.');}finally{setBusy(false);}}
 const selected=ICONS.find(item=>item.key===icon)||ICONS[0];
 return <section className="award-catalog"><header><h2>Danh mục giải thưởng</h2><p>Thêm, đổi tên hoặc xóa giải thưởng. Biểu tượng được dùng khi cấu hình xét giải và hiển thị trong bảng xếp hạng.</p></header>
  {error&&<div className="notice notice-error" role="alert">{error}</div>}{notice&&<div className="notice competition-success" role="status">{notice}</div>}
  <form className="award-catalog-form" onSubmit={save}>
   <label>Tên giải<input value={name} onChange={e=>setName(e.target.value)} required maxLength={100} placeholder="Ví dụ: Giải khuyến khích" disabled={busy}/></label>
   <label>Biểu tượng<select value={icon} onChange={e=>setIcon(e.target.value)} disabled={busy}>{ICONS.map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
   <div className="award-catalog-preview"><img src={selected.src} alt=""/><span>{selected.name}</span></div>
   <div className="award-catalog-actions"><button className="button button-primary" disabled={busy||!name.trim()}>{busy?'Đang lưu…':editing?'Lưu thay đổi':'Thêm giải'}</button>{editing&&<button type="button" className="button button-secondary" onClick={reset} disabled={busy}>Hủy sửa</button>}</div>
  </form>
  {loading?<p role="status">Đang tải danh mục…</p>:!items.length?<p>Chưa có giải thưởng.</p>:<div className="award-catalog-list">{items.map(item=><article key={item.id}><img src={ICONS.find(icon=>icon.key===item.icon)?.src||ICONS[0].src} alt=""/><strong>{item.name}</strong><span>{ICONS.find(icon=>icon.key===item.icon)?.name||'Cúp vàng'}</span><div><button type="button" className="text-button" disabled={busy} onClick={()=>edit(item)}>Sửa</button><button type="button" className="text-button exam-danger" disabled={busy} onClick={()=>remove(item)}>Xóa</button></div></article>)}</div>}
 </section>;
}
