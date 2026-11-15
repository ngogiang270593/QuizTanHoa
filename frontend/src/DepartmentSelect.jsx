import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {unitNameKey} from '../../shared/organizationUnits.mjs';
export default function DepartmentSelect({id,value,departmentId,onChange,disabled}) {
 const [units,setUnits]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const latest=useRef(onChange);latest.current=onChange;
 useEffect(()=>{const c=new AbortController();setLoading(true);setError('');api.get('/organizer/organization-units',{signal:c.signal}).then(({data})=>{if(!c.signal.aborted)setUnits(data);}).catch(()=>{if(!c.signal.aborted)setError('Chưa tải được danh mục phòng ban.');}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[attempt]);
 const selected=departmentId!=null?units.find(u=>u.id===departmentId):units.find(u=>unitNameKey(u.name)===unitNameKey(value));
 useEffect(()=>{if(departmentId==null&&selected)latest.current({department:selected.name,departmentId:selected.id});},[departmentId,selected?.id]);
 return <><select id={id} value={selected?String(selected.id):value?'legacy':''} disabled={disabled||loading||Boolean(error)} onChange={e=>{const unit=units.find(u=>String(u.id)===e.target.value);latest.current({department:unit?.name||'',departmentId:unit?.id??null});}}><option value="">{loading?'Đang tải phòng ban…':'Chưa phân phòng ban'}</option>{value&&!selected&&<option value="legacy">{value} (giá trị hiện có)</option>}{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select>{error&&<small role="alert">{error} <button type="button" className="text-button" disabled={disabled} onClick={()=>setAttempt(n=>n+1)}>Thử lại</button></small>}</>;
}
