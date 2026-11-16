import {ensure,json,now,pick,sha256,text,integer} from './common.mjs';
import {loadVersion} from './exams.mjs';
import {finalize} from './attempts.mjs';
import {workbookResponse} from './xlsx.mjs';

export function scoreAttempt(attempt,snapshot,user,groups,incident=false) {
  const field=snapshot.exam.fieldGroupName||'',group=groups.find(g=>g.id===snapshot.exam.fieldGroupId),answers=new Map(attempt.questions.map(q=>[q.id,q.answer]));
  const row={attemptId:attempt.id,candidateCode:user.username,fullName:user.fullName,department:user.department,fieldGroupName:field,rankingGroupName:group?.rankingGroupName||field,
    commonScore:null,specializedScore:null,scenarioScore:null,totalScore:null,correctAnswersCount:null,durationMilliseconds:null,submittedAtUtc:attempt.submittedAtUtc||null,
    attemptStatus:attempt.isInvalidated?'Invalidated':attempt.submittedAtUtc?'Submitted':Date.parse(attempt.deadlineAtUtc)<=Date.now()?'Expired':'InProgress',isValid:!!attempt.submittedAtUtc&&!attempt.isInvalidated,rank:null,hadIncident:incident};
  if(attempt.submittedAtUtc) {
    let common=0,specialized=0,scenario=0,count=0;
    for(const q of snapshot.questions){const a=answers.get(q.id);if(!a||a.toLowerCase()!==q.correctAnswer?.toLowerCase())continue;count++;if(q.group==='Common')common+=q.points;else if(q.group==='Specialized')specialized+=q.points;if(q.isScenario)scenario+=q.points;}
    const round=n=>Math.round((n+Number.EPSILON)*1000000)/1000000;
    Object.assign(row,{commonScore:round(common),specializedScore:round(specialized),scenarioScore:round(scenario),totalScore:round(common+specialized),correctAnswersCount:count,durationMilliseconds:Math.max(0,Date.parse(attempt.submittedAtUtc)-Date.parse(attempt.startedAtUtc))});
  }
  return row;
}
export function assignRanks(rows) {
  const groups=new Map();for(const row of rows.filter(r=>r.isValid)){const key=row.rankingGroupName.toLowerCase();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  for(const group of groups.values()){
    group.sort((a,b)=>b.correctAnswersCount-a.correctAnswersCount||a.durationMilliseconds-b.durationMilliseconds||a.candidateCode.localeCompare(b.candidateCode));
    group.forEach((row,i)=>{row.rank=i&&row.correctAnswersCount===group[i-1].correctAnswersCount&&row.durationMilliseconds===group[i-1].durationMilliseconds?group[i-1].rank:i+1;});
  }
  return rows;
}
export async function competitionResults(db,c) {
  const [assignments,attempts,users,groups,events]=await Promise.all([db.all('assignments','competitionId',c.id),db.all('attempts','competitionId',c.id),db.all('users'),db.all('groups','competitionId',c.id),db.all('attemptEvents','competitionId',c.id)]);
  const byUser=new Map(users.map(u=>[u.id,u])),rows=[],snapshots=new Map();
  for(const attempt of attempts) {
    finalize(db,attempt);if(!snapshots.has(attempt.examVersionId))snapshots.set(attempt.examVersionId,(await loadVersion(db,attempt.examVersionId))?.snapshot);
    const snapshot=snapshots.get(attempt.examVersionId),user=byUser.get(attempt.userId);ensure(snapshot&&user,'Không đọc được dữ liệu lịch sử lượt thi.',409);
    rows.push(scoreAttempt(attempt,snapshot,user,groups,events.some(e=>e.attemptId===attempt.id)));
  }
  const versions=await db.all('versions','competitionId',c.id);
  for(const a of assignments.filter(a=>!attempts.some(t=>t.userId===a.userId))) {
    const user=byUser.get(a.userId),exam=versions.find(v=>v.id===a.examVersionId)?.exam||{},group=groups.find(g=>g.id===exam.fieldGroupId);
    rows.push({attemptId:null,candidateCode:user?.username||'',fullName:user?.fullName||'',department:user?.department||'',fieldGroupName:exam.fieldGroupName||'',rankingGroupName:group?.rankingGroupName||exam.fieldGroupName||'',commonScore:null,specializedScore:null,scenarioScore:null,totalScore:null,correctAnswersCount:null,durationMilliseconds:null,submittedAtUtc:null,attemptStatus:'NotStarted',isValid:false,rank:null,hadIncident:false});
  }
  assignRanks(rows);rows.sort((a,b)=>a.rankingGroupName.localeCompare(b.rankingGroupName,'vi')||(a.rank??Infinity)-(b.rank??Infinity)||a.candidateCode.localeCompare(b.candidateCode));
  return {competitionId:c.id,competitionName:c.name,rankingGroups:[...new Set(rows.map(r=>r.rankingGroupName).filter(Boolean))].sort(),rows};
}
const nominee=(row,awardName,boundaryTie=false,awardIcon='trophy')=>({...pick(row,['attemptId','candidateCode','fullName','department','fieldGroupName','rankingGroupName','rank','commonScore','specializedScore','scenarioScore','totalScore','submittedAtUtc','hadIncident']),awardName,awardIcon,boundaryTie});
export function proposal(categories,rows) {
  const groups=new Map(),nominees=[];
  for(const category of categories){const k=category.rankingGroupName.toLowerCase();if(!groups.has(k))groups.set(k,[]);groups.get(k).push(category);}
  for(const [key,cats] of groups){const ranked=rows.filter(r=>r.isValid&&r.rank&&r.rankingGroupName.toLowerCase()===key).sort((a,b)=>a.rank-b.rank||a.candidateCode.localeCompare(b.candidateCode));let offset=0;
    for(const category of cats){let selected=ranked.slice(offset,offset+category.quantity);if(!selected.length)continue;const boundary=selected.at(-1).rank,tie=ranked.filter(r=>r.rank===boundary).length>1;while(offset+selected.length<ranked.length&&ranked[offset+selected.length].rank===boundary)selected.push(ranked[offset+selected.length]);nominees.push(...selected.map(r=>nominee(r,category.awardName,tie,category.icon)));offset+=selected.length;}
  }
  return nominees;
}
const fingerprint=async rows=>sha256(JSON.stringify(rows.filter(r=>r.isValid).sort((a,b)=>a.attemptId-b.attemptId)));
function categoriesInput(value,groups) {
  ensure(Array.isArray(value)&&value.length>0&&value.length<=100,'Cấu hình cần có từ 1 đến 100 hạng giải.');
  const icons=new Set(['trophy','gold','silver','bronze','medal','star','sparkle','rosette','first','second','third']);
  const categories=value.map(c=>({rankingGroupName:text(c?.rankingGroupName,200,true),awardName:text(c?.awardName,100,true),icon:icons.has(c?.icon)?c.icon:'trophy',quantity:integer(c?.quantity,1,1000)}));
  ensure(new Set(categories.map(c=>`${c.rankingGroupName}|${c.awardName}`.toLowerCase())).size===categories.length,'Tên giải bị trùng trong cùng nhóm.');
  if(groups)ensure(categories.every(c=>groups.some(g=>g.toLowerCase()===c.rankingGroupName.toLowerCase())),'Một hoặc nhiều nhóm xếp hạng không thuộc cuộc thi.');return categories;
}
function audit(ctx,cid,action,reason) {ctx.db.put('awardEvents',{id:ctx.db.next('awardEvents'),competitionId:cid,actorUserId:ctx.user.id,actorName:ctx.user.fullName,action,reason:reason?.slice(0,1000)||'',occurredAtUtc:now()});}
async function awardsProfile(db,c,result) {
  const plan=await db.get('awardPlans',c.id),doc=(['Approved','Published'].includes(plan?.status)?plan.approved:plan?.draft)||{categories:[],nominees:[],individualScoresPublished:false,tieReviewConfirmed:false,adjustmentReason:null};
  return {competitionId:c.id,competitionName:c.name,status:plan?.status||'Draft',revision:plan?.revision||0,individualScoresPublished:doc.individualScoresPublished,tieReviewConfirmed:doc.tieReviewConfirmed,adjustmentReason:doc.adjustmentReason,categories:doc.categories,nominees:doc.nominees,proposedNominees:proposal(doc.categories,result.rows),results:result.rows,
    approvedAtUtc:plan?.approvedAtUtc||null,approvedByUserId:plan?.approvedByUserId||null,publishedAtUtc:plan?.publishedAtUtc||null,publishedByUserId:plan?.publishedByUserId||null,competitionStatus:c.status,audit:(await db.all('awardEvents','competitionId',c.id)).sort((a,b)=>a.occurredAtUtc.localeCompare(b.occurredAtUtc))};
}
export async function candidateAwards(ctx,cid) {
  const plan=await ctx.db.get('awardPlans',cid),doc=(['Approved','Published'].includes(plan?.status)?plan.approved:plan?.draft)||{},published=plan?.status==='Published'&&!!plan.approved;
  const c=await ctx.db.get('competitions',cid),results=await competitionResults(ctx.db,c),row=results.rows.find(r=>r.isValid&&r.candidateCode===ctx.user.username);
  const attemptSummary=row?pick(row,['correctAnswersCount','durationMilliseconds','submittedAtUtc']):null;
  const score=doc.individualScoresPublished&&row?pick(row,['rank','commonScore','specializedScore','scenarioScore','totalScore','submittedAtUtc']):null;
  return {individualScorePublished:!!doc.individualScoresPublished,individualScore:score,attemptSummary,awardsPublished:published,awards:published?plan.approved.nominees.map(n=>pick(n,['awardName','awardIcon','candidateCode','fullName','department','fieldGroupName','rankingGroupName','rank'])):[]};
}


export async function resultsRoute(ctx,c) {
  const {db,parts,method,body,url,user}=ctx,action=parts[4],sub=parts[5];
  if(!['results','awards','end'].includes(action))return;
  if(action==='awards'&&sub==='structure') {
    const saved=await db.get('awardStructures',c.id);
    if(method==='GET')return json({competitionId:c.id,status:c.status,awards:saved?.awards||[],updatedAtUtc:saved?.updatedAtUtc||null});
    if(method==='PUT') {
      ensure(c.status==='Draft','Chỉ có thể thay đổi cơ cấu giải khi cuộc thi còn ở trạng thái nháp.',409);
      ensure(Array.isArray(body.awards)&&body.awards.length>0&&body.awards.length<=50,'Cần tạo từ 1 đến 50 giải.');
      const awards=body.awards.map(item=>({name:text(item?.name,100,true),amount:Number(item?.amount)}));
      ensure(awards.every(item=>item.name&&Number.isFinite(item.amount)&&item.amount>=0&&item.amount<=100000000000),'Tên giải và số tiền không hợp lệ.');
      ensure(new Set(awards.map(item=>item.name.toLocaleLowerCase('vi'))).size===awards.length,'Tên giải không được trùng nhau.');
      const record={id:c.id,competitionId:c.id,awards,updatedAtUtc:now(),updatedByUserId:user.id};db.put('awardStructures',record);
      return json({competitionId:c.id,status:c.status,awards:record.awards,updatedAtUtc:record.updatedAtUtc});
    }
  }
  const result=await competitionResults(db,c);
  if(action==='results'&&method==='GET') {
    const group=url.searchParams.get('rankingGroupName');if(group){ensure(result.rankingGroups.some(g=>g.toLowerCase()===group.trim().toLowerCase()),'Nhóm xếp hạng không thuộc cuộc thi.');result.rows=result.rows.filter(r=>r.rankingGroupName.toLowerCase()===group.trim().toLowerCase());}
    if(sub==='excel')return workbookResponse([['Thứ hạng','Mã thí sinh','Họ tên','Bộ phận','Nhóm đề','Nhóm xếp hạng','Số câu đúng','Thời gian làm bài (giây)','Điểm chung','Điểm chuyên môn','Điểm tình huống','Tổng điểm','Thời điểm nộp (UTC)','Trạng thái lượt thi','Hợp lệ'],...result.rows.map(r=>[r.rank,r.candidateCode,r.fullName,r.department,r.fieldGroupName,r.rankingGroupName,r.correctAnswersCount,r.durationMilliseconds==null?null:r.durationMilliseconds/1000,r.commonScore,r.specializedScore,r.scenarioScore,r.totalScore,r.submittedAtUtc,r.attemptStatus,r.isValid?'Có':'Không'])],`KetQua_${c.id}.xlsx`,'KetQua');
    const plan=await db.get('awardPlans',c.id),awardDoc=(['Approved','Published'].includes(plan?.status)?plan.approved:plan?.draft)||{};
    const awardsByAttempt=new Map((awardDoc.nominees||[]).map(n=>[n.attemptId,n]));
    result.rows=result.rows.map(row=>{const award=awardsByAttempt.get(row.attemptId);return award?{...row,awardName:award.awardName,awardIcon:award.awardIcon||'trophy'}:row;});
    return json(result);
  }
  let plan=await db.get('awardPlans',c.id);
  if(action==='end'&&method==='POST') {
    if(c.status==='Ended')return json({message:'Cuộc thi đã kết thúc.'});
    ensure(c.status==='Published'&&plan?.status==='Published','Cần công bố cuộc thi và danh sách đạt giải trước khi kết thúc.',409);
    ensure(!result.rows.some(r=>r.attemptStatus==='InProgress'),'Chưa thể kết thúc khi còn thí sinh đang làm bài.',409);
    c.status='Ended';c.updatedAtUtc=now();db.put('competitions',c);audit(ctx,c.id,'CompetitionEnded','Kết thúc cuộc thi.');return json({message:'Đã kết thúc cuộc thi.'});
  }
  if(action!=='awards')return;
  if(parts.length===5&&method==='GET')return json(await awardsProfile(db,c,result));
  if(sub==='proposal'&&method==='POST')return json({nominees:proposal(categoriesInput(body.categories,result.rankingGroups),result.rows)});
  if(sub==='excel'&&method==='GET') {
    ensure(plan?.status==='Published'&&plan.approved,'Chỉ có thể xuất danh sách giải đã công bố.',409);
    return workbookResponse([['Giải','Hạng','Mã thí sinh','Họ tên','Bộ phận','Nhóm đề','Nhóm xếp hạng','Điểm chung','Điểm chuyên môn','Điểm tình huống','Tổng điểm','Thời điểm nộp (UTC)','Có sự cố','Đồng hạng tại vị trí xét giải'],...plan.approved.nominees.map(n=>[n.awardName,n.rank,n.candidateCode,n.fullName,n.department,n.fieldGroupName,n.rankingGroupName,n.commonScore,n.specializedScore,n.scenarioScore,n.totalScore,n.submittedAtUtc,n.hadIncident?'Có':'Không',n.boundaryTie?'Có':'Không'])],`KetQuaXetGiai_${c.id}.xlsx`,'XetGiai');
  }
  if(sub==='draft'&&method==='PUT') {
    ensure(c.status!=='Ended','Cuộc thi đã kết thúc.',409);ensure(plan?.status!=='Published','Danh sách đã công bố và không thể sửa.',409);
    ensure(body.revision===(plan?.revision||0),'Danh sách đã được thay đổi. Hãy tải lại trước khi lưu.',409);
    const categories=categoriesInput(body.categories,result.rankingGroups);ensure(Array.isArray(body.nominees)&&body.nominees.length<=10000,'Danh sách thí sinh không hợp lệ.');
    ensure(new Set(body.nominees.map(n=>n.attemptId)).size===body.nominees.length,'Một lượt thi không thể nhận nhiều giải.');
    const proposed=proposal(categories,result.rows),nominees=body.nominees.map(input=>{
      const row=result.rows.find(r=>r.attemptId===input.attemptId&&r.isValid&&r.rank&&r.rankingGroupName.toLowerCase()===input.rankingGroupName?.trim().toLowerCase());
      const category=categories.find(c=>c.rankingGroupName.toLowerCase()===input.rankingGroupName?.trim().toLowerCase()&&c.awardName.toLowerCase()===input.awardName?.trim().toLowerCase());
      ensure(row&&category,'Chỉ lượt đã nộp, hợp lệ và thuộc đúng nhóm/hạng giải mới được chọn.');return nominee(row,category.awardName,proposed.some(n=>n.attemptId===row.attemptId&&n.boundaryTie),category.icon);
    });
    const key=items=>JSON.stringify(items.map(n=>`${n.attemptId}|${n.awardName.toLowerCase()}`).sort()),same=key(nominees)===key(proposed),reason=text(body.adjustmentReason,1000);
    ensure(same||reason,'Cần ghi lý do khi điều chỉnh danh sách dự kiến so với bảng xếp hạng.');
    if(plan?.status==='Approved')audit(ctx,c.id,'ApprovalWithdrawn',reason||'Mở lại danh sách để chỉnh sửa.');
    plan={id:c.id,competitionId:c.id,status:'Draft',revision:(plan?.revision||0)+1,createdAtUtc:plan?.createdAtUtc||now(),updatedAtUtc:now(),approved:null,approvedAtUtc:null,approvedByUserId:null,publishedAtUtc:null,publishedByUserId:null,
      draft:{categories,nominees,individualScoresPublished:body.individualScoresPublished===true,tieReviewConfirmed:body.tieReviewConfirmed===true,adjustmentReason:same?null:reason,resultFingerprint:await fingerprint(result.rows)}};
    db.put('awardPlans',plan);audit(ctx,c.id,'DraftSaved',reason||'Lưu danh sách dự kiến.');return json({message:'Đã lưu danh sách dự kiến.',awards:await awardsProfile(db,c,result)});
  }
  if(sub==='approve'&&method==='POST') {
    ensure(plan,'Không tìm thấy danh sách xét giải.',404);ensure(c.status!=='Ended'&&plan.status==='Draft','Chỉ danh sách dự kiến mới có thể được duyệt.',409);
    ensure(body.revision===plan.revision,'Danh sách đã được thay đổi. Hãy tải lại trước khi duyệt.',409);
    ensure(plan.draft.nominees.length,'Chưa có thí sinh trong danh sách dự kiến.');
    ensure(plan.draft.resultFingerprint===await fingerprint(result.rows),'Bảng kết quả đã thay đổi sau khi lưu dự kiến. Hãy lập lại danh sách.');
    ensure(plan.draft.tieReviewConfirmed||!proposal(plan.draft.categories,result.rows).some(n=>n.boundaryTie),'Cần xác nhận đã rà soát các trường hợp đồng hạng tại vị trí xét giải.');
    Object.assign(plan,{status:'Approved',approved:structuredClone(plan.draft),approvedAtUtc:now(),approvedByUserId:user.id,updatedAtUtc:now()});db.put('awardPlans',plan);audit(ctx,c.id,'Approved',text(body.reason,1000)||'Duyệt danh sách dự kiến.');return json({message:'Đã duyệt danh sách giải.',awards:await awardsProfile(db,c,result)});
  }
  if(sub==='publish'&&method==='POST') {
    ensure(plan&&['Approved','Published'].includes(plan.status)&&plan.approved,'Chỉ danh sách đã duyệt mới có thể công bố.',409);
    ensure(c.status!=='Draft','Chỉ có thể công bố giải của cuộc thi đã công bố.',409);
    if(plan.status!=='Published'){
      ensure(plan.approved.resultFingerprint===await fingerprint(result.rows),'Bảng kết quả đã thay đổi sau khi duyệt. Hãy rà soát và duyệt lại.',409);
      Object.assign(plan,{status:'Published',publishedAtUtc:now(),publishedByUserId:user.id,updatedAtUtc:now()});db.put('awardPlans',plan);audit(ctx,c.id,'Published','Công bố danh sách đạt giải.');
    }
    return json({message:'Đã công bố danh sách đạt giải.',awards:await awardsProfile(db,c,result)});
  }
}
