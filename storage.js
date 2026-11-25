import {summary} from './budget.js?v=2.1';
import {initial,legacyTrip} from './model.js?v=2.1';

export function openDB() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('japan-taxfree-ledger-v1',3);
    req.onblocked=()=>reject(Error('請關閉其他開著舊版帳本的分頁，再重新整理。'));
    req.onerror=()=>reject(req.error);
    req.onupgradeneeded=event=>{
      const db=req.result, tx=req.transaction;
      const records=event.oldVersion ? tx.objectStore('records') : db.createObjectStore('records');
      const settings=event.oldVersion ? tx.objectStore('settings') : db.createObjectStore('settings');
      const trips=event.oldVersion>=2?tx.objectStore('trips'):db.createObjectStore('trips',{keyPath:'id'});
      if(event.oldVersion<2)records.createIndex('tripId','tripId');
      if (!event.oldVersion) return;
      const prior=trips.getAll(),active=settings.get('active'),cfg=settings.get('config'), list=records.getAll();
      list.onsuccess=()=>{
        const data={...initial(),...cfg.result,records:list.result};
        if(event.oldVersion===2)Object.assign(data,{trips:prior.result,active:active.result??null});
        settings.put({format:'japan-taxfree-ledger',version:event.oldVersion,data},'before-upgrade');
        if(event.oldVersion===2){
          for(const t of prior.result)trips.put(withIds(t));
          return;
        }
        if (!cfg.result && !list.result.length) return;
        const trip=legacyTrip({...cfg.result,records:list.result});
        trips.put(withIds(trip));
        settings.put(trip.id,'active');
        for(const r of list.result)records.put({...r,tripId:trip.id},r.id);
      };
    };
    req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>db.close();resolve(db);};
  });
}
export async function access(db,mode,operation) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['records','settings','trips'],mode);
    const stores=Object.fromEntries([...tx.objectStoreNames].map(n=>[n,tx.objectStore(n)]));
    let finish;
    tx.oncomplete=()=>resolve(finish?.());
    tx.onabort=()=>reject(tx.error??Error('交易已取消'));
    try {finish=operation(stores,tx);} catch(e){tx.abort();reject(e);}
  });
}
export function readBook(db) {
  return access(db,'readonly',({records,settings,trips})=>{
    const all=records.getAll(), list=trips.getAll(), active=settings.get('active'),cfg=settings.get('config');
    return ()=>{
      const {stores,agencies,rate}={...initial(),...cfg.result};
      return {stores,agencies,rate,trips:list.result,records:all.result,active:active.result??null};
    };
  });
}
export function scopeBook(book,id=book.active) {
  const trip=book.trips.find(t=>t.id===id);
  return {...book,trip,names:trip?.names??[],records:book.records.filter(r=>r.tripId===id)};
}
export function writeBook(db,updated,change) {
  return access(db,'readwrite',({records,settings,trips},tx)=>{
    if(change.restore){
      records.clear();trips.clear();
      for(const r of updated.records)records.put(r,r.id);
      for(const t of updated.trips)trips.put(withIds(t));
      settings.put(updated.active,'active');
      settings.put({stores:updated.stores,agencies:updated.agencies,rate:updated.rate},'config');
      return;
    }
    if(change.trip){
      const req=trips.get(change.trip.id);
      req.onsuccess=()=>trips.put(withIds({...change.trip,movements:req.result?.movements??[],checks:req.result?.checks??[]}));
    }
    if(change.active)settings.put(change.active,'active');
    if(change.record || change.remove){
      const tripId=change.record?.tripId??updated.trip?.id;
      const read=trips.get(tripId);
      read.onsuccess=()=>{
        if(!read.result || read.result.archived){tx.abort();return;}
        if(change.record){
          const r=change.record,ids=withIds(read.result).memberIds;
          const members=r.mode?{payerId:ids[r.payer],receiverId:ids[r.receiver],sharesById:Object.fromEntries(r.shares.map((n,i)=>[ids[i],n]))}:{};
          records.put({...r,...members},r.id);
        }
        else records.delete(change.remove);
      };
    }
    if(change.settings){
      const cfg=settings.get('config');
      cfg.onsuccess=()=>settings.put({...cfg.result,...Object.fromEntries(change.settings.map(k=>[k,updated[k]]))},'config');
    }
  });
}

function withIds(t){
  return {...t,memberIds:t.names.map((_,i)=>t.memberIds?.[i]??(t.id+'-member-'+i))};
}
export function priorBackup(db){
  return access(db,'readonly',({settings})=>{const req=settings.get('before-upgrade');return ()=>req.result;});
}
export function updateCash(db,id,date,amount,kind,rate){
  return access(db,'readwrite',({trips,records},tx)=>{
    const t=trips.get(id), rows=records.index('tripId').getAll(id);
    rows.onsuccess=()=>{
      const trip=t.result;
      if(!trip||trip.archived||!Number.isSafeInteger(amount)||amount<0){tx.abort();return;}
      if(kind==='清點'){
        const diff=summary(trip,rows.result,date).wallet-amount;
        const checks=trip.checks??[];
        if(diff<0||checks.some(c=>c.date===date&&c.amount===amount&&c.diff===diff))return;
        if(diff>0 && !rate){tx.abort();return;}
        const recordId=crypto.randomUUID();
        if(diff>0)records.add({id:recordId,tripId:id,date,store:'雜項支出',note:'每日現金核對差額',branch:'',category:'其他',payment:'現金',food:false,input:'total',total:diff,net:diff,tax:0,photo:null,rate,status:'不適用',method:'',agency:'',fee:null,basis:'tax',actual:null,reconciliation:true},recordId);
        trips.put({...trip,checks:[...checks,{date,amount,diff,recordId:diff?recordId:null}]});
      }else{
        const sign=['現金調整減少','其他現金移出'].includes(kind)?-1:1;
        trips.put({...trip,movements:[...(trip.movements??[]),{id:crypto.randomUUID(),date,amount:sign*amount,kind}]});
      }
    };
  });
}
