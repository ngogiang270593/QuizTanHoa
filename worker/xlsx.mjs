import {zipSync,unzipSync,strToU8,strFromU8} from '../cloud/node_modules/fflate/esm/browser.js';
import {ensure} from './common.mjs';
import {validateQuestion} from './exams.mjs';

export const questionHeaders=['Loại câu','Chủ đề','Nội dung','Phương án A','Phương án B','Phương án C','Phương án D','Đáp án đúng','Điểm','Giải thích','Nguồn đối chiếu','Cần đối chiếu nguồn','Câu tình huống'];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
const decode=value=>value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>{
  if(v[0]==='#'){const n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1));ensure(n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff),'Ký tự XML không hợp lệ.');return String.fromCodePoint(n);}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[v.toLowerCase()];
});
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase().replace(/[^a-z0-9]/g,'');
const column=index=>{let name='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
const attrs=xml=>Object.fromEntries([...xml.matchAll(/([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1],decode(m[2]??m[3])]));
const textNodes=xml=>[...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m=>decode(m[1])).join('');
export function workbookBytes(rows,sheetName='CauHoi') {
  ensure(rows.length<=10001,'Tối đa 10.000 dòng mỗi tệp xuất.');
  const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const xml=body=>strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`);
  const sheet=rows.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>v==null?'':typeof v==='number'&&Number.isFinite(v)?`<c r="${column(c)}${r+1}"><v>${v}</v></c>`:`<c r="${column(c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${escape(v)}</t></is></c>`).join('')}</row>`).join('');
  return zipSync({
    '[Content_Types].xml':xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels':xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml':xml(`<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="${escape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels':xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml':xml(`<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheet}</sheetData></worksheet>`),
  },{level:0});
}
export function workbookResponse(rows,filename,sheetName='CauHoi') {return new Response(workbookBytes(rows,sheetName),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${filename.replace(/[^a-zA-Z0-9_.-]/g,'_')}"`,'Cache-Control':'no-store'}});}
export function importPreview(bytes) {
  ensure(bytes.length>0&&bytes.length<=5*1024*1024,'Tệp Excel không được lớn hơn 5 MB.');
  let files,total=0,count=0;
  try {files=unzipSync(bytes,{filter:file=>{ensure(++count<=150&&file.originalSize<=8*1024*1024&&(total+=file.originalSize)<=12*1024*1024,'Tệp Excel giải nén vượt giới hạn an toàn.');ensure(!file.name.includes('..')&&!file.name.startsWith('/'),'Đường dẫn Excel không hợp lệ.');return /\.xml$|\.rels$/i.test(file.name);}});}catch(error){if(error.status)throw error;ensure(false,'Không đọc được Excel .xlsx hợp lệ.');}
  const read=name=>{ensure(files[name],`Tệp Excel thiếu ${name}.`);const xml=strFromU8(files[name]);ensure(!/<!DOCTYPE|<!ENTITY/i.test(xml),'Tệp Excel có XML không an toàn.');return xml;};
  const book=read('xl/workbook.xml'),sheet=[...book.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?\s*>/g)].map(m=>attrs(m[1])).find(s=>s.name==='CauHoi');
  ensure(sheet,'Cần trang tính tên CauHoi theo mẫu hệ thống.');
  const relationships=[...read('xl/_rels/workbook.xml.rels').matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?\s*>/g)].map(m=>attrs(m[1]));
  const link=relationships.find(r=>r.Id===sheet['r:id']);ensure(link&&!link.TargetMode&&!link.Target.includes('..')&&!/^\w+:/.test(link.Target),'Liên kết trang tính không hợp lệ.');
  const path=link.Target.startsWith('/')?link.Target.slice(1):`xl/${link.Target}`,xml=read(path);
  const shared=files['xl/sharedStrings.xml']?[...read('xl/sharedStrings.xml').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m=>textNodes(m[1])):[];
  const raw=[];let lastRow=0;
  for(const row of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const number=Number(attrs(row[1]).r||lastRow+1);ensure(Number.isInteger(number)&&number>lastRow&&number<=1048576,'Số dòng Excel không hợp lệ.');lastRow=number;
    const values=[],errors=[];let next=0;const used=new Set();
    for(const cell of row[2].matchAll(/<(?:\w+:)?c\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const a=attrs(cell[1]),ref=a.r?.match(/^([A-Z]+)\d+$/),index=ref?[...ref[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1:next;
      ensure(index>=0&&index<16384&&!used.has(index),'Địa chỉ ô Excel không hợp lệ hoặc bị trùng.');used.add(index);next=index+1;
      const inner=cell[2]||'',value=inner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1]||'';
      if(/<(?:\w+:)?f\b/.test(inner)){errors.push(`Ô ${a.r||column(index)}: không dùng công thức; hãy dán giá trị trước khi nhập.`);values[index]='';}
      else if(a.t==='s'){ensure(/^\d+$/.test(value)&&Number(value)<shared.length,'Chỉ mục chuỗi Excel không hợp lệ.');values[index]=shared[Number(value)];}
      else if(a.t==='inlineStr')values[index]=textNodes(inner);
      else if(a.t==='e'){errors.push(`Ô ${a.r}: có lỗi Excel.`);values[index]='';}
      else values[index]=decode(value);
    }
    raw.push({number,values,errors});ensure(raw.length<=502,'Tối đa 500 câu hỏi trong một tệp.');
  }
  ensure(raw.length&&raw[0].number===1,'Dòng 1 phải chứa tiêu đề cột.');
  const headers=new Map();raw[0].values.forEach((v,i)=>{if(v.trim()){const k=normalize(v);ensure(!headers.has(k),'Tiêu đề cột bị trùng.');headers.set(k,i);}});
  if(!headers.has(normalize('Chủ đề'))&&headers.has(normalize('Nhóm câu')))headers.set(normalize('Chủ đề'),headers.get(normalize('Nhóm câu')));
  ensure(questionHeaders.slice(0,12).every(h=>headers.has(normalize(h))),'Thiếu cột bắt buộc. Hãy tải và dùng mẫu Excel hệ thống.');
  const rows=[];
  for(const row of raw.slice(1)){
    const cell=h=>row.values[headers.get(normalize(h))]?.trim()||'';
    if(!row.errors.length&&questionHeaders.every(h=>!cell(h)))continue;
    const type=normalize(cell('Loại câu')),group=normalize(cell('Chủ đề')),answer=normalize(cell('Đáp án đúng')),errors=[...row.errors];
    const question={topic:['kienthucchung','common','chuyenmon','specialized'].includes(group)?'':cell('Chủ đề'),type:['motdapandung','singlechoice'].includes(type)?'SingleChoice':['dungsai','truefalse'].includes(type)?'TrueFalse':'',group:['kienthucchung','common'].includes(group)?'Common':['chuyenmon','specialized'].includes(group)?'Specialized':'Common',content:cell('Nội dung'),explanation:cell('Giải thích'),source:cell('Nguồn đối chiếu'),sourceReviewed:false};
    for(const [header,field]of [['Cần đối chiếu nguồn','requiresSourceReview'],['Câu tình huống','isScenario']]){const v=normalize(cell(header));if(!['','co','khong','true','false','1','0','yes','no'].includes(v))errors.push(`${header}: chỉ nhập Có hoặc Không.`);question[field]=['co','true','1','yes'].includes(v);}
    if(question.type==='TrueFalse'){
      question.options=[{key:'True',text:'Đúng'},{key:'False',text:'Sai'}];question.correctAnswer=['true','dung','a'].includes(answer)?'True':['false','sai','b'].includes(answer)?'False':null;
      if(cell('Phương án C')||cell('Phương án D')||cell('Phương án A')&&normalize(cell('Phương án A'))!=='dung'||cell('Phương án B')&&normalize(cell('Phương án B'))!=='sai')errors.push('Câu đúng/sai dùng A = Đúng, B = Sai; để trống C, D.');
    }else{question.options=['A','B','C','D'].filter(k=>cell(`Phương án ${k}`)).map(key=>({key,text:cell(`Phương án ${key}`)}));question.correctAnswer=cell('Đáp án đúng').toUpperCase()||null;}
    const points=cell('Điểm').replace(',','.');question.points=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(points)?Number(points):0;
    errors.push(...validateQuestion(question).map(e=>e.message));
    if(question.explanation.length>5000||question.source.length>2000)errors.push('Giải thích hoặc nguồn đối chiếu vượt giới hạn.');
    rows.push({rowNumber:row.number,question,errors:[...new Set(errors)],warnings:[]});
  }
  return {totalRows:rows.length,validRows:rows.filter(r=>!r.errors.length).length,canImport:rows.length>0&&rows.every(r=>!r.errors.length),rows,errors:rows.length?[]:['Trang CauHoi chưa có câu hỏi để nhập.']};
}
