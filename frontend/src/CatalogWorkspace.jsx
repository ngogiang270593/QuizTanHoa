import {useRef,useState} from 'react';
import {useAccess} from './AccessContext.jsx';
import TopicCatalog from './TopicCatalog.jsx';
import ProcessCatalog from './ProcessCatalog.jsx';
import DepartmentCatalog from './DepartmentCatalog.jsx';
import './TopicCatalog.css';
export default function CatalogWorkspace({navigate}) {
 const {can}=useAccess(),admin=can('manageUsers'),canTopics=admin||['draft','submit','approve'].some(can);
 const [tab,setTab]=useState(()=>{const requested=new URLSearchParams(window.location.search).get('tab');return admin&&requested==='quy-trinh'?'processes':admin&&requested==='phong-ban'?'departments':'topics';});
 const refs=useRef({});
 const tabs=[...(canTopics?[{key:'topics',label:'Chủ đề'}]:[]),...(admin?[{key:'departments',label:'Phòng ban'},{key:'processes',label:'Quy trình'}]:[])];
 function change(key){setTab(key);const url=new URL(window.location.href);url.searchParams.set('tab',key==='processes'?'quy-trinh':key==='departments'?'phong-ban':'chu-de');window.history.replaceState({},'',url.pathname+url.search);}
 function keydown(e,index){let next=index;if(e.key==='ArrowRight')next=(index+1)%tabs.length;else if(e.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();change(tabs[next].key);refs.current[tabs[next].key]?.focus();}
 return <section className="panel exam-section catalog-workspace"><div className="exam-section-heading"><div><h2>Danh mục dùng chung</h2><p>Quản lý chủ đề, phòng ban và quy trình phân quyền dùng chung.</p></div></div><div className="catalog-tabs" role="tablist" aria-label="Danh mục">{tabs.map((t,i)=><button key={t.key} ref={el=>{refs.current[t.key]=el;}} type="button" role="tab" id={'catalog-tab-'+t.key} aria-controls={'catalog-panel-'+t.key} aria-selected={tab===t.key} tabIndex={tab===t.key?0:-1} onKeyDown={e=>keydown(e,i)} onClick={()=>change(t.key)}>{t.label}</button>)}</div>{tabs.map(t=><div key={t.key} role="tabpanel" id={'catalog-panel-'+t.key} aria-labelledby={'catalog-tab-'+t.key} hidden={tab!==t.key}>{tab===t.key&&(t.key==='topics'?<TopicCatalog navigate={navigate} embedded/>:t.key==='processes'?<ProcessCatalog/>:<DepartmentCatalog navigate={navigate}/>)}</div>)}</section>;
}
