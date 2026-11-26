import {summary} from "./budget.js?v=2.3";
import {priorBackup,updateCash,openDB,readBook,scopeBook,writeBook,transitionTrip} from './storage.js?v=2.3';
import {categories,methods,statuses,modes,initial,yen,rateOK,sum,even,refundShares,settlement,settlementParts,categoryOf,refundRequested,currencies,conversion,roundShare,validRecord,validState,validBook,validTrip,travelerCount,legacyTrip,threshold,feeAmount} from './model.js?v=2.3';

const $ = (s, root=document) => root.querySelector(s);
const app = $('#app');
const money = n => '¥'+n.toLocaleString('zh-TW');
const nt = n => 'NT$'+Math.round(n).toLocaleString('zh-TW');
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const option = (s,v) => `<option${s===v?' selected':''}>${esc(s)}</option>`;
const select = (name,values,value) => `<select name="${name}">${values.map(v=>option(v,value)).join('')}</select>`;
const input = (name,value='',attributes='') => `<input name="${name}" value="${esc(value)}" ${attributes}>`;
const label = (title,control,cls='') => `<label class="${cls}">${title}${control}</label>`;
const check = (name,title,on=false) => `<label class="check"><input type="checkbox" name="${name}" ${on?'checked':''}>${title}</label>`;
const button = (text,action,cls='') => `<button type="button" class="${cls}" data-action="${action}">${text}</button>`;
const number = 'type="number" min="0" max="100000000" step="1" inputmode="numeric"';
const percent = 'type="number" min="0" max="100" step="any" inputmode="decimal"';
const rateInput = 'type="number" min="0.00000001" max="100" step="any" inputmode="decimal"';
const dateNow = () => {
  const d=new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
};
const localTime = s => new Date(s).toLocaleString('zh-TW',{hour12:false});
const field = (form,name) => form.elements.namedItem(name);
const value = (form,name) => field(form,name).value.trim();
const num = (form,name) => value(form,name)==='' ? null : Number(value(form,name));
const numIfPresent = (form,name) => field(form,name)?num(form,name):null;
const marked = (form,name) => Boolean(field(form,name)?.checked);
const people = (name,index) => `<select name="${name}">${state.names.map((n,i)=>state.trip.retired[i] && i!==index?'':`<option value="${i}" ${index===i?'selected':''}>${esc(n)}</option>`).join('')}</select>`;
const empty = msg => `<div class="card empty muted">${msg}</div>`;
const errorBox = '<div class="error" role="alert"></div>';
const setError = (form,msg) => { $('.error',form).textContent=msg; };
const order = records => [...records].reverse().sort((a,b)=>b.date.localeCompare(a.date));
let database, state, page='trips', editing=null, refundID=null, pending=false, toastTimer;
let selectedTrip=null;

function toast(msg) {
  $('#notice').textContent=msg;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{$('#notice').textContent='';},4000);
}
async function readState() {
  const book=await readBook(database);
  return scopeBook(book,selectedTrip??book.active);
}
async function commit(updated,change) {
  await writeBook(database,updated,change);
  if(change.active || change.restore)selectedTrip=change.active??updated.active;
  state=await readState();
}
function go(next, id=null) {
  if(!state.trip && !['trips','quick','settings'].includes(next))next='trips';
  if(next==='entry' && state.trip?.archived)next='list';
  if(next==='split' && travelerCount(state.trip)<2)next='trips';
  page=next;
  editing=next==='entry'?id:null;
  refundID=next==='refund'?id:null;
  render();
  scrollTo(0,0);
}
function render() {
  if(!state.trip && !['quick','settings'].includes(page))page='trips';
  $('#trip-title').textContent=state.trip ? state.trip.title+(state.trip.archived?' · 已結案（唯讀）':'') : '我的旅程';

  const inTrip=state.trip && !['trips','quick','settings'].includes(page);
  const nav=$('#trip-navigation');
  nav.hidden=!inTrip;
  nav.innerHTML=inTrip?[
    ['overview','專案首頁'],['entry','記帳'],['list','明細'],['refund','退稅'],['budget','預算'],['split','旅遊分攤']
  ].filter(([id])=>(id!=='entry'||!state.trip.archived)&&(id!=='split'||travelerCount(state.trip)>1))
   .map(([id,title])=>`<button data-page="${id}">${title}</button>`).join(''):'';

  document.querySelectorAll('[data-page]').forEach(b=>{
    if(b.dataset.page===page)b.setAttribute('aria-current','page');
    else b.removeAttribute('aria-current');
  });
  const views={trips:tripsView,overview:overviewView,quick:quickView,entry:entryView,list:listView,refund:refundView,split:splitView,budget:budgetView,settings:settingsView};
  views[page]();
}
const fixedRate = trip=>rateOK(trip.fixedRate)?{value:trip.fixedRate,time:new Date().toISOString(),source:'旅程固定匯率'}:null;
const rateText = rate=>rate ? `1 日圓 ＝ ${rate.value} 台幣 · ${rate.source}` : '未設定換算匯率';
const currencyNames={JPY:'日圓 JPY',TWD:'台幣 TWD',USD:'美元 USD',EUR:'歐元 EUR',KRW:'韓元 KRW',HKD:'港幣 HKD'};
const currencySelect=(name,chosen='JPY')=>`<select name="${name}">${currencies.map(c=>`<option value="${c}" ${c===chosen?'selected':''}>${currencyNames[c]}</option>`).join('')}</select>`;
const currencyAmount=(n,c,decimals=0)=>new Intl.NumberFormat('zh-TW',{style:'currency',currency:c,currencyDisplay:c==='JPY'||c==='TWD'?'symbol':'code',minimumFractionDigits:0,maximumFractionDigits:decimals}).format(n);

function overviewView(){
  const t=state.trip;
  app.innerHTML=`<h1>${esc(t.title)}</h1><section class="card">
    <p>${t.archived?'已結案（唯讀）':travelerCount(t)+' 人旅程'}</p>
    <p class="muted">${rateText(fixedRate(t))}</p>
    <div class="actions">${t.archived?button('重新啟用','reopen:'+esc(t.id)):button('新增記帳','new','primary')+button('編輯旅程','trip-edit:'+esc(t.id))}
    ${button('返回旅程專案','trip-cancel')}</div></section>`;
}

function quickView(){
  app.innerHTML=`<h1>快速分攤</h1><form id="quick-form" class="card grid">
    ${label('消費總金額',input('total','','type="number" min="0" step="any" inputmode="decimal"'))}
    ${label('結算幣別',currencySelect('currency','TWD'))}
    ${label('分攤總人數',input('count',2,'type="number" min="1" step="1" inputmode="numeric"'))}
    <div class="full"><output id="quick-result" aria-live="polite"></output>${check('roundHundred','無條件進位至百位數')}</div>
    </form>`;
  const f=$('#quick-form');
  const update=()=>{
    const total=num(f,'total'), count=num(f,'count'), currency=value(f,'currency');
    const raw=total!==null && total>=0 && Number.isSafeInteger(count) && count>=1?total/count:NaN;
    const rounded=roundShare(raw,marked(f,'roundHundred'));
    $('#quick-result').textContent=Number.isFinite(raw)?`每人應付 ${currencyAmount(rounded,currency)} · 原始 ${currencyAmount(raw,currency,2)} · 差額 ${currencyAmount(rounded-raw,currency,2)}`:'請輸入金額及分攤人數。';
  };
  f.onsubmit=e=>e.preventDefault();
  f.oninput=update;
  update();
}

function tripsView() {
  const group=archived=>state.trips.filter(t=>t.archived===archived).map(t=>`<article class="trip-item">
    <div><small>${t.id===state.trip?.id?'目前旅程 · ':''}${travelerCount(t)>1?'同行 '+travelerCount(t)+' 人':'獨旅'}</small>
    <h3>${esc(t.title)}</h3><span class="muted">${t.start||t.end?'日期備註 '+esc(t.start||'未填')+' ～ '+esc(t.end||'未填'):''}</span></div>
    <div class="actions">${button(archived?'查閱':'進入','switch:'+esc(t.id))}
    ${archived?button('重新啟用','reopen:'+esc(t.id)):button('編輯','trip-edit:'+esc(t.id))+button('結案','close:'+esc(t.id))}</div></article>`).join('');
  app.innerHTML=`<div class="row"><h1>我的旅程</h1>${button('＋ 新增旅程','trip-new','primary')}</div>
    <h2 class="trip-group">進行中</h2>${group(false)||empty('目前沒有進行中的旅程。')}
    <h2 class="trip-group">已結案</h2>${group(true)||'<p class="muted">目前沒有已結案的旅程。</p>'}`;
}
function tripEditor(id) {
  const t=state.trips.find(t=>t.id===id);
  if(t?.archived)return;
  const members=t?t.names.map((name,i)=>({name,retired:t.retired[i],id:t.memberIds?.[i]})):[];
  app.innerHTML=`<h1>${t?'編輯':'新增'}旅程</h1><form id="trip-form" class="card grid">
    ${label('旅程專案名稱',input('title',t?.title,'required maxlength="100" placeholder="例如：2026 關西旅誌"'),'full')}
    ${label('同行人數（含自己）',input('count',travelerCount(t),'type="number" min="1" step="1" inputmode="numeric"'),'full')}
    <div class="full grid" id="party-fields"></div>
    ${label('固定匯率（選填）：1 日圓等於多少台幣',input('fixedRate',t?.fixedRate,rateInput),'full')}
    ${label('分攤結算幣別',currencySelect('currency',t?.currency),'full')}
    ${label('外幣固定換算：1 日圓等於多少結算幣',input('foreignRate',t?.foreignRate,rateInput),'full')}
    <details class="full"><summary>日期備註與預算（選填）</summary><div class="grid">
    ${label('出發日期',input('start',t?.start,'type="date"'))}${label('回國日期',input('end',t?.end,'type="date"'))}
    ${label('旅程總預算（日圓）',input('budget',t?.budget,number))}${label('初始日圓現金',input('opening',t?.opening,number))}</div></details>
    ${errorBox}<div class="full actions"><button class="primary" type="submit">${t?'儲存旅程':'建立並啟用'}</button>${button('取消','trip-cancel')}</div></form>`;
  const f=$('#trip-form'), count=field(f,'count'), party=$('#party-fields');
  const active=()=>members.filter(m=>!m.retired);
  function draw() {
    const n=count.valueAsNumber||1;
    party.hidden=n<2;
    if(n<2){party.replaceChildren();return;}
    while(active().length>n)active().at(-1).retired=true;
    let missing=n-active().length;
    for(const m of members)if(m.retired && missing>0){m.retired=false;missing--;}
    for(let i=0;i<missing;i++)members.push({name:'旅伴 '+(members.length+1),retired:false,id:crypto.randomUUID()});
    party.innerHTML=members.map((m,i)=>m.retired?'':label('旅伴 '+(i+1),input('person'+i,m.name,'maxlength="100"'))).join('');
  }
  draw();
  count.onchange=draw;
  const showForeign=()=>{
    const optional=['JPY','TWD'].includes(value(f,'currency'));
    field(f,'foreignRate').closest('label').hidden=optional;
    field(f,'foreignRate').disabled=optional;
  };
  field(f,'currency').onchange=showForeign;
  showForeign();
  f.oninput=e=>{
    if(e.target.name.startsWith('person'))members[Number(e.target.name.slice(6))].name=e.target.value;
  };
  f.onsubmit=async e=>{
    e.preventDefault();
    if(pending)return;
    const peopleCount=count.value===''?1:count.valueAsNumber;
    if(!Number.isSafeInteger(peopleCount)||peopleCount<1){setError(f,'請輸入有效的同行人數。');return;}
    draw();
    const split=peopleCount>1;
    const trip={...t,memberIds:members.map(m=>m.id??crypto.randomUUID()),budget:num(f,'budget'),opening:num(f,'opening'),fixedRate:num(f,'fixedRate'),currency:value(f,'currency'),foreignRate:num(f,'foreignRate'),id:t?.id??crypto.randomUUID(),title:value(f,'title'),start:value(f,'start'),end:value(f,'end'),
      split,archived:t?.archived??false,names:members.map((m,i)=>m.name.trim()||'旅伴 '+(i+1)),retired:members.map(m=>m.retired)};
    if(!validTrip(trip)){setError(f,'請檢查名稱、人數及選填資料。');return;}
    pending=true;
    try {await commit(state,{trip,active:trip.id});go('overview');toast('已儲存旅程');}
    catch {setError(f,'儲存失敗，請重試。');}
    finally {pending=false;}
  };
}

function recoveryCode(){
  return [...crypto.getRandomValues(new Uint8Array(8))].map(byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
}
async function lockDigest(id,kind,value){
  const data=new TextEncoder().encode(JSON.stringify([id,kind,value]));
  const hash=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function tripLockForm(trip,operation){
  page='trips';
  const closing=operation==='close', recovering=operation==='recover';
  const setup=!trip.lock || recovering;
  const code=setup?recoveryCode():null;
  const title=closing?'確認結案':recovering?'重設 PIN':'重新啟用';
  const pinInput='type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required';
  app.innerHTML=`<h1>${title}</h1><p>${esc(trip.title)}</p>
    <form id="lock-form" class="card">
      <p class="muted">${closing?'結案後可查閱歷史資料。若要追加或更改紀錄，請先重新啟用。':'重新啟用後可繼續記帳和補登退稅。'}</p>
      ${!trip.lock && !closing?'<p class="muted">此旅程由舊版結案，請先設定 PIN 後重新啟用。</p>':''}
      ${recovering?label('原復原碼',input('proof','','autocapitalize="characters" autocomplete="off" required')):''}
      ${setup||!closing?label(setup?'設定四位數 PIN':'輸入四位數 PIN',input('pin','',pinInput)):''}
      ${setup?`<div class="divider">${label('再輸入一次 PIN',input('confirmPin','',pinInput))}
        <p>忘記 PIN 時，可用以下復原碼重設，旅程及帳本資料會保留。請先抄下或複製。</p>
        <p class="recovery-code">${code}</p>${check('saved','我已保存復原碼')}
        <p class="muted">PIN 用於防止誤觸，帳本資料仍可匯出，並未加密。</p></div>`:''}
      ${errorBox}<div class="actions">
        <button class="primary" type="submit">${title}</button>${button('取消','trip-cancel')}
        ${!closing&&!setup?button('忘記 PIN','recover:'+esc(trip.id)):''}
      </div>
    </form>`;
  const f=$('#lock-form');
  if(setup)field(f,'saved').required=true;
  f.onsubmit=async event=>{
    event.preventDefault();
    if(pending)return;
    if(setup && value(f,'pin')!==value(f,'confirmPin')){setError(f,'兩次 PIN 不一致。');return;}
    pending=true;
    try {
      const proof=recovering?await lockDigest(trip.id,'recovery',value(f,'proof').replace(/[\s-]/g,'').toUpperCase()):
        !closing&&!setup?await lockDigest(trip.id,'pin',value(f,'pin')):null;
      if(trip.lock && !closing && proof!==trip.lock[recovering?'recovery':'pin']){
        setError(f,recovering?'復原碼不正確。':'PIN 不正確。');return;
      }
      const newLock=setup?{pin:await lockDigest(trip.id,'pin',value(f,'pin')),recovery:await lockDigest(trip.id,'recovery',code)}:undefined;
      await transitionTrip(database,trip.id,operation,proof,newLock);
      if(closing)state=await readState();
      else await commit(state,{active:trip.id});
      go(closing?'trips':'overview');
      toast(closing?'旅程已結案':'旅程已重新啟用');
    } catch {setError(f,'未能更新旅程，請返回列表後重試。');}
    finally {pending=false;}
  };
}

function entryView() {
  const r=state.records.find(r=>r.id===editing);
  const shared=travelerCount(state.trip)>1;
  app.innerHTML=`<h1>${r?'修改記帳':'新增記帳'}</h1><p class="muted">以日圓記帳，台幣自動換算。</p>
    <form id="entry-form">
      <section class="card grid">
        ${label('日期',input('date',r?.date??dateNow(),'type="date" required'))}
        ${label('付款方式',select('payment',methods,r?.payment))}
        ${label('店家',input('store',r?.store,'list="shop-list" required maxlength="100" placeholder="選擇或輸入店家"')+`<datalist id="shop-list">${state.stores.map(s=>option(s.name)).join('')}</datalist>`)}
        ${label('科目',select('category',categories,r?categoryOf(r):'其他'))}
        <div id="tax-toggle" class="full">${check('taxRequested','是否申請退稅',Boolean(r && refundRequested(r)))}</div>
        <details class="full"><summary>分店及備註</summary><div class="grid">${label('分店（選填）',input('branch',r?.branch,'maxlength="100" placeholder="例：道頓堀店"'))}
        ${label('備註',input('note',r?.note,'maxlength="500"'), 'full')}</div></details>
      </section>
      <section class="card grid">
        <h2 class="full">支出金額</h2>
        ${label('輸入方式','<select name="amountMode"><option value="auto">未稅＋自算稅金</option><option value="tax">未稅＋收據稅金</option><option value="total">實際含稅總額</option></select>','full')}
        ${label('未稅金額（日圓）',input('net',r?.net,number))}
        ${label('收據稅金（日圓）',input('tax',r?.tax,number))}
        ${label('含稅總額（日圓）',input('total',r?.total,number))}
        <p class="full muted">${rateText(r?r.rate:fixedRate(state.trip))}</p>
      </section>
      <div class="hero" aria-live="polite"><div><small>含稅支出</small><strong id="yen-preview">¥0</strong></div><div class="right"><small id="conversion-label"></small><strong id="nt-preview">—</strong></div></div>
      <p id="tax-hint" class="muted"></p>
      ${shared ? `<section class="card">
        ${check('shared','是否需要分攤',Boolean(r?.mode && r.mode!==modes[0]))}
        <div class="grid" id="share-options">
          ${label('分攤總人數（含本人）',input('splitCount',r?.splitCount??(r?.members?.filter(Boolean).length||travelerCount(state.trip)),'type="number" min="2" max="'+travelerCount(state.trip)+'" step="1" inputmode="numeric"'))}
          ${label('誰付款',people('payer',r?.payer??state.trip.retired.indexOf(false)))}
          <details class="full"><summary>指定分攤旅伴</summary><div class="grid" id="participants">
          ${state.names.map((n,i)=>state.trip.retired[i]?'':check('member'+i,esc(n),false)).join('')}
          </div></details>
          <output class="full muted" id="split-preview" aria-live="polite"></output>
          <div class="full">${check('roundHundred','無條件進位至百位數',r?.roundHundred)}</div>
        </div>
      </section>` : ''}
      <section class="card">
        <h2>收據照片 <small>選填一張</small></h2>
        <div class="photo-actions">
          ${label('📷　拍攝收據','<input type="file" name="camera" accept="image/*" capture="environment">')}
          ${label('▧　相簿選取','<input type="file" name="album" accept="image/*">')}
        </div>
        <div id="photo-preview"></div>
      </section>
      ${errorBox}
      <div class="actions"><button class="primary wide" type="submit">${r?'儲存修改':'儲存記帳'}</button>${r?button('取消修改','show-list'):''}</div>
    </form>`;
  const form=$('#entry-form');
  field(form,'amountMode').value=r?.input??'auto';
  form.record=r;
  if(shared)selectParticipants(form,true);
  form.photo=r?.photo??null;
  form.photoReady=Promise.resolve();
  showPhoto(form);
  previewEntry(form);
  form.addEventListener('input',event=>{
    const name=event.target.name;
    if(name==='category')field(form,'taxRequested').checked=false;
    if(name==='store'){
      const store=state.stores.find(s=>s.name===value(form,'store'));
      if(store){
        field(form,'category').value=categoryOf(store);
        field(form,'taxRequested').checked=false;
      }
    }
    if(name==='splitCount')selectParticipants(form,false);
    if(name.startsWith('member') || ['shared','splitCount','payer','roundHundred'].includes(name))form.splitChanged=true;
    previewEntry(form);
  });
  form.addEventListener('change',event=>{
    if (!['camera','album'].includes(event.target.name) || !event.target.files[0]) return;
    const file=event.target.files[0];
    setError(form,'');
    const job=compress(file).then(photo=>{
      if(form.photoReady===job){form.photo=photo;showPhoto(form);}
    }).catch(()=>{
      if(form.photoReady===job)setError(form,'照片無法讀取，請重新選取 JPEG 或 PNG。');
    });
    form.photoReady=job;
  });
  form.onsubmit=e=>{e.preventDefault();saveEntry(form,r);};
}
function amounts(f) {
  const input=value(f,'amountMode'), enteredNet=num(f,'net'), enteredTax=num(f,'tax');
  if(input==='total') {
    const total=num(f,'total')??0, tax=enteredTax??Math.round(total/11);
    return {input,net:total-tax,tax,total};
  }
  const net=enteredNet??0, tax=input==='auto'?Math.round(net*.1):enteredTax??0;
  return {input,net,tax,total:net+tax};
}
function selectedMembers(f){
  return state.names.map((_,i)=>marked(f,'member'+i));
}
function selectParticipants(f,initial){
  const count=num(f,'splitCount');
  const active=state.names.map((_,i)=>i).filter(i=>field(f,'member'+i));
  const old=f.record;
  const preferred=initial&&old?.mode?active.filter(i=>old.members?.[i]??old.shares?.[i]>0):[];
  const order=[...new Set([active[0],...preferred,...active])].slice(0,count);
  for(const i of active)field(f,'member'+i).checked=order.includes(i);
}
function previewEntry(f) {
  const a=amounts(f), rate=f.record?f.record.rate:fixedRate(state.trip);
  const tax=$('#tax-toggle');
  tax.hidden=value(f,'category')!=='購物';
  field(f,'taxRequested').disabled=tax.hidden;
  field(f,'net').closest('label').hidden=a.input==='total';
  field(f,'net').required=a.input!=='total';
  field(f,'total').closest('label').hidden=a.input!=='total';
  field(f,'total').required=a.input==='total';
  field(f,'tax').closest('label').hidden=a.input==='auto';
  field(f,'tax').required=a.input==='tax';
  for (const name of ['net','tax','total']) field(f,name).disabled=field(f,name).closest('label').hidden;
  $('#conversion-label').textContent='折合台幣';
  $('#yen-preview').textContent=money(a.total);
  $('#nt-preview').textContent=rate?nt(a.total*rate.value):'—';
  $('#tax-hint').textContent=`未稅 ${money(a.net)} · 稅金 ${money(a.tax)}`+
    (a.input==='auto'?' · 按 10% 估算；混合 8%／10% 的藥妝請依收據修正。':a.input==='total'&&num(f,'tax')===null?' · 稅金由含稅額按 10% 反推估算，可填收據稅金。':'');
  if(!field(f,'shared'))return;
  const on=marked(f,'shared'), controls=$('#share-options');
  controls.hidden=!on;
  controls.querySelectorAll('input,select').forEach(el=>el.disabled=!on);
  if(!on)return;
  const count=num(f,'splitCount');
  const currency=state.trip.currency??'JPY', fx=conversion(state.trip);
  const raw=count>=2&&rateOK(fx)?a.total/count*fx:null;
  const amount=raw===null?null:roundShare(raw,marked(f,'roundHundred'));
  const legacy=f.record?.mode && f.record.mode!==modes[0] && !f.record.splitCount && !f.splitChanged;
  $('#split-preview').textContent=legacy?'原分攤紀錄保留。調整分攤選項後，本筆會改為均分。':
    amount===null?'每人應付 —（請確認人數及旅程匯率）':
    `每人應付 ${currencyAmount(amount,currency)} · 原始 ${currencyAmount(raw,currency,2)} · 差額 ${currencyAmount(amount-raw,currency,2)}`;
}
async function compress(file) {
  if(file.size>35*1024*1024)throw Error();
  const url=URL.createObjectURL(file);
  try {
    const img=new Image();
    await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;img.src=url;});
    const canvas=document.createElement('canvas'), scale=Math.min(1,1440/Math.max(img.naturalWidth,img.naturalHeight));
    canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.78);
  } finally { URL.revokeObjectURL(url); }
}
function showPhoto(f) {
  $('#photo-preview',f).innerHTML=f.photo?`<img class="receipt" alt="收據照片" src="${f.photo}">${button('移除照片','remove-photo','danger')}`:'';
}
async function saveEntry(f,old) {
  if(pending)return;
  pending=true;
  const submit=$('[type=submit]',f);
  submit.disabled=true;
  try {
    await f.photoReady;
    const a=amounts(f), store=value(f,'store'), category=value(f,'category');
    const taxRequested=category==='購物' && marked(f,'taxRequested');
    const rate=old?old.rate:fixedRate(state.trip);
    const oldShared=old?.mode && old.mode!==modes[0];
    const keepShares=oldShared && !f.splitChanged;
    const members=selectedMembers(f);
    const count=numIfPresent(f,'splitCount');
    const payer=numIfPresent(f,'payer');
    let shareFields={};
    if(keepShares && a.total!==old.total){
      if(!field(f,'shared') || old.mode===modes[2]){
        setError(f,'請在多人旅程調整分攤選項，再修改這筆分攤支出的金額。');return;
      }
      const original=state.names.map((_,i)=>old.members?.[i]??old.shares[i]>0);
      shareFields={members:original,shares:even(a.total,original)};
    }else if(!keepShares && marked(f,'shared')){
      if(!Number.isSafeInteger(count) || count<2 || count>travelerCount(state.trip) || members.filter(Boolean).length!==count || !members[state.trip.retired.indexOf(false)]){
        setError(f,'分攤人數須符合已選旅伴數，並包含本人（第一位旅伴）。');return;
      }
      shareFields={mode:modes[1],payer,receiver:old?.receiver??payer,members,shares:even(a.total,members),splitCount:count,roundHundred:marked(f,'roundHundred'),include:Boolean(old?.include)};
    }else if(!keepShares && old?.mode){
      shareFields={mode:modes[0],shares:state.names.map(()=>0),members:state.names.map(()=>false),splitCount:undefined,roundHundred:false,include:false};
    }
    const profile=state.stores.find(p=>p.name===store);
    const r={...old,...a,...shareFields,tripId:state.trip.id,id:old?.id??crypto.randomUUID(),date:value(f,'date'),
      store,branch:value(f,'branch'),note:value(f,'note'),category,payment:value(f,'payment'),
      food:category==='餐飲',taxRequested,rate:rate??null,photo:f.photo,
      legacyCategory:old?.legacyCategory??(old && old.category!==category?old.category:undefined),
      status:old && old.status!==statuses[3]?old.status:taxRequested?statuses[0]:statuses[3],
      method:old?.method??profile?.method??'',agency:old?.agency??profile?.agency??'',
      fee:old?old.fee:profile?.fee??null,basis:old?.basis??profile?.basis??'tax',actual:old?.actual??null
    };
    if(!validRecord(r,state.names.length)){
      setError(f,'請檢查店名、金額及分攤。已入帳退稅須小於或等於本筆稅金。');return;
    }
    await commit(state,{record:r});
    go('list');toast(old?'已儲存修改':'已新增記帳');
  } catch { setError(f,'儲存失敗，請檢查裝置可用空間後重試。'); }
  finally {pending=false;submit.disabled=false;}
}

function listView() {
  app.innerHTML=`<div class="row"><div><h1>記帳明細</h1><p class="muted">${state.records.length} 筆紀錄</p></div>${state.trip.archived?'':button('新增記帳','new','primary')}</div>
    ${label('查詢店家、日期、分類或備註',input('query','','id="query" type="search" placeholder="輸入關鍵字"'))}<div id="records"></div>`;
  function show() {
    const query=$('#query').value.trim().toLowerCase();
    const records=order(state.records).filter(r=>[r.store,r.date,r.category,r.branch,r.note,r.payment,categoryOf(r)].join(' ').toLowerCase().includes(query));
    $('#records').innerHTML=records.length?records.map(r=>`<article class="card">
      <div class="row"><div><h3>${esc(r.store)} ${esc(r.branch)}</h3><p class="muted">${r.date} · ${categoryOf(r)} · ${r.payment}</p></div>
      <div class="right"><div class="amount">${money(r.total)}</div><small>${r.rate?'折合 '+nt(r.total*r.rate.value):'台幣 —'}</small></div></div>
      <p class="muted">${travelerCount(state.trip)>1?(r.mode?esc(state.names[r.payer])+'付款 · '+r.mode:'個人支出'):''}${r.note?' · '+esc(r.note):''}</p>
      <details><summary>查看金額與收據</summary>${r.posted!=null?'<p>實際入帳 '+nt(r.posted)+' '+esc(r.postedDate)+'</p>':''}<p class="muted">未稅 ${money(r.net)} · 稅金 ${money(r.tax)} · ${esc(rateText(r.rate))}</p>${r.photo?`<img class="receipt" loading="lazy" alt="收據照片" src="${r.photo}">`:''}</details>
      <div class="actions divider"> ${state.trip.archived?(refundRequested(r)||historicalRefund(r)?button('查閱退稅','refund:'+esc(r.id)):''):button('修改','edit:'+esc(r.id))+(refundRequested(r)||historicalRefund(r)?button('退稅','refund:'+esc(r.id)):'')+button('刪除','delete:'+esc(r.id),'danger')}</div>
    </article>`).join(''):empty(query?'找不到符合條件的紀錄。':'帳本目前沒有支出。');
  }
  $('#query').oninput=show;
  show();
}
const official=`<details class="card"><summary>關西國際機場退稅流程</summary>
  <p>2026 年 11 月 1 日起，在免稅店出示護照並先付含稅價。同一店鋪、同一天合格商品未稅合計滿 ¥5,000；全為 10% 稅率時相當於含稅 ¥5,500。分店請填一致的名稱，方便帳本合計。</p>
  <p>在日本當地享用的餐飲不可退稅。符合條件並帶出境的食品可依免稅店規定辦理。</p>
  <p>購買日起 90 天內出境。到關西國際機場後，在托運行李及安檢之前，持護照在國際出發大廳的退稅機辦理海關確認，也可連接指定 Wi-Fi 使用 Visit Japan Web。收到查驗指示時須出示商品。通過後由購買店家按登記方式退款。</p>
  <p>唐吉訶德由 PPIH 公告免收申請手續費，信用卡按 0% 登記。機場現金領取屬例外，費用由業者決定。關西機場海關可確認出境，唐吉訶德在該機場的現金領取地點與費率待確認。</p>
  <p class="muted">查核日期 2026-11-25</p>
  <div class="actions"><a href="https://www.customs.go.jp/kaigairyoko/taxrefund.htm" target="_blank" rel="noopener">日本海關</a><a href="https://www.mlit.go.jp/kankocho/tax-free/content/001991773.pdf" target="_blank" rel="noopener">日本觀光廳</a><a href="https://www.kixdutyfree.jp/en/airport_tax_refund_guide_info.html" target="_blank" rel="noopener">關西機場指南</a><a href="https://ppih.co.jp/news/2026/pr/" target="_blank" rel="noopener">PPIH 公告</a></div>
</details>`;
const basisSelect = v => `<select name="basis"><option value="tax" ${v==='tax'?'selected':''}>按稅金</option><option value="total" ${v==='total'?'selected':''}>按含稅支出</option></select>`;
const historicalRefund = r=>r.actual!==null || r.status===statuses[1] || (r.taxRequested===undefined && refundRequested(r));
const refundAmount = (amount,rate)=>money(amount)+(rate?' · 約 '+nt(amount*rate.value):'');
function recordedConversion(records,amountOf){
  const amounts=records.map(r=>({yen:amountOf(r),rate:r.rate?.value})).filter(x=>x.yen!==0);
  if(!amounts.length || amounts.some(x=>!rateOK(x.rate)))return '';
  return '約 '+nt(sum(amounts.map(x=>x.yen*x.rate)));
}
function refundView() {
  const r=state.records.find(r=>r.id===refundID);
  if(r && (refundRequested(r)||historicalRefund(r))){refundForm(r);return;}
  const listed=state.records.filter(r=>refundRequested(r) || historicalRefund(r));
  const active=state.records.filter(r=>r.status===statuses[1] && r.fee!==null && threshold(r,state.records)>=5000);
  const received=sum(state.records.map(r=>r.actual??0));
  const estimateOf=r=>Math.max(0,r.tax-feeAmount(r));
  app.innerHTML=`<h1>退稅</h1><div class="hero"><div><small>預計淨退稅 · 已知費率</small><strong>${money(sum(active.map(estimateOf)))}</strong><small>${recordedConversion(active,estimateOf)}</small></div><div class="right"><small>實際已入帳</small><strong>${money(received)}</strong><small>${recordedConversion(state.records,r=>r.actual??0)}</small></div></div>
    ${official}
    ${listed.length?order(listed).map(r=>{
      const subtotal=threshold(r,state.records);
      const fee=feeAmount(r);
      const qualified=subtotal!==null && subtotal>=5000;
      return `<article class="card"><div class="row"><div><h3>${esc(r.store)} ${esc(r.branch)}</h3><small>${r.date} · ${r.method||'退稅方式待選'}</small></div><span class="pill">${r.status}</span></div>
        ${r.status===statuses[3]?'':`<p class="muted divider">${qualified?'達金額門檻參考':'資格待確認'} · 估計稅額 ${money(r.tax)} · 手續費 ${fee===null?'待確認':money(fee)} · 預估淨額 ${fee===null||!qualified?'待確認':refundAmount(Math.max(0,r.tax-fee),r.rate)}</p>`}
        ${r.actual===null?'':`<p class="amount">已入帳 ${refundAmount(r.actual,r.rate)}</p>`}
        ${button(state.trip.archived?'查閱退稅':'編輯退稅','refund:'+esc(r.id))}</article>`;
    }).join(''):empty('記帳選擇購物並勾選申請退稅，即可在此登記。')}`;
}
function refundForm(r) {
  const readonly=state.trip.archived;
  const subtotal=threshold(r,state.records);
  const eligible=subtotal!==null && subtotal>=5000;
  const options=state.agencies.filter(a=>a.fee!==null && a.method && (a.name!=='PPIH（唐吉訶德）'||r.store==='唐吉訶德'));
  app.innerHTML=`<div class="row"><div><h1>${readonly?'查閱退稅':'編輯退稅'}</h1><p>${esc(r.store)} ${esc(r.branch)} · ${r.date}</p></div>${button('返回','show-refunds')}</div>
    <p class="muted">${r.food?'餐飲或在日消費，不適用。':subtotal===null?'此筆日期不在新制適用範圍。':`未稅合計參考 ${money(subtotal)} · ${eligible?'達金額門檻，資格以店家及海關確認為準':'門檻待確認'}`}</p>
    <form id="refund-form"><fieldset class="card grid" ${readonly?'disabled':''}>
      ${label('退稅狀態',select('status',r.food?[statuses[3]]:statuses,r.status))}
      ${label('退稅方式',select('method',['',...methods],r.method))}
      ${label('退稅機構',input('agency',r.agency,'list="agency-options" maxlength="100" placeholder="可稍後選擇"')+`<datalist id="agency-options">${state.agencies.map(a=>option(a.name)).join('')}</datalist>`,'full')}
      ${label('手續費（%）',input('fee',r.fee,percent+' placeholder="留空＝待確認"'))}
      ${label('手續費基準',basisSelect(r.basis))}
      <div id="received" class="grid full">
        ${label('退稅入帳日',input('receivedDate',r.receivedDate??dateNow(),'type="date"'))}
        ${label('實際入帳（日圓）',input('actual',r.actual,number))}
        ${r.mode && travelerCount(state.trip)>1?label('誰收到退款',people('receiver',r.receiver)):''}
        ${travelerCount(state.trip)>1 && r.mode && r.mode!==modes[0]?check('include','納入原分攤',r.include):''}
      </div>
      <div class="full muted" id="refund-estimate"></div>
      ${eligible && !r.food && options.length>=2?'<div class="full" id="recommendation"></div>':''}
    </fieldset>${readonly?'':errorBox+'<button type="submit" class="primary wide">儲存退稅</button>'}</form>`;
  const f=$('#refund-form');
  const update=()=>{
    const received=value(f,'status')===statuses[2];
    $('#received').hidden=!received;
    field(f,'actual').required=received;
    field(f,'actual').disabled=!received;
    const fee=feeAmount(r,num(f,'fee'),value(f,'basis'));
    $('#refund-estimate').textContent=r.food?'':`估計稅額 ${money(r.tax)} · 手續費 ${fee===null?'待確認':money(fee)} · 預估淨額 ${eligible && fee!==null ? money(Math.max(0,r.tax-fee)):'待確認'}`;
    const recommendation=$('#recommendation');
    if(recommendation) {
      const compare=[...options].sort((a,b)=>feeAmount(r,a.fee,a.basis)-feeAmount(r,b.fee,b.basis));
      const best=compare[0];
      recommendation.textContent=`若本店接受這些方案，預估淨額最高：${best.name}／${best.method} ${money(Math.max(0,r.tax-feeAmount(r,best.fee,best.basis)))}。請依收據確認可用選項。`;
    }
  };
  f.addEventListener('input',e=>{
    if(e.target.name==='agency'){
      const agency=state.agencies.find(a=>a.name===value(f,'agency') && (a.name!=='PPIH（唐吉訶德）'||r.store==='唐吉訶德'));
      field(f,'method').value=agency?.method??'';
      field(f,'fee').value=agency?.fee??'';
      field(f,'basis').value=agency?.basis??'tax';
    } else if(e.target.name==='method' && value(f,'method')!==r.method) {
      const match=state.agencies.find(a=>a.name===value(f,'agency') && a.method===value(f,'method') && (a.name!=='PPIH（唐吉訶德）'||r.store==='唐吉訶德'));
      field(f,'fee').value=match?.fee??'';
      field(f,'basis').value=match?.basis??'tax';
    }
    update();
  });
  update();
  f.onsubmit=async e=>{
    e.preventDefault();
    if(pending||readonly)return;
    pending=true;
    try {
      const status=value(f,'status'), paid=status===statuses[2];
      const updated={...r,status,method:value(f,'method'),agency:value(f,'agency'),fee:num(f,'fee'),basis:value(f,'basis'),
        receivedDate:paid?(value(f,'receivedDate')||dateNow()):null,actual:paid?num(f,'actual'):null,...(r.mode?{receiver:field(f,'receiver')?num(f,'receiver'):r.receiver,include:paid && (field(f,'include')?marked(f,'include'):r.include)}:{})};
      if(!validRecord(updated,state.names.length)) {setError(f,'實際入帳須為日圓整數，並在 0 至本筆稅金之間。');return;}
      await commit(state,{record:updated});go('refund');toast('已儲存退稅');
    } catch {setError(f,'儲存失敗，請重試。');}
    finally {pending=false;}
  };
}
function splitView(){
  const t=state.trip, currency=t.currency??'JPY', rate=conversion(t);
  const grouped=order(state.records).filter(r=>r.mode && r.mode!==modes[0]);
  const hasRate=rateOK(rate), fmt=n=>currencyAmount(n,currency);
  const result=hasRate?settlement(grouped,state.names.length,rate):null;
  app.innerHTML=`<h1>旅遊分攤</h1><p>結算幣別 ${currencyNames[currency]}</p>
    ${t.archived?'':button('編輯旅伴與結算幣別','trip-edit:'+esc(t.id))}
    ${!hasRate?'<p class="card">尚未設定此結算幣別的固定匯率。</p>':`<section class="card"><h2>每位旅伴</h2>
      ${state.names.map((n,i)=>`<div class="divider"><strong>${esc(n)}${t.retired[i]?'（已退出）':''}</strong>
      <p class="muted">應付 ${fmt(result.due[i])} · 已付（扣退款）${fmt(result.paid[i])} · 原代墊 ${fmt(result.advances[i])}<br>
      結算${result.net[i]>=0?'應收':'應付'} ${fmt(Math.abs(result.net[i]))}</p></div>`).join('')}</section>
      <section class="card"><h2>應付金額</h2>${result.transfers.length?result.transfers.map(x=>
        `<div class="row divider"><strong>${esc(state.names[x.from])} 付給 ${esc(state.names[x.to])}</strong><div class="amount">${fmt(x.amount)}</div></div>`).join(''):'<p class="muted">目前沒有待結算金額。</p>'}</section>`}
    <h2>分攤明細</h2>${grouped.map(r=>{
      const refund=r.include && r.status===statuses[2]?r.actual:0;
      const parts=hasRate?settlementParts(r,rate):null;
      return `<details class="card"><summary>${esc(r.store)} · ${r.date} · ${money(r.total-refund)}</summary>
        <p>原支出 ${money(r.total)} · 納入已退 ${money(refund)}</p>
        <p>付款人 ${esc(state.names[r.payer])}</p>
        ${r.shares.map((n,i)=>n||r.members?.[i]?`<p class="muted">${esc(state.names[i])} · 記帳分攤 ${money(n)}
          ${parts?` · 原始 ${currencyAmount(parts[i].original,currency,2)} · 結算 ${fmt(parts[i].amount)} · 差額 ${currencyAmount(parts[i].difference,currency,2)}`:''}</p>`:'').join('')}
        ${t.archived?'':button('修改記帳','edit:'+esc(r.id))}
      </details>`;
    }).join('')||empty('記帳時可勾選「是否需要分攤」。')}`;
}
function settingsView() {
  app.innerHTML=`<h1>設定與備份</h1>
    <section class="card"><h2>店家與退稅機構</h2>
      <details><summary>預建店家</summary><div class="actions">${state.stores.map((p,i)=>button(esc(p.name),'profile:stores:'+i)).join('')}${button('新增店家','profile:stores:-1')}</div></details>
      <details class="divider"><summary>退稅機構（${state.agencies.length} 家）</summary><div class="actions">${state.agencies.map((p,i)=>button(esc(p.name),'profile:agencies:'+i)).join('')}${button('新增機構','profile:agencies:-1')}</div></details>
      <div id="profile-editor"></div>
    </section>
    <section class="card"><h2>帳本備份與還原</h2><p class="muted">備份包含支出、收據照片、旅伴、分攤及設定。換裝置或更換網站網址前，可先匯出備份。</p>
      <div class="actions">${button('匯出 JSON 備份','export','primary')}${button('匯出升級前備份','prior')}</div>
      <div class="divider">${label('選取備份檔以檢查還原內容','<input id="import" type="file" accept=".json,application/json">')}<div id="import-result" role="status"></div></div>
    </section>
    <section class="card"><h2>加入 iPhone 主畫面</h2><p>在 Safari 開啟本頁，點「分享」→「加入主畫面」。有網路時先開啟一次，等頁面完成載入再離線使用。</p><small id="offline-ready">正在確認離線功能…</small></section>`;
  $('#import').onchange=()=>previewImport($('#import').files[0]);
  showOffline();
}
function profileEditor(group,index) {
  const record=state[group][index], store=group==='stores';
  const container=$('#profile-editor');
  container.innerHTML=`<form class="grid divider" id="profile-form">
    ${label(store?'店家名稱':'機構名稱',input('name',record?.name,'required maxlength="100"'))}
    ${store?label('分類',select('category',categories,record?categoryOf(record):'其他')):''}
    ${label('退稅方式',select('method',['',...methods],record?.method))}
    ${store?label('退稅機構',select('agency',['',...state.agencies.map(a=>a.name)],record?.agency)) : ''}
    ${label('手續費（%）',input('fee',record?.fee,percent+' placeholder="留空＝待確認"'))}
    ${label('手續費基準',basisSelect(record?.basis??'tax'))}
    <div class="full">${errorBox}<div class="actions"><button type="submit" class="primary">儲存${store?'店家':'機構'}</button>${button('取消','cancel-profile')}</div></div>
  </form>`;
  const f=$('#profile-form');
  if(store)field(f,'agency').onchange=()=>{
    const found=state.agencies.find(a=>a.name===value(f,'agency'));
    field(f,'method').value=found?.method??'';
    field(f,'fee').value=found?.fee??'';
    field(f,'basis').value=found?.basis??'tax';
  };
  f.onsubmit=async e=>{
    e.preventDefault();
    const next={name:value(f,'name'),method:value(f,'method'),fee:num(f,'fee'),basis:value(f,'basis')};
    if(store)Object.assign(next,{category:value(f,'category'),agency:value(f,'agency')});
    if(!next.name){setError(f,'請填寫名稱。');return;}
    try {
      const current=await readState(), items=[...current[group]];
      const at=record?items.findIndex(p=>p.name===record.name):-1;
      if(items.some((p,i)=>i!==at && p.name===next.name)){setError(f,'此名稱已存在。');return;}
      if(at>=0)items[at]=next;else items.push(next);
      if(group==='agencies' && record && record.name!==next.name)current.stores=current.stores.map(p=>p.agency===record.name?{...p,agency:next.name}:p);
      await commit({...current,[group]:items},{settings:group==='agencies'?['agencies','stores']:['stores']});render();toast('已儲存設定');
    } catch {setError(f,'儲存失敗，請重試。');}
  };
  f.scrollIntoView({block:'nearest'});
}
async function exportBackup(prior=false) {
  const fresh=await readBook(database);
  const data=prior?await priorBackup(database):{format:'japan-taxfree-ledger',version:2,data:fresh};
  if(!data){toast('此裝置沒有升級前的帳本');return;}
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);
  link.download='japan-taxfree-ledger-'+dateNow()+'.json';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(link.href),30000);
}
let importAttempt=0;
async function previewImport(file) {
  const result=$('#import-result'), attempt=++importAttempt;
  result.replaceChildren();
  if(!file)return;
  try {
    if(file.size>150*1024*1024)throw Error();
    const backup=JSON.parse(await file.text());
    if(backup?.format!=='japan-taxfree-ledger')throw Error();
    let s=backup.data;
    if(backup.version===1 && s?.names?.length===4 && validState(s)){
      const t=legacyTrip(s);
      s={...s,active:t.id,trips:[t],records:s.records.map(r=>({...r,tripId:t.id}))};
    }else if(backup.version!==2)throw Error();
    if(!validBook(s))throw Error();
    if(importAttempt!==attempt||!result.isConnected)return;
    const existing=await readBook(database);
    result.innerHTML=`<p class="muted">還原會用備份中的 ${s.records.length} 筆支出與 ${s.records.filter(r=>r.photo).length} 張照片，取代目前全部 ${existing.trips.length} 個旅程及 ${existing.records.length} 筆支出，還原 ${s.trips.length} 個旅程。旅伴、分攤、預算、現金異動、每日清點、匯率及店家設定也會一併取代。</p><button type="button" class="danger">確認取代並還原</button>`;
    $('button',result).onclick=async e=>{
      if(pending)return;
      if(!confirm('確定以這份備份取代現有帳本與設定？'))return;
      pending=true;e.currentTarget.disabled=true;
      try {await commit(s,{restore:true});go('list');toast('備份已還原');}
      catch {result.textContent='還原失敗。資料交易已取消，請檢查可用空間後重試。';}
      finally {pending=false;}
    };
  } catch {if(importAttempt===attempt)result.textContent='備份格式或資料內容有誤，現有帳本已保留。';}
}
let offlineReady=false;
function showOffline() {
  if($('#offline-ready'))$('#offline-ready').textContent=offlineReady?'離線功能已就緒。':'離線功能尚未就緒，請連上網路重新開啟網站。';
}
async function action(raw) {
  if(!state || pending)return;
  const first=raw.indexOf(':');
  const name=first<0?raw:raw.slice(0,first);
  const id=first<0?'':raw.slice(first+1);
  const trip=state.trips.find(t=>t.id===id);
  if(state.trip?.archived && ['new','edit','delete'].includes(name)){toast('請先重新啟用旅程再修改。');return;}
  switch(name) {
    case 'prior':await exportBackup(true);break;
    case 'trip-new':page='trips';tripEditor();break;
    case 'trip-edit':if(trip && !trip.archived){page='trips';tripEditor(id);}break;
    case 'trip-cancel':go('trips');break;
    case 'switch':await commit(state,{active:id});go('overview');break;
    case 'close':if(trip && !trip.archived)tripLockForm(trip,'close');break;
    case 'reopen':if(trip?.archived)tripLockForm(trip,'reopen');break;
    case 'recover':if(trip?.archived && trip.lock)tripLockForm(trip,'recover');break;
    case 'new':go('entry');break;
    case 'show-list':go('list');break;
    case 'show-refunds':go('refund');break;
    case 'open-settings':go('settings');break;
    case 'edit':go('entry',id);break;
    case 'refund':go('refund',id);break;
    case 'remove-photo':{
      const f=$('#entry-form');
      f.photo=null;f.photoReady=Promise.resolve();
      field(f,'camera').value='';field(f,'album').value='';showPhoto(f);break;
    }
    case 'delete': {
      const r=state.records.find(r=>r.id===id);
      if(!r || !confirm(`確定刪除「${r.store}」${money(r.total)} 的記帳、照片與分攤？`))break;
      pending=true;
      try {await commit(state,{remove:id});render();toast('已刪除紀錄');}
      finally {pending=false;}
      break;
    }
    case 'profile': {const [group,index]=id.split(':');profileEditor(group,Number(index));break;}
    case 'cancel-profile':$('#profile-editor').replaceChildren();break;
    case 'export':await exportBackup();break;
  }
}
document.addEventListener('click',e=>{
  const b=e.target.closest('button');
  if(!b || !state || pending)return;
  if(b.dataset.page)go(b.dataset.page);
  if(b.id==='settings')go('settings');
  if(b.dataset.action)action(b.dataset.action).catch(()=>toast('操作未完成，請重試。'));
});
try {
  database=await openDB();
  state=await readState();
  selectedTrip=state.trip?.id??null;

  app.removeAttribute('aria-busy');
  render();
  if('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(()=>{
      offlineReady=true;showOffline();
    }).catch(showOffline);
  }
} catch (error) {
  app.removeAttribute('aria-busy');
  app.innerHTML='<h1>帳本無法開啟</h1><p>'+esc(error.message.includes('舊版')?error.message:'請確認瀏覽器允許本機儲存，再重新開啟網站。')+'</p>';
}

function categoryBudgetTable(trip,records){
  const actual=Object.fromEntries(categories.map(c=>[c,0]));
  for(const record of records)actual[categoryOf(record)]+=record.total;
  return `<section class="card"><h2>分類預算比較（日圓）</h2>
    <table class="budget-table"><thead><tr><th scope="col">科目</th><th scope="col">預算</th><th scope="col">實際支出</th><th scope="col">差異（百分比）</th></tr></thead><tbody>
    ${categories.map(c=>{
      const budget=trip.categoryBudgets?.[c], spent=actual[c], diff=spent-budget;
      const ratio=budget>0?'（'+(Math.abs(diff)/budget*100).toLocaleString('zh-TW',{maximumFractionDigits:1})+'%）':'';
      const kind=diff>0?'over':diff<0?'under':'equal';
      const status=diff>0?'超支':diff<0?'節約':'符合預算';
      return `<tr><th scope="row">${c}</th><td>${budget==null?'—':budget.toLocaleString('zh-TW')}</td><td>${spent.toLocaleString('zh-TW')}</td>
        <td class="${budget==null?'':kind}">${budget==null?'—':status+(diff?Math.abs(diff).toLocaleString('zh-TW'):'')+ratio}</td></tr>`;
    }).join('')}</tbody></table></section>`;
}
function categoryBudgetForm(trip){
  return `<details class="card"><summary>設定分類預算（選填）</summary><form id="category-budget-form" class="grid">
    ${label('科目',select('category',categories,categories[0]))}
    ${label('預算（日圓）',input('amount',trip.categoryBudgets?.[categories[0]],number+' placeholder="留空為未設定"'))}
    <div class="actions full"><button type="submit" class="primary">儲存此科目</button></div>
    ${errorBox}
    </form></details>`;
}
function bindCategoryBudget(trip){
  const form=$('#category-budget-form');
  field(form,'category').onchange=()=>{field(form,'amount').value=trip.categoryBudgets?.[value(form,'category')]??'';};
  form.onsubmit=async e=>{
    e.preventDefault();
    if(pending)return;
    const category=value(form,'category'), amount=num(form,'amount');
    if(!categories.includes(category) || (amount!==null && !yen(amount)))return;
    pending=true;
    try{
      await commit(state,{categoryBudget:{tripId:trip.id,category,amount}});
      budgetView();
      $('#category-budget-form').closest('details').open=true;
      field($('#category-budget-form'),'category').value=category;
      field($('#category-budget-form'),'category').onchange();
      toast('已儲存分類預算');
    }catch{setError(form,'未能儲存分類預算。');}
    finally{pending=false;}
  };
}
function budgetView(){
  const t=state.trip, totals=summary(t,state.records);
  const rate=t.fixedRate;
  const display=n=>money(n);
  const line=(name,n)=>`<div class="budget-line"><span>${name}</span><strong>${display(n)}</strong></div>`;
  const kinds=['額外換匯','ATM 提款','現金退款','現金補充','現金調整增加','現金調整減少','其他現金移出'];
  const ratio=t.budget?Math.round(totals.spent/t.budget*100):null;
  app.innerHTML=`<h1>旅程預算</h1><h2>${esc(t.title)}</h2>
    <p class="muted">${rateText(fixedRate(t))}</p>
    ${categoryBudgetTable(t,state.records)}
    ${t.archived?'':categoryBudgetForm(t)}
    <section class="card"><div class="row"><h2>累計消費</h2><strong class="amount">${display(totals.spent)}<small>${recordedConversion(state.records,r=>r.total)}</small></strong></div>
    ${t.budget!=null?line('旅程總預算',t.budget)+(rate?'<p class="muted">總預算折合約 '+nt(t.budget*rate)+'</p>':'')+line(totals.spent>t.budget?'預算超支':'剩餘預算',Math.abs(t.budget-totals.spent)):'<p>尚未設定總預算</p>'}
    ${ratio==null?'':`<progress max="100" value="${Math.min(100,ratio)}"></progress> 已使用 ${ratio}%`}
    ${line('現金支出',totals.cash)}${line('信用卡支出',totals.card)}${line('其中雜項支出',totals.misc)}
    ${line('手上剩餘現金',totals.wallet)}${line('預估可退稅（已知費率）',totals.estimate)}${line('已收到退稅',totals.received)}
    ${t.archived?'':button('編輯預算與初始現金','trip-edit:'+esc(t.id))}</section>
    ${t.archived?'':`<form class="card grid" id="count-form"><h2 class="full">每日現金核對</h2>
    ${label('核對日期',input('date',dateNow(),'type="date" required'))}${label('實際清點日圓',input('count','',number+' required'))}
    <output id="count-result" class="full"></output><button class="primary full" type="submit">確認核對</button></form>
    <details class="card" id="movement"><summary>新增現金異動</summary><form class="grid" id="flow-form">
    ${label('異動項目',select('kind',kinds))}${label('日期',input('date',dateNow(),'type="date" required'))}${label('日圓金額',input('amount','',number+' required'))}
    <button type="submit">儲存異動</button></form></details>`}
    <details class="card"><summary>現金異動與清點紀錄</summary>${state.records.some(r=>r.status==='已退稅'&&r.method==='現金'&&!r.receivedDate)?'<p>舊版現金退稅尚無入帳日，暫按消費日計入；可在退稅明細補登。</p>':''}${(t.movements??[]).slice().reverse().map(m=>`<p>${esc(m.date)} · ${esc(m.kind)}　${money(m.amount)}</p>`).join('')}${(t.checks??[]).slice().reverse().map(c=>`<p>${esc(c.date)} · 清點 ${money(c.amount)} · 補記 ${money(c.diff)}</p>`).join('')}</details>`;
  if(t.archived)return;
  bindCategoryBudget(t);
  const f=$('#count-form'), flow=$('#flow-form');
  function preview(){
    const counted=num(f,'count'),day=value(f,'date'),wallet=summary(t,state.records,day).wallet;
    const diff=wallet-counted;
    $('#count-result').textContent='帳面 '+money(wallet)+(counted===null?'':diff>0?' · 今日有 '+money(diff)+' 未記錄現金支出，是否列入雜項支出？':diff<0?' · 多出 '+money(-diff)+'，請確認退款、補充現金或記帳錯誤。':' · 清點相符');
    f.querySelector('button').disabled=counted===null||diff<0;
    if(counted!==null&&diff<0){$('#movement').open=true;field(flow,'date').value=day;field(flow,'kind').value='現金調整增加';field(flow,'amount').value=-diff;}
  }
  f.oninput=preview;preview();
  async function submit(e){
    e.preventDefault();if(pending)return;pending=true;
    try{
      const count=e.target===f,form=e.target,amount=num(form,count?'count':'amount');
      if(!count&&!amount){toast('請輸入正整數');return;}
      await updateCash(database,t.id,value(form,'date'),amount,count?'清點':value(form,'kind'),fixedRate(t));
      state=await readState();budgetView();toast('已儲存');
    }catch{toast('未能儲存，請確認匯率與旅程狀態。');}finally{pending=false;}
  }
  f.onsubmit=flow.onsubmit=submit;
}
function fitKeyboard(){
  const viewport=window.visualViewport;
  if(viewport)document.documentElement.style.setProperty('--keyboard',Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop)+'px');
}
window.visualViewport?.addEventListener('resize',fitKeyboard);
window.visualViewport?.addEventListener('scroll',fitKeyboard);
