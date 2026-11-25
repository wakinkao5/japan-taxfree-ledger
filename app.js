import {openDB,readBook,scopeBook,writeBook} from './storage.js?v=2.0';
import {categories,methods,statuses,modes,initial,yen,rateOK,sum,even,refundShares,settlement,validRecord,validState,validBook,validTrip,legacyTrip,threshold,feeAmount} from './model.js?v=2.0';

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
const marked = (form,name) => Boolean(field(form,name)?.checked);
const people = (name,index) => `<select name="${name}">${state.names.map((n,i)=>state.trip.retired[i] && i!==index?'':`<option value="${i}" ${index===i?'selected':''}>${esc(n)}</option>`).join('')}</select>`;
const empty = msg => `<div class="card empty muted">${msg}</div>`;
const errorBox = '<div class="error" role="alert"></div>';
const setError = (form,msg) => { $('.error',form).textContent=msg; };
const order = records => [...records].reverse().sort((a,b)=>b.date.localeCompare(a.date));
let database, state, page='entry', editing=null, refundID=null, rateFlag='', pending=false, fxBusy=false, toastTimer;
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
  if(!state.trip && !['trips','settings'].includes(next))next='trips';
  if(next==='entry' && state.trip?.archived)next='list';
  if(next==='split' && !state.trip?.split)next='trips';
  page=next;
  editing=next==='entry'?id:null;
  refundID=next==='refund'?id:null;
  render();
  scrollTo(0,0);
}
function render() {
  if(!state.trip && page!=='settings')page='trips';
  $('#trip-title').textContent=state.trip?.title??'我的旅程';
  $('[data-page=split]').hidden=!state.trip?.split;
  document.querySelectorAll('[data-page]').forEach(b=>{
    if(b.dataset.page===page)b.setAttribute('aria-current','page');
    else b.removeAttribute('aria-current');
  });
  const views={trips:tripsView,entry:entryView,list:listView,refund:refundView,split:splitView,settings:settingsView};
  views[page]();
}
function rateText(rate=state.rate) {
  return rate ? `1 日圓 ≈ ${rate.value.toFixed(5)} 台幣 · ${rate.source} · ${localTime(rate.time)}` : '尚無匯率，請輸入 1 日圓可換的台幣金額';
}
function currentRateText() {
  const fallback = state.rate?.source==='ExchangeRate-API' && (!navigator.onLine || rateFlag || (state.rate.next && state.rate.next<Date.now()));
  return esc((fallback?'沿用最後匯率 · ':'')+rateText()+(rateFlag?' · '+rateFlag:''));
}
function tripsView() {
  const group=archived=>state.trips.filter(t=>t.archived===archived).map(t=>`<article class="trip-item">
    <div><small>${t.id===state.trip?.id?'目前旅程 · ':''}${t.split?'同行 '+t.retired.filter(v=>!v).length+' 人':'個人記帳'}</small>
    <h3>${esc(t.title)}</h3><span class="muted">${esc(t.start)||'日期未設定'}${t.end?' — '+esc(t.end):''}</span></div>
    <div class="actions">${button(archived?'查閱':'進入','switch:'+esc(t.id))}${button('編輯','trip-edit:'+esc(t.id))}
    ${button(archived?'解除封存':'封存','archive:'+esc(t.id))}</div></article>`).join('');
  app.innerHTML=`<div class="row"><h1>我的旅程</h1>${button('＋ 新增旅程','trip-new','primary')}</div>
    ${group(false)||empty('建立一個旅程，開始記下旅途中的花費。')}
    ${state.trips.some(t=>t.archived)?'<h2>已封存旅程</h2>'+group(true):''}`;
}
function tripEditor(id) {
  const t=state.trips.find(t=>t.id===id);
  let members=t?t.names.map((name,i)=>({name,retired:t.retired[i]})):[];
  const active=()=>members.filter(m=>!m.retired).length;
  app.innerHTML=`<h1>${t?'編輯':'新增'}旅程</h1><form id="trip-form" class="card grid">
    ${label('旅程專案名稱',input('title',t?.title,'required maxlength="100" placeholder="例如：2026 關西旅誌"'),'full')}
    ${label('出發日期',input('start',t?.start,'type="date"'))}${label('回國日期',input('end',t?.end,'type="date"'))}
    <div class="full divider">${check('split','啟用同行分攤',t?.split)}</div>
    <div class="full" id="travel-party">${label('同行人數（含自己）',input('count',active()||2,'type="number" min="2" step="1" inputmode="numeric"'))}
    <div id="party-fields" class="grid"></div>${button('＋ 新增旅伴','add-person')}</div>
    ${errorBox}<div class="full actions"><button class="primary" type="submit">儲存旅程</button>${button('取消','trip-cancel')}</div></form>`;
  const f=$('#trip-form'), count=field(f,'count');
  const add=()=>members.push({name:'旅伴 '+(members.length+1),retired:false});
  function draw() {
    count.value=active();
    $('#party-fields').innerHTML=members.map((m,i)=>m.retired?'':`<div class="person-row">${label('旅伴 '+(i+1),input('person'+i,m.name,'required maxlength="100"'))}<button type="button" data-retire="${i}" aria-label="移除旅伴 ${i+1}">−</button></div>`).join('');
  }
  function toggle(){
    const on=marked(f,'split');
    if(on){while(active()<2)add();draw();}
    $('#travel-party').hidden=!on;
    $('#travel-party').querySelectorAll('input').forEach(e=>e.disabled=!on);
  }
  toggle();
  f.oninput=e=>{
    if(e.target.name.startsWith('person'))members[Number(e.target.name.slice(6))].name=e.target.value;
  };
  field(f,'split').onchange=toggle;
  count.onchange=()=>{
    const n=count.valueAsNumber;
    if(!Number.isSafeInteger(n)||n<2)return;
    while(active()<n)add();
    while(active()>n)members.findLast(m=>!m.retired).retired=true;
    draw();
  };
  f.onclick=e=>{
    if(e.target.dataset.action==='add-person'){add();draw();}
    if(e.target.dataset.retire!==undefined){
      if(active()<=2){setError(f,'同行分攤需要至少兩人。');return;}
      members[Number(e.target.dataset.retire)].retired=true;draw();
    }
  };
  f.onsubmit=async e=>{
    e.preventDefault();
    if(pending)return;
    const split=marked(f,'split');
    if(!t && !split)members=[];
    const trip={id:t?.id??crypto.randomUUID(),title:value(f,'title'),start:value(f,'start'),end:value(f,'end'),
      split,archived:t?.archived??false,names:members.map(m=>m.name.trim()),retired:members.map(m=>m.retired)};
    if(!validTrip(trip)){setError(f,'請檢查名稱、人數，以及回國日期是否早於出發日期。');return;}
    pending=true;
    try {await commit(state,{trip,active:trip.id});go(trip.archived?'list':'entry');toast('已儲存旅程');}
    catch {setError(f,'儲存失敗，請重試。');}
    finally {pending=false;}
  };
}

async function refreshRate(force=false) {
  if (fxBusy || (!force && state.rate?.next>Date.now())) return;
  if (!navigator.onLine) {rateFlag='目前離線';connectivity();return;}
  fxBusy=true;
  let timer;
  try {
    const controller=new AbortController();
    timer=setTimeout(()=>controller.abort(),7000);
    const response=await fetch('https://open.er-api.com/v6/latest/JPY',{signal:controller.signal,cache:'no-store'});
    if (!response.ok) throw Error();
    const data=await response.json();
    if (data.result!=='success' || !rateOK(data.rates?.TWD) || !Number.isFinite(data.time_last_update_unix) || !Number.isFinite(data.time_next_update_unix)) throw Error();
    const rate={value:data.rates.TWD,time:new Date(data.time_last_update_unix*1000).toISOString(),next:data.time_next_update_unix*1000,source:'ExchangeRate-API'};
    const current=await readState();
    await commit({...current,rate},{settings:['rate']});
    rateFlag='';
  } catch { rateFlag='匯率來源暫時無法連線'; }
  finally { clearTimeout(timer); fxBusy=false; }
  if ($('#fx-status')) $('#fx-status').innerHTML=currentRateText();
  const form=$('#entry-form');
  if (form && !editing && !field(form,'rate').dataset.changed && state.rate) {
    field(form,'rate').value=state.rate.value;
    previewEntry(form);
  }
}
function entryView() {
  const r=state.records.find(r=>r.id===editing);
  app.innerHTML=`<h1>${r?'修改記帳':'新增記帳'}</h1><p class="muted">以日圓記帳，台幣自動換算。</p>
    <form id="entry-form">
      <section class="card grid">
        ${label('日期',input('date',r?.date??dateNow(),'type="date" required'))}
        ${label('付款方式',select('payment',methods,r?.payment))}
        ${label('店家',input('store',r?.store,'list="shop-list" required maxlength="100" placeholder="選擇或輸入店家"')+`<datalist id="shop-list">${state.stores.map(s=>option(s.name)).join('')}</datalist>`)}
        ${label('分類',select('category',categories,r?.category??'其他'))}
        ${label('分店（選填）',input('branch',r?.branch,'maxlength="100" placeholder="例：道頓堀店"'))}
        ${check('food','餐飲／在日消費',r?.food)}
        ${label('備註',input('note',r?.note,'maxlength="500"'), 'full')}
      </section>
      <section class="card grid">
        <h2 class="full">支出金額</h2>
        ${label('輸入方式','<select name="amountMode"><option value="auto">未稅＋自算稅金</option><option value="tax">未稅＋收據稅金</option><option value="total">實際含稅總額</option></select>','full')}
        ${label('未稅金額（日圓）',input('net',r?.net,number))}
        ${label('收據稅金（日圓）',input('tax',r?.tax,number))}
        ${label('含稅總額（日圓）',input('total',r?.total,number))}
        ${label('日圓 → 台幣匯率',input('rate',r?.rate.value??state.rate?.value,rateInput+' required'))}
        <div class="full muted" id="fx-status">${currentRateText()}</div>
        <div class="full actions">${button('更新匯率','update-rate')}<a class="muted" href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates By Exchange Rate API</a></div>
      </section>
      <div class="hero" aria-live="polite"><div><small>含稅支出</small><strong id="yen-preview">¥0</strong></div><div class="right"><small>約合台幣</small><strong id="nt-preview">—</strong></div></div>
      <p id="tax-hint" class="muted"></p>
      ${state.trip.split ? `<section class="card grid">
        <h2 class="full">同行分攤</h2>
        ${label('誰付款',people('payer',r?.payer??state.trip.retired.indexOf(false)))}
        ${label('分攤方式',select('mode',[modes[0],modes[3],modes[1],modes[2]],r?.mode))}
        <div class="full grid" id="participants">${state.names.map((n,i)=>state.trip.retired[i] && !r?.shares?.[i]?'':check('member'+i,esc(n),r?(r.members?.[i]??r.shares?.[i]>0):true)).join('')}</div>
        <div class="full grid" id="custom-shares">${state.names.map((n,i)=>state.trip.retired[i] && !r?.shares?.[i]?'':label(esc(n),input('share'+i,r?.shares?.[i]||'',number))).join('')}</div>
        <div class="full muted" id="split-preview"></div>
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
  form.originalMembers=r?.mode===modes[3]?r.members:null;
  form.photo=r?.photo??null;
  form.photoReady=Promise.resolve();
  showPhoto(form);
  previewEntry(form);
  form.addEventListener('input',event=>{
    const name=event.target.name;
    if(name==='mode')form.originalMembers=null;
    if (name==='rate') field(form,'rate').dataset.changed='yes';
    if (name==='store') {
      const found=state.stores.find(s=>s.name===value(form,'store'));
      if(found)field(form,'category').value=found.category;
    }
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
function selectedMembers(f,mode) {
  return state.names.map((_,i)=>mode===modes[3]
    ? (f.originalMembers?Boolean(f.originalMembers[i]):!state.trip.retired[i])
    : marked(f,'member'+i));
}
function sharesFor(f,total) {
  const mode=field(f,'mode')?.value;
  if ([modes[1],modes[3]].includes(mode)) return even(total,selectedMembers(f,mode));
  return state.names.map((_,i)=> mode===modes[2] && field(f,'share'+i)?num(f,'share'+i)??0:0);
}
function previewEntry(f) {
  const a=amounts(f), rate=num(f,'rate'), mode=field(f,'mode')?.value;
  field(f,'net').closest('label').hidden=a.input==='total';
  field(f,'net').required=a.input!=='total';
  field(f,'total').closest('label').hidden=a.input!=='total';
  field(f,'total').required=a.input==='total';
  field(f,'tax').closest('label').hidden=a.input==='auto';
  field(f,'tax').required=a.input==='tax';
  for (const name of ['net','tax','total']) field(f,name).disabled=field(f,name).closest('label').hidden;
  $('#yen-preview').textContent=money(a.total);
  $('#nt-preview').textContent=rateOK(rate)?nt(a.total*rate):'—';
  $('#tax-hint').textContent=`未稅 ${money(a.net)} · 稅金 ${money(a.tax)}`+
    (a.input==='auto'?' · 按 10% 估算；混合 8%／10% 的藥妝請依收據修正。':a.input==='total'&&num(f,'tax')===null?' · 稅金由含稅額按 10% 反推估算，可填收據稅金。':'');
  if(!state.trip.split)return;
  $('#participants').hidden=mode!==modes[1];
  $('#custom-shares').hidden=mode!==modes[2];
  $('#custom-shares').querySelectorAll('input').forEach(e=>e.disabled=mode!==modes[2]);
  $('#split-preview').textContent=mode===modes[0]?'':state.names.map((n,i)=>n+' '+money(sharesFor(f,a.total)[i])).join(' · ')+`｜已分配 ${money(sum(sharesFor(f,a.total)))}`;
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
    const a=amounts(f), mode=field(f,'mode')?.value, food=marked(f,'food'), store=value(f,'store');
    const profile=state.stores.find(p=>p.name===store);
    const val=num(f,'rate');
    const rate=old?.rate.value===val?old.rate:state.rate?.value===val && !field(f,'rate').dataset.changed?state.rate:{value:val,time:new Date().toISOString(),source:'手動'};
    const r={
      ...a,tripId:state.trip.id,id:old?.id??crypto.randomUUID(),date:value(f,'date'),store,branch:value(f,'branch'),note:value(f,'note'),
      category:value(f,'category'),payment:value(f,'payment'),food,rate,photo:f.photo,
      ...(state.trip.split?{mode,payer:num(f,'payer'),shares:sharesFor(f,a.total),members:selectedMembers(f,mode)}:{}),
      status:food?statuses[3]:old?.food?statuses[0]:old?.status??statuses[0],
      method:old?.method??profile?.method??'',agency:old?.agency??profile?.agency??'',
      fee:old?old.fee:profile?.fee??null,basis:old?.basis??profile?.basis??'tax',
      actual:food?null:old?.actual??null,...(state.trip.split?{include:!food && mode!==modes[0] && Boolean(old?.include),receiver:old?.receiver??num(f,'payer')}:{})
    };
    if(!validRecord(r,state.names.length)) {
      setError(f,'請檢查店名、金額、匯率及分攤合計。已入帳退稅也須小於或等於本筆稅金。');
      return;
    }
    const current=await readState();
    const saveRate=rate.source==='手動' && (!current.rate || current.rate.source==='手動') && (!old || !current.rate);
    if (saveRate) current.rate=rate;
    await commit(current,{record:r,settings:saveRate?['rate']:null});
    go('list');toast(old?'已儲存修改':'已新增記帳');
  } catch { setError(f,'儲存失敗，請檢查裝置可用空間後重試。'); }
  finally {pending=false;submit.disabled=false;}
}

function listView() {
  app.innerHTML=`<div class="row"><div><h1>記帳明細</h1><p class="muted">${state.records.length} 筆紀錄</p></div>${button('新增記帳','new','primary')}</div>
    ${label('查詢店家、日期、分類或備註',input('query','','id="query" type="search" placeholder="輸入關鍵字"'))}<div id="records"></div>`;
  function show() {
    const query=$('#query').value.trim().toLowerCase();
    const records=order(state.records).filter(r=>[r.store,r.date,r.category,r.branch,r.note,r.payment].join(' ').toLowerCase().includes(query));
    $('#records').innerHTML=records.length?records.map(r=>`<article class="card">
      <div class="row"><div><h3>${esc(r.store)} ${esc(r.branch)}</h3><p class="muted">${r.date} · ${r.category} · ${r.payment}${r.food?' · 餐飲':''}</p></div>
      <div class="right"><div class="amount">${money(r.total)}</div><small>${nt(r.total*r.rate.value)}</small></div></div>
      <p class="muted">${r.mode?esc(state.names[r.payer])+'付款 · '+r.mode:'個人支出'}${r.note?' · '+esc(r.note):''}</p>
      <details><summary>查看金額與收據</summary><p class="muted">未稅 ${money(r.net)} · 稅金 ${money(r.tax)} · ${esc(rateText(r.rate))}</p>${r.photo?`<img class="receipt" loading="lazy" alt="收據照片" src="${r.photo}">`:''}</details>
      <div class="actions divider">${button('修改','edit:'+esc(r.id))}${button('退稅','refund:'+esc(r.id))}${button('刪除','delete:'+esc(r.id),'danger')}</div>
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
function refundView() {
  const r=state.records.find(r=>r.id===refundID);
  if(r){refundForm(r);return;}
  const active=state.records.filter(r=>r.status===statuses[1] && r.fee!==null && threshold(r,state.records)>=5000);
  const received=sum(state.records.map(r=>r.actual??0));
  app.innerHTML=`<h1>退稅</h1><div class="hero"><div><small>預計淨退稅 · 已知費率</small><strong>${money(sum(active.map(r=>Math.max(0,r.tax-feeAmount(r)))))}</strong></div><div class="right"><small>實際已入帳</small><strong>${money(received)}</strong></div></div>
    ${official}
    ${state.records.length?order(state.records).map(r=>{
      const subtotal=threshold(r,state.records);
      const fee=feeAmount(r);
      const qualified=subtotal!==null && subtotal>=5000;
      return `<article class="card"><div class="row"><div><h3>${esc(r.store)} ${esc(r.branch)}</h3><small>${r.date} · ${r.method||'退稅方式待選'}</small></div><span class="pill">${r.status}</span></div>
        ${r.status===statuses[3]?'':`<p class="muted divider">${qualified?'達金額門檻參考':'資格待確認'} · 估計稅額 ${money(r.tax)} · 手續費 ${fee===null?'待確認':money(fee)} · 預估淨額 ${fee===null||!qualified?'待確認':money(Math.max(0,r.tax-fee))}</p>`}
        ${r.actual===null?'':`<p class="amount">已入帳 ${money(r.actual)}</p>`}
        ${button('編輯退稅','refund:'+esc(r.id))}</article>`;
    }).join(''):empty('新增支出後即可登記退稅。')}`;
}
function refundForm(r) {
  const subtotal=threshold(r,state.records);
  const eligible=subtotal!==null && subtotal>=5000;
  const options=state.agencies.filter(a=>a.fee!==null && a.method && (a.name!=='PPIH（唐吉訶德）'||r.store==='唐吉訶德'));
  app.innerHTML=`<div class="row"><div><h1>編輯退稅</h1><p>${esc(r.store)} ${esc(r.branch)} · ${r.date}</p></div>${button('返回','show-refunds')}</div>
    <p class="muted">${r.food?'餐飲或在日消費，不適用。':subtotal===null?'此筆日期不在新制適用範圍。':`未稅合計參考 ${money(subtotal)} · ${eligible?'達金額門檻，資格以店家及海關確認為準':'門檻待確認'}`}</p>
    <form id="refund-form"><div class="card grid">
      ${label('退稅狀態',select('status',r.food?[statuses[3]]:statuses,r.status))}
      ${label('退稅方式',select('method',['',...methods],r.method))}
      ${label('退稅機構',input('agency',r.agency,'list="agency-options" maxlength="100" placeholder="可稍後選擇"')+`<datalist id="agency-options">${state.agencies.map(a=>option(a.name)).join('')}</datalist>`,'full')}
      ${label('手續費（%）',input('fee',r.fee,percent+' placeholder="留空＝待確認"'))}
      ${label('手續費基準',basisSelect(r.basis))}
      <div id="received" class="grid full">
        ${label('實際入帳（日圓）',input('actual',r.actual,number))}
        ${r.mode && state.trip.split?label('誰收到退款',people('receiver',r.receiver)):''}
        ${state.trip.split && r.mode && r.mode!==modes[0]?check('include','納入原分攤',r.include):''}
      </div>
      <div class="full muted" id="refund-estimate"></div>
      ${eligible && !r.food && options.length>=2?'<div class="full" id="recommendation"></div>':''}
    </div>${errorBox}<button type="submit" class="primary wide">儲存退稅</button></form>`;
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
    if(pending)return;
    pending=true;
    try {
      const status=value(f,'status'), paid=status===statuses[2];
      const updated={...r,status,method:value(f,'method'),agency:value(f,'agency'),fee:num(f,'fee'),basis:value(f,'basis'),
        actual:paid?num(f,'actual'):null,...(r.mode?{receiver:field(f,'receiver')?num(f,'receiver'):r.receiver,include:paid && (field(f,'include')?marked(f,'include'):r.include)}:{})};
      if(!validRecord(updated,state.names.length)) {setError(f,'實際入帳須為日圓整數，並在 0 至本筆稅金之間。');return;}
      await commit(state,{record:updated});go('refund');toast('已儲存退稅');
    } catch {setError(f,'儲存失敗，請重試。');}
    finally {pending=false;}
  };
}
function splitView() {
  const grouped=order(state.records).filter(r=>r.mode && r.mode!==modes[0]);
  const {transfers,jpy,paid,due,advances}=settlement(grouped,state.names.length);
  app.innerHTML=`<h1>同行分攤</h1><p class="muted">以日圓結算，台幣以分攤支出的平均入帳匯率估算。</p>
    ${button('編輯旅伴','trip-edit:'+esc(state.trip.id))}
    <section class="card"><h2>每位旅伴</h2>${state.names.map((n,i)=>`<div class="divider"><strong>${esc(n)}${state.trip.retired[i]?'（已退出）':''}</strong><p class="muted">應付 ${money(due[i])} · 已付（扣退款）${money(paid[i])} · 原代墊 ${money(advances[i])}<br>結算${jpy[i]>=0?'應收':'應付'} ${money(Math.abs(jpy[i]))}</p></div>`).join('')}</section>
    <section class="card"><h2>應付金額</h2>
      ${transfers.length?transfers.map(t=>`<div class="row divider"><strong>${esc(state.names[t.from])} 付給 ${esc(state.names[t.to])}</strong><div class="right"><div class="amount">${money(t.amount)}</div><small>約 ${nt(t.twd)}</small></div></div>`).join(''):'<p class="muted">目前沒有待結算金額。</p>'}
    </section><h2>分攤明細</h2>
    ${grouped.length?grouped.map(r=>{
      const refund=r.include && r.status===statuses[2]?r.actual:0;
      const back=refundShares(refund,r.shares);
      return `<details class="card"><summary>${esc(r.store)} ${esc(r.branch)} · ${r.date} · ${money(r.total-refund)}</summary>
        <p>原支出 ${money(r.total)} · 納入已退 ${money(refund)} · 分攤後 ${money(r.total-refund)}</p>
        <p>付款人 ${esc(state.names[r.payer])}${refund?' · 退款收款人 '+esc(state.names[r.receiver]):''}</p>
        ${r.shares.map((n,i)=>`<p class="muted">${esc(state.names[i])} · 原分攤 ${money(n)} · 扣回 ${money(back[i])} · 淨額 ${money(n-back[i])}</p>`).join('')}
        ${button('修改記帳','edit:'+esc(r.id))}
      </details>`;
    }).join(''):empty('記帳時選擇分攤方式，這裡就會顯示明細。')}`;
}
function settingsView() {
  app.innerHTML=`<h1>設定與備份</h1>
    <section class="card"><h2>店家與退稅機構</h2>
      <details><summary>預建店家</summary><div class="actions">${state.stores.map((p,i)=>button(esc(p.name),'profile:stores:'+i)).join('')}${button('新增店家','profile:stores:-1')}</div></details>
      <details class="divider"><summary>退稅機構（${state.agencies.length} 家）</summary><div class="actions">${state.agencies.map((p,i)=>button(esc(p.name),'profile:agencies:'+i)).join('')}${button('新增機構','profile:agencies:-1')}</div></details>
      <div id="profile-editor"></div>
    </section>
    <section class="card"><h2>帳本備份與還原</h2><p class="muted">備份包含支出、收據照片、旅伴、分攤及設定。換裝置或更換網站網址前，可先匯出備份。</p>
      <div class="actions">${button('匯出 JSON 備份','export','primary')}</div>
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
    ${store?label('分類',select('category',categories,record?.category??'其他')):''}
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
async function exportBackup() {
  const fresh=await readBook(database);
  const blob=new Blob([JSON.stringify({format:'japan-taxfree-ledger',version:2,data:fresh})],{type:'application/json'});
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
    result.innerHTML=`<p class="muted">還原會用備份中的 ${s.records.length} 筆支出與 ${s.records.filter(r=>r.photo).length} 張照片，取代目前全部 ${existing.trips.length} 個旅程及 ${existing.records.length} 筆支出，還原 ${s.trips.length} 個旅程。旅伴、分攤、匯率及店家設定也會一併取代。</p><button type="button" class="danger">確認取代並還原</button>`;
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
  const record=state.records.find(r=>r.id===id);
  if(state.trip?.archived && ['new','edit','delete','refund'].includes(name)){toast('請先解除封存再修改。');return;}
  if(name==='edit' && record?.mode && !state.trip.split){toast('這筆含歷史同行資料，請先在旅程設定開啟分攤。');return;}
  switch(name) {
    case 'trip-new':page='trips';tripEditor();break;
    case 'trip-edit':page='trips';tripEditor(id);break;
    case 'trip-cancel':go('trips');break;
    case 'switch':await commit(state,{active:id});go(trip.archived?'list':'entry');break;
    case 'archive':
      await commit(state,{trip:{...trip,archived:!trip.archived}});go('trips');break;
    case 'new':go('entry');break;
    case 'show-list':go('list');break;
    case 'show-refunds':go('refund');break;
    case 'open-settings':go('settings');break;
    case 'edit':go('entry',id);break;
    case 'refund':go('refund',id);break;
    case 'update-rate':await refreshRate(true);toast(rateFlag||'匯率已更新');break;
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
function connectivity() {
  if($('#fx-status'))$('#fx-status').innerHTML=currentRateText();
}
window.addEventListener('online',()=>{connectivity();if(state)refreshRate();});
window.addEventListener('offline',connectivity);
try {
  database=await openDB();
  state=await readState();
  selectedTrip=state.trip?.id??null;
  if(state.trip?.archived)page='list';
  app.removeAttribute('aria-busy');
  render();
  refreshRate();
  if('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).then(()=>{
      offlineReady=true;showOffline();
    }).catch(showOffline);
  }
} catch (error) {
  app.removeAttribute('aria-busy');
  app.innerHTML='<h1>帳本無法開啟</h1><p>'+esc(error.message.includes('舊版')?error.message:'請確認瀏覽器允許本機儲存，再重新開啟網站。')+'</p>';
}
