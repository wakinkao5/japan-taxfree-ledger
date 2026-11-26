export const categories = ['機票','住宿','交通','餐飲','購物','景點門票','旅遊保險','網路通訊','其他'];
const oldCategories = ['藥妝','服飾'];
export const categoryOf = r => r.food && r.taxRequested===undefined ? '餐飲' : oldCategories.includes(r.category) ? '購物' : r.category;
export const refundRequested = r => r.taxRequested ?? (!r.food && r.status!==statuses[3]);
export const currencies = ['JPY','TWD','USD','EUR','KRW','HKD'];
export function conversion(trip) {
  const currency=trip.currency??'JPY';
  return currency==='JPY'?1:currency==='TWD'?trip.fixedRate:trip.foreignRate;
}
export function roundShare(amount,hundreds=false){
  const units=amount/(hundreds?100:1);
  const integer=Math.round(units);
  const stable=Math.abs(units-integer)<=Number.EPSILON*Math.max(1,Math.abs(units))*4?integer:units;
  return hundreds?Math.ceil(stable)*100:Math.round(stable);
}

export const methods = ['現金','信用卡'];
export const statuses = ['待確認','預計退稅','已退稅','不適用'];
export const modes = ['不分攤','指定成員均分','自訂金額','全員均分'];
export const initial = () => ({
  names:[],
  stores:[['無印良品','購物'],['Global Work','購物'],['UNIQLO','購物'],['唐吉訶德','購物'],['BicCamera','購物'],['鶴羽','購物'],['多慶屋','購物']].map(([name, category], i) => ({
    name, category, method:i===3?'信用卡':'', agency:i===3?'PPIH（唐吉訶德）':'', fee:i===3?0:null, basis:'tax'
  })),
  agencies:[{name:'PPIH（唐吉訶德）', method:'信用卡', fee:0, basis:'tax'}],
  records:[], rate:null
});
export const yen = n => Number.isSafeInteger(n) && n>=0 && n<=100000000;
export const rateOK = n => Number.isFinite(n) && n>0 && n<=100;
export const feeOK = n => n===null || (Number.isFinite(n) && n>=0 && n<=100);
export const sum = a => a.reduce((x,y)=>x+y,0);
export function even(total, selected) {
  const count = selected.filter(Boolean).length;
  if (!count) return selected.map(()=>0);
  let extra = total % count;
  return selected.map(on => on ? Math.floor(total/count) + (extra-- > 0 ? 1 : 0) : 0);
}
export function refundShares(amount, original) {
  const total = sum(original);
  const divisor = BigInt(total);
  const scaled = original.map(n=>BigInt(n)*BigInt(amount));
  const parts = scaled.map(n=>Number(n/divisor));
  const order = original.map((_,i)=>i).sort((a,b)=>Number(scaled[b]%divisor-scaled[a]%divisor) || a-b);
  order.slice(0,amount-sum(parts)).forEach(i=>parts[i]++);
  return parts;
}
export function settlement(records, count, rate=1) {
  const zeros=()=>Array(count).fill(0);
  const balances=zeros(),paid=zeros(),due=zeros(),advances=zeros(),transfers=[];
  for(const record of records){
    const refund=record.include && record.status===statuses[2]?record.actual:0;
    const parts=settlementParts(record,rate);
    const refunded=roundShare(refund*rate);
    const own=parts[record.payer].original;
    for(let i=0;i<count;i++){
      const part=parts[i];
      if(i===record.payer){
        paid[i]+=roundShare(record.total*rate);
        advances[i]+=roundShare((record.total-record.shares[i])*rate);
        balances[i]+=sum(parts.filter((_,index)=>index!==i).map(p=>p.amount));
      }else if(part)balances[i]-=part.amount;
      if(i===record.receiver && i!==record.payer){
        paid[i]-=refunded;
        balances[i]-=refunded;
        balances[record.payer]+=refunded;
      }else if(i===record.receiver)paid[i]-=refunded;
      due[i]+=i===record.payer?own:part?.amount??0;
    }
  }
  const net=[...balances];
  balances.forEach((_,from)=>{
    for(let to=0;to<count && balances[from]<0;to++){
      if(balances[to]<=0)continue;
      const amount=Math.min(-balances[from],balances[to]);
      transfers.push({from,to,amount});
      balances[from]+=amount;
      balances[to]-=amount;
    }
  });
  return {paid,due,advances,transfers,net};
}

export function settlementParts(record,rate){
  const refund=record.include && record.status===statuses[2]?record.actual:0;
  const back=refundShares(refund,record.shares);
  return record.shares.map((share,i)=>{
    const participating=record.members?.[i] && record.splitCount;
    const raw=participating?(record.total-refund)/record.splitCount:(share-back[i]);
    const original=raw*rate;
    const amount=roundShare(original, Boolean(record.roundHundred));
    return {original,amount,difference:amount-original};
  });
}
const isText = (v,limit=100) => typeof v==='string' && v.length<=limit;
const nameOK = s => isText(s) && s.trim().length>0;
const timeOK = s => isText(s) && Number.isFinite(Date.parse(s));
const rateData = r => r && rateOK(r.value) && timeOK(r.time) && ['手動','ExchangeRate-API','實際換匯','旅程固定匯率'].includes(r.source) && (r.next===undefined || Number.isFinite(r.next));
const choices = (v, options) => v==='' || options.includes(v);
const profile = p => p && nameOK(p.name) && choices(p.method,methods) && feeOK(p.fee) && ['tax','total'].includes(p.basis);
const unique = items => new Set(items).size===items.length;

const isoDate = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
export function validRecord(r, count) {
  const person=n=>Number.isInteger(n) && n>=0 && n<count;
  if (!r || !nameOK(r.id) || !isoDate(r.date) || !nameOK(r.store) || !isText(r.branch) || !isText(r.note,500) || ![...categories,...oldCategories].includes(r.category) || !methods.includes(r.payment) || typeof r.food!=='boolean') return false;
  if (![r.total,r.net,r.tax].every(yen) || !r.total || r.net+r.tax!==r.total || !['auto','tax','total'].includes(r.input) || (r.rate!=null && !rateData(r.rate))) return false;
  if (!(r.photo===null || (typeof r.photo==='string' && r.photo.length<=2500000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(r.photo)))) return false;
  if(r.posted!=null && !yen(r.posted) || r.postedDate && !isoDate(r.postedDate) || r.receivedDate && !isoDate(r.receivedDate))return false;
  if(r.taxRequested!==undefined && typeof r.taxRequested!=='boolean')return false;
  if(r.roundHundred!==undefined && typeof r.roundHundred!=='boolean')return false;
  if(r.splitCount!==undefined && (!Number.isSafeInteger(r.splitCount) || r.splitCount<2 || r.splitCount!==r.members?.filter(Boolean).length))return false;
  const shared = r.mode !== undefined;
  if (shared) {
    if (!modes.includes(r.mode) || !person(r.payer) || !person(r.receiver) || !Array.isArray(r.shares) || r.shares.length>count || r.shares.length===0 || !r.shares.every(yen) || sum(r.shares)!==(r.mode===modes[0]?0:r.total)) return false;
    if (r.members!==undefined && (!Array.isArray(r.members) || r.members.length!==r.shares.length || !r.members.every(n=>typeof n==='boolean') || ([modes[1],modes[3]].includes(r.mode) && even(r.total,r.members).some((n,i)=>n!==r.shares[i])))) return false;
  } else if (['payer','receiver','shares','members','include'].some(k=>k in r)) return false;
  return statuses.includes(r.status) && (!r.food || r.status===statuses[3] || r.taxRequested===false) && choices(r.method,methods) && isText(r.agency) && feeOK(r.fee) && ['tax','total'].includes(r.basis) &&
    (r.status===statuses[2]?yen(r.actual) && r.actual<=r.tax:r.actual===null) &&
    (!shared || (typeof r.include==='boolean' && (!r.include || (r.mode!==modes[0] && r.status===statuses[2]))));
}
export function validState(s) {
  return s && Array.isArray(s.records) && s.records.every(r=>validRecord(r,s.names.length)) && unique(s.records.map(r=>r.id)) &&
    Array.isArray(s.names) && s.names.every(nameOK) &&
    Array.isArray(s.stores) && s.stores.every(p=>profile(p) && [...categories,...oldCategories].includes(p.category)) && unique(s.stores.map(p=>p.name)) &&
    Array.isArray(s.agencies) && s.agencies.every(profile) && unique(s.agencies.map(p=>p.name)) &&
    (s.rate===null || rateData(s.rate));
}
export function legacyTrip(data) {
  const names=data.names?.length?data.names:Array.from({length:4},(_,i)=>'旅伴 '+(i+1));
  const dates=data.records.map(r=>r.date).sort();
  return {id:'legacy',title:'既有旅程',start:dates[0]??'',end:dates.at(-1)??'',split:true,archived:false,names,retired:names.map(()=>false)};
}
export function validTrip(t) {
  return t && nameOK(t.id) && nameOK(t.title) && [t.start,t.end].every(d=>d==='' || isoDate(d)) &&
    (t.lock===undefined || validTripLock(t.lock)) && typeof t.split==='boolean' && typeof t.archived==='boolean' &&
    (t.currency===undefined || currencies.includes(t.currency)) &&
    [t.fixedRate,t.foreignRate].every(rate=>rate==null||rateOK(rate)) &&
    (t.categoryBudgets===undefined || Object.entries(t.categoryBudgets).every(([category,amount])=>categories.includes(category)&&yen(amount))) &&
    [t.budget,t.opening].every(v=>v==null||yen(v)) && (t.cashRate==null||rateOK(t.cashRate)) &&
    (t.memberIds===undefined||(Array.isArray(t.memberIds)&&t.memberIds.length===t.names.length&&t.memberIds.every(nameOK)&&unique(t.memberIds))) &&
    (t.movements===undefined||(Array.isArray(t.movements)&&t.movements.every(m=>m&&nameOK(m.id)&&isoDate(m.date)&&yen(Math.abs(m.amount))&&nameOK(m.kind)))) &&
    (t.checks===undefined||(Array.isArray(t.checks)&&t.checks.every(c=>c&&isoDate(c.date)&&yen(c.amount)&&yen(c.diff)))) &&
    Array.isArray(t.names) && t.names.every(nameOK) && Array.isArray(t.retired) && t.names.length===t.retired.length &&
    t.retired.every(n=>typeof n==='boolean') && (!t.split || t.retired.filter(v=>!v).length>=1);
}
export function validBook(book) {
  return book && Array.isArray(book.trips) && book.trips.every(validTrip) && unique(book.trips.map(t=>t.id)) &&
    (book.trips.length ? book.trips.some(t=>t.id===book.active) : book.active===null) &&
    Array.isArray(book.records) && unique(book.records.map(r=>r.id)) &&
    book.records.every(r=>{const trip=book.trips.find(t=>t.id===r.tripId);return trip && validRecord(r,trip.names.length);}) &&
    validState({...book,names:[],records:[]});
}
export function threshold(record, records) {
  if (!refundRequested(record) || record.food || record.date<'2026-11-01') return null;
  const group = record.branch
    ? records.filter(r=>r.date===record.date && r.store===record.store && r.branch===record.branch && refundRequested(r) && !r.food && r.status!==statuses[3])
    : [record];
  return sum(group.map(r=>r.net));
}
export function feeAmount(r, fee=r.fee, basis=r.basis) {
  return fee===null ? null : Math.round((basis==='tax'?r.tax:r.total)*fee/100);
}

export function travelerCount(trip) {
  return trip?.split ? Math.max(1,trip.retired.filter(retired=>!retired).length) : 1;
}

export function validTripLock(lock) {
  return Boolean(lock && [lock.pin,lock.recovery].every(digest=>typeof digest==='string' && /^[a-f0-9]{64}$/.test(digest)));
}
