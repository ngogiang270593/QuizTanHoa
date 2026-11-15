import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { questionErrors } from '../frontend/src/questionDraft.mjs';

const root=path.resolve(import.meta.dirname,'..');
const paragraphs=JSON.parse(fs.readFileSync(path.join(root,'.artifacts/aaa-paragraphs.json'),'utf8'));
const questions=[];
let current=null,section='';
const keyHeading=paragraphs.findIndex(line=>/^IV\.\s*BẢNG ĐÁP ÁN$/iu.test(line));
assert.ok(keyHeading>0,'Answer-key section is missing.');
for(const line of paragraphs.slice(0,keyHeading)){
  const heading=line.match(/^(I{1,3})\.\s+(.+)$/u);
  if(heading){section=line;continue;}
  const question=line.match(/^Câu\s+(\d+)\.\s+(.+)$/u);
  if(question){current={originalNumber:Number(question[1]),section,content:question[2],options:[]};questions.push(current);continue;}
  const option=line.match(/^([A-D])\.\s+(.+)$/u);
  if(option&&current){current.options.push({key:option[1],text:option[2]});continue;}
  assert.fail(`Unexpected paragraph before answer key: ${line}`);
}
const answers=new Map();
for(let i=keyHeading+1;i<paragraphs.length-1;i++){
  if(/^V\./u.test(paragraphs[i]))break;
  if(/^\d+$/.test(paragraphs[i])&&/^[ABCD]$/.test(paragraphs[i+1])){
    const number=Number(paragraphs[i]);assert.ok(!answers.has(number),`Duplicate answer for question ${number}`);answers.set(number,paragraphs[i+1]);i++;
  }
}
assert.equal(questions.length,30);assert.equal(answers.size,30);
assert.ok(paragraphs.includes('Mỗi câu trả lời đúng')&&paragraphs.includes('1 điểm'),'Expected the supplied one-point scoring scale.');
const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'.artifacts/aaa-source.docx'))).digest('hex');
const prepared=questions.map((q,index)=>{
  assert.equal(q.originalNumber,index+1);assert.deepEqual(q.options.map(o=>o.key),['A','B','C','D']);
  const payload={topic:'Nghị Quyết 57',type:'SingleChoice',group:'Common',content:q.content,options:q.options,correctAnswer:answers.get(q.originalNumber),points:1,isScenario:false,explanation:'',
    source:`aaa.docx | Câu ${String(q.originalNumber).padStart(2,'0')} | ${q.section} | Đáp án: mục IV; thang điểm: mục V.`,requiresSourceReview:false,sourceReviewed:true};
  assert.deepEqual(questionErrors(payload),{},`Invalid question ${q.originalNumber}`);
  return {originalNumber:q.originalNumber,section:q.section,payload};
});
const output={sourceFile:'aaa.docx',sourceSha256:sourceHash,questionCount:30,pointsPerQuestion:1,maximumScore:30,
  note:'Question numbering and A–D markers are parsed as structure. Question text, option text/order and answer letters are preserved verbatim. No explanations were invented.',questions:prepared};
const directory=path.join(root,'.data','imports');fs.mkdirSync(directory,{recursive:true});
const destination=path.join(directory,'aaa-30-questions.json');fs.writeFileSync(destination,JSON.stringify(output,null,2));
console.log(JSON.stringify({file:'.data/imports/aaa-30-questions.json',count:prepared.length,answers:prepared.map(q=>`${q.originalNumber}:${q.payload.correctAnswer}`).join(' '),sourceSha256:sourceHash}));
