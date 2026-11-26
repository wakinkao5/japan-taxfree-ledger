import {feeAmount,threshold} from './model.js?v=2.2';

export function summary(trip,records,date='9999-12-31'){
  let cash=0,card=0,misc=0,received=0,cashRefund=0,estimate=0,flows=0;
  for(const r of records){
    if(r.tripId!==trip.id)continue;
    if(r.date<=date){
      if(r.payment==='現金')cash+=r.total;else card+=r.total;
      if(r.reconciliation)misc+=r.total;
      if(r.status==='預計退稅' && r.fee!=null && threshold(r,records)>=5000)estimate+=Math.max(0,r.tax-feeAmount(r));
    }
    if(r.status==='已退稅' && (r.receivedDate||r.date)<=date){
      received+=r.actual;
      if(r.method==='現金')cashRefund+=r.actual;
    }
  }
  for(const movement of trip.movements||[])if(movement.date<=date)flows+=movement.amount;
  return {cash,card,misc,spent:cash+card,received,estimate,wallet:(trip.opening??0)+flows+cashRefund-cash};
}
