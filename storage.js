import {initial,legacyTrip} from './model.js?v=2.0';

export function openDB() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('japan-taxfree-ledger-v1',2);
    req.onblocked=()=>reject(Error('請關閉其他開著舊版帳本的分頁，再重新整理。'));
    req.onerror=()=>reject(req.error);
    req.onupgradeneeded=event=>{
      const db=req.result, tx=req.transaction;
      const records=event.oldVersion ? tx.objectStore('records') : db.createObjectStore('records');
      const settings=event.oldVersion ? tx.objectStore('settings') : db.createObjectStore('settings');
      const trips=db.createObjectStore('trips',{keyPath:'id'});
      records.createIndex('tripId','tripId');
      if (!event.oldVersion) return;
      const cfg=settings.get('config'), list=records.getAll();
      list.onsuccess=()=>{
        if (!cfg.result && !list.result.length) return;
        const trip=legacyTrip({...cfg.result,records:list.result});
        trips.put(trip);
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
      for(const t of updated.trips)trips.put(t);
      settings.put(updated.active,'active');
      settings.put({stores:updated.stores,agencies:updated.agencies,rate:updated.rate},'config');
      return;
    }
    if(change.trip)trips.put(change.trip);
    if(change.active)settings.put(change.active,'active');
    if(change.record || change.remove){
      const tripId=change.record?.tripId??updated.trip?.id;
      const read=trips.get(tripId);
      read.onsuccess=()=>{
        if(!read.result || read.result.archived){tx.abort();return;}
        if(change.record)records.put(change.record,change.record.id);
        else records.delete(change.remove);
      };
    }
    if(change.settings){
      const cfg=settings.get('config');
      cfg.onsuccess=()=>settings.put({...cfg.result,...Object.fromEntries(change.settings.map(k=>[k,updated[k]]))},'config');
    }
  });
}
