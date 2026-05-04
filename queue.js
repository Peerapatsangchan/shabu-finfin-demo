/* QueueApp: localStorage-based demo (สำหรับ Production ควรมี Backend/JWT/Role จริง) */
(function(){
  const KEY = 'restaurant_queue_v1';
  const AdminKEY = 'restaurant_admin_auth';

  /* === Helpers: วันตามเวลาเครื่อง (หลีกเลี่ยงวันเหลื่อมจาก UTC) === */
  const startOfToday = () => { const d=new Date(); d.setHours(0,0,0,0); return d; };
  const endOfToday   = () => { const d=new Date(); d.setHours(23,59,59,999); return d; };
  const nowLocal     = () => new Date();

  const defaultTables = [
    {id:'T1', name:'โต๊ะ 1', capacity:2,  busy:false},
    {id:'T2', name:'โต๊ะ 2', capacity:2,  busy:false},
    {id:'T3', name:'โต๊ะ 3', capacity:4,  busy:false},
    {id:'T4', name:'โต๊ะ 4', capacity:4,  busy:false},
    {id:'T5', name:'โต๊ะ 5', capacity:6,  busy:false},
    {id:'T6', name:'โต๊ะ 6', capacity:6,  busy:false},
    {id:'T7', name:'โต๊ะ 7', capacity:8,  busy:false},
    {id:'T8', name:'โต๊ะ 8', capacity:10, busy:false},
  ];

  /* ===== Core storage ===== */
  function dayKeyLocal(){
    const d = new Date();
    const y=d.getFullYear();
    const m=String(d.getMonth()+1).padStart(2,'0');
    const dd=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }

  function load(){
    const raw = localStorage.getItem(KEY);
    if(raw){
      const data = JSON.parse(raw);
      // reset รายวัน
      if(data.meta?.date !== dayKeyLocal()){
        data.items  = data.items?.filter(x => ['waiting','called','seated'].includes(x.status)) || [];
        data.history = data.history || [];
        data.stats = {cancelled:0, served:0, total:0, waits:[]};
        data.meta = data.meta || {};
        data.meta.date = dayKeyLocal();
        save(data);
      }
      // กัน undefined
      data.tables = Array.isArray(data.tables) ? data.tables : defaultTables.slice();
      data.meta = data.meta || {};
      if(typeof data.meta.avgServiceMins     !== 'number') data.meta.avgServiceMins = 45;
      if(typeof data.meta.serviceLimitMins   !== 'number') data.meta.serviceLimitMins = 90; // นาทีต่อโต๊ะ
      if(typeof data.meta.calledHoldMins     !== 'number') data.meta.calledHoldMins = 7;     // นาทีรอรับโต๊ะหลังเรียก
      if(typeof data.meta.earlyCallMins      !== 'number') data.meta.earlyCallMins  = 15;    // เรียกจองล่วงหน้ากี่นาที
      return data;
    }
    const init = {
      meta:{
        date: dayKeyLocal(),
        avgServiceMins:45,
        serviceLimitMins:90,
        calledHoldMins:7,
        earlyCallMins:15,
      },
      items:[],
      history:[],
      tables: defaultTables,
      stats:{cancelled:0, served:0, total:0, waits:[]},
    };
    save(init);
    return init;
  }
  function save(data){ localStorage.setItem(KEY, JSON.stringify(data)); }

  /* ===== Utils ===== */
  function uid(){ return 'Q' + Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-3); }
  function six(){ return (Math.floor(Math.random()*900000)+100000).toString(); }
  function nowISO(){ return new Date().toISOString(); }
  function esc(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function msToMinSec(ms){
    let s = Math.max(0, Math.floor(ms/1000));
    const m = Math.floor(s/60); s = s % 60;
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  /* ===== Eligibility ===== */
  function isEligibleNow(item){
    const d = load();
    const st = startOfToday().getTime();
    const et = endOfToday().getTime();
    const now = nowLocal().getTime();
    const earlyMs = (d.meta.earlyCallMins || 0) * 60000;

    if(item.type==='reservation'){
      const r = new Date(item.requestedTime).getTime();
      return (r >= st && r <= et) && (r <= now + earlyMs);
    }else{
      const c = new Date(item.checkInTime).getTime();
      return c >= st && c <= et;
    }
  }

  /* ===== Queue ordering ===== */
  function comparator(a,b){
    if(a.type!==b.type) return a.type==='reservation' ? -1 : 1;
    const ta = a.type==='reservation' ? new Date(a.requestedTime) : new Date(a.checkInTime);
    const tb = b.type==='reservation' ? new Date(b.requestedTime) : new Date(b.checkInTime);
    return ta - tb;
  }
  function getWaitingSorted(){
    const d = load();
    return d.items.filter(x=>x.status==='waiting' && isEligibleNow(x)).sort(comparator);
  }
  function getTodayReservationsPending(){
    const st = startOfToday().getTime();
    const et = endOfToday().getTime();
    const now = nowLocal().getTime();
    const d = load();
    const earlyMs = (d.meta.earlyCallMins || 0) * 60000;
    return d.items.filter(x =>
      x.status==='waiting' && x.type==='reservation'
      && (new Date(x.requestedTime).getTime() >= st && new Date(x.requestedTime).getTime() <= et)
      && (new Date(x.requestedTime).getTime() > now + earlyMs)
    ).sort((a,b)=> new Date(a.requestedTime)-new Date(b.requestedTime));
  }
  function getFutureReservations(){
    const et = endOfToday().getTime();
    const d = load();
    return d.items.filter(x =>
      x.status==='waiting' && x.type==='reservation'
      && new Date(x.requestedTime).getTime() > et
    );
  }

  /* ===== ETA / Stats ===== */
  function etaFor(id){
    const d = load();
    const q = getWaitingSorted();
    const idx = q.findIndex(x=>x.id===id);
    if(idx===-1) return 0;
    const freeTables = d.tables.filter(t=>!t.busy).length || 1;
    const queueAhead = Math.max(0, idx);
    return Math.round((queueAhead / freeTables) * d.meta.avgServiceMins);
  }
  function stats(){
    const d = load();
    const avg = d.stats.waits.length? Math.round(d.stats.waits.reduce((a,b)=>a+b,0)/d.stats.waits.length):0;
    return {
      total:d.stats.total, cancelled:d.stats.cancelled, served:d.stats.served,
      waiting: getWaitingSorted().length, avgWait: avg
    };
  }

  /* ===== Settings ===== */
  function setServiceLimit(mins){
    const d = load();
    d.meta.serviceLimitMins = Math.max(0, Math.min(240, parseInt(mins,10)||90));
    save(d);
    return d.meta.serviceLimitMins;
  }
  function getServiceLimit(){ return load().meta.serviceLimitMins || 90; }

  function setHoldLimit(mins){
    const d = load();
    d.meta.calledHoldMins = Math.max(1, Math.min(30, parseInt(mins,10)||7));
    save(d);
    return d.meta.calledHoldMins;
  }
  function getHoldLimit(){ return load().meta.calledHoldMins || 7; }

  function setEarlyCallLimit(mins){
    const d = load();
    d.meta.earlyCallMins = Math.max(1, Math.min(60, parseInt(mins,10)||0));
    save(d);
    return d.meta.earlyCallMins;
  }
  function getEarlyCallLimit(){ return load().meta.earlyCallMins || 0; }

  /* ===== CRUD queue items ===== */
  function addReservation({name, phone, party, timeISO}){
    const d = load();
    const item = {id:uid(), code:six(), type:'reservation', name, phone, party,
      requestedTime:timeISO, checkInTime:nowISO(), status:'waiting', createdAt:nowISO()};
    d.items.push(item); d.stats.total++;
    save(d); return item;
  }
  function addWalkIn({name, phone, party}){
    const d = load();
    const item = {id:uid(), code:six(), type:'walkin', name, phone, party,
      requestedTime:nowISO(), checkInTime:nowISO(), status:'waiting', createdAt:nowISO()};
    d.items.push(item); d.stats.total++;
    save(d); return item;
  }
  function findItem(id){ return load().items.find(x=>x.id===id); }
  function editItem(id, patch){
    const d = load();
    const i = d.items.findIndex(x=>x.id===id);
    if(i<0) return false;
    d.items[i] = {...d.items[i], ...patch, updatedAt:nowISO()};
    save(d); return true;
  }
  function cancelItem(id, by='user'){
    const d = load();
    const i = d.items.findIndex(x=>x.id===id);
    if(i<0) return false;
    const item = d.items[i];
    if(item.tableId){ const t = d.tables.find(tt=>tt.id===item.tableId); if(t) t.busy = false; }
    item.status='cancelled'; item.cancelledBy=by; item.cancelledAt=nowISO();
    d.stats.cancelled++;
    d.history.push(item);
    d.items.splice(i,1);
    save(d); return true;
  }

  /* ===== Tables ===== */
  function assignTableFor(party, d){
    const cands = d.tables
      .filter(t=>!t.busy && t.capacity>=party)
      .sort((a,b)=>a.capacity-b.capacity);
    if(cands.length===0) return null;
    const t = cands[0]; t.busy = true;
    return t.id;
  }
  function freeTable(tableId){
    const d = load();
    const t = d.tables.find(x=>x.id===tableId);
    if(t){ t.busy=false; save(d); return true; }
    return false;
  }
  function getActiveByTable(tableId){
  const d = load();
  return d.items.find(x =>
    (x.status==='called' || x.status==='seated' || x.status==='awaiting_payment') &&
    x.tableId===tableId
  );
}

  function tables(){ return load().tables || []; }

  /* ===== Flow: call next / seat / complete ===== */
  function nextQueue(){
    const d = load();
    const q = getWaitingSorted();
    if(q.length===0) return {ok:false, reason:'EMPTY'};

    const next = q[0];
    const tableId = assignTableFor(next.party, d);
    if(!tableId) return {ok:false, reason:'NO_TABLE'};

    const ii = d.items.findIndex(x=>x.id===next.id);
    const it = d.items[ii];
    it.status = 'called';
    it.calledAt = nowISO();
    it.tableId = tableId;
    it.callExpireAt = new Date(Date.now() + (d.meta.calledHoldMins||7)*60000).toISOString();

    const baseTime = it.type==='reservation' ? new Date(it.requestedTime) : new Date(it.createdAt);
    const waitMin = Math.max(0, Math.round((Date.now()-baseTime.getTime())/60000));
    d.stats.waits.push(waitMin);

    save(d);
    return {ok:true, item: it};
  }

  function markSeated(id){
    const d = load();
    const i = d.items.findIndex(x=>x.id===id);
    if(i<0) return false;

    const it = d.items[i];

    if(!it.tableId){
      const tid = assignTableFor(it.party, d);
      if(!tid) return false;
      it.tableId = tid;
      it.calledAt = it.calledAt || nowISO();
      it.callExpireAt = new Date(Date.now() + (d.meta.calledHoldMins||7)*60000).toISOString();
    }else{
      const t = d.tables.find(t=>t.id===it.tableId);
      if(t && !t.busy) t.busy = true;
    }

    const clash = d.items.find(x =>
      x.id!==it.id && (x.status==='called'||x.status==='seated') && x.tableId===it.tableId
    );
    if(clash){
      const t = d.tables.find(tt => tt.id===it.tableId);
      if(t) t.busy = false;
      it.tableId = undefined;
      save(d);
      return false;
    }

    it.status   = 'seated';
    it.seatedAt = nowISO();
    const limit = d.meta?.serviceLimitMins ?? 90;
    it.expiresAt = new Date(Date.now() + limit*60000).toISOString();
    delete it.callExpireAt;

    save(d);
    return true;
  }

  function seatByTable(tableId){
    const d = load();
    const occ = d.items.find(x=>x.tableId===tableId && x.status==='called');
    if(!occ) return false;
    return markSeated(occ.id);
  }

  function uncallTable(tableId){
    const d = load();
    const i = d.items.findIndex(x=>x.tableId===tableId && x.status==='called');
    if(i<0) return false;
    const it = d.items[i];
    const t = d.tables.find(tt=>tt.id===tableId);
    if(t) t.busy = false;
    it.status='waiting';
    delete it.tableId;
    delete it.callExpireAt;
    save(d);
    return true;
  }

  function extendSeat(tableId, mins){
    const d = load();
    const occ = d.items.find(x => x.tableId===tableId && x.status==='seated');
    if(!occ) return false;
    const base = occ.expiresAt ? new Date(occ.expiresAt).getTime() : Date.now();
    occ.expiresAt = new Date(base + (parseInt(mins,10)||0)*60000).toISOString();
    save(d); return true;
  }

  function complete(id, bill){  // รองรับแนบบิล
    const d = load();
    const i = d.items.findIndex(x=>x.id===id);
    if(i<0) return false;
    const it = d.items[i];
    if(it.tableId){ const t = d.tables.find(x=>x.id===it.tableId); if(t) t.busy = false; }
    it.status='completed'; it.completedAt=nowISO();

    if(bill && typeof bill === 'object'){
      it.bill = bill;
    }

    d.stats.served++; d.history.push(it); d.items.splice(i,1); save(d);
    return true;
  }

  function completeWithBill(id, bill){
    return complete(id, bill);
  }

  function markNoShow(id){
    const d = load();
    const i = d.items.findIndex(x=>x.id===id); if(i<0) return false;
    const it=d.items[i];
    if(it.tableId){ const t = d.tables.find(x=>x.id===it.tableId); if(t) t.busy = false; }
    it.status='no-show'; it.noShowAt=nowISO();
    d.history.push(it); d.items.splice(i,1); save(d); return true;
  }

  function requeue(id){
    const item = findItem(id); if(!item) return null;
    cancelItem(id,'admin-requeue');
    return addWalkIn({name:item.name, phone:item.phone, party:item.party});
  }

  /* ===== Housekeeping ===== */
  function sweepCalled(){
    const d = load();
    const now = Date.now();
    const expired = d.items.filter(x => x.status==='called' && x.callExpireAt && new Date(x.callExpireAt).getTime() <= now);
    expired.forEach(x=>{
      if(x.tableId){ const t = d.tables.find(tt=>tt.id===x.tableId); if(t) t.busy = false; }
      x.status='no-show';
      x.noShowAt = nowISO();
      d.history.push(x);
      const i = d.items.findIndex(y=>y.id===x.id);
      if(i>=0) d.items.splice(i,1);
    });
    if(expired.length) save(d);
    return expired.length;
  }

  function sweepExpired(){
  const d = load();
  const now = Date.now();

  // หาโต๊ะที่นั่งแล้วและหมดเวลา
  const toFlag = d.items.filter(x =>
    x.status === 'seated' &&
    x.expiresAt &&
    new Date(x.expiresAt).getTime() <= now
  );

  toFlag.forEach(x => {
    // เปลี่ยนสถานะเป็น "รอทำบิล" และคงโต๊ะไว้ (ยัง busy)
    x.status = 'awaiting_payment';
    x.billDueAt = nowISO();     // เวลาเริ่มรอทำบิล
    delete x.expiresAt;         // เลิกนับถอยหลังเวลา
    // แจ้งเตือนฝั่งแอดมิน (ถ้าอนุญาต Notification ไว้)
    notify?.('หมดเวลา – รอทำบิล', `โต๊ะ ${x.tableId || '-'} ของคุณ ${x.name}`);
    beep?.();
  });

  if (toFlag.length) save(d);
  return toFlag.length;
}


  /* ===== Export / Notify / Sound ===== */
  function exportCSV(){
    const d = load();
    const rows = [['id','type','name','phone','party','status','requestedTime','checkInTime','calledAt','seatedAt','expiresAt','callExpireAt','completedAt','noShowAt','tableId','total']];
    [...d.history, ...d.items].forEach(it=>{
      rows.push([
        it.id,it.type,it.name,it.phone,it.party,it.status,
        it.requestedTime,it.checkInTime,it.calledAt||'',it.seatedAt||'',it.expiresAt||'',it.callExpireAt||'',it.completedAt||'',it.noShowAt||'',it.tableId||'',
        it.bill?.total ?? ''
      ]);
    });
    const csv = rows.map(r=>r.map(x=>`"${(x??'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=`queue_report_${dayKeyLocal()}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  function enableNotifications(){
    if(!('Notification' in window)) return Promise.resolve('unsupported');
    if(Notification.permission==='granted') return Promise.resolve('granted');
    if(Notification.permission!=='denied') return Notification.requestPermission();
    return Promise.resolve('denied');
  }
  function notify(title,body){
    if('Notification' in window && Notification.permission==='granted'){
      new Notification(title,{body});
    }
  }
  function beep(){
    try{
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type='sine'; o.frequency.value=880; g.gain.value=0.05;
      o.start(); setTimeout(()=>{o.stop();ctx.close();}, 600);
    }catch(e){}
  }

  /* ===== Admin auth (Demo) ===== */
  function adminLogin({username, password}){
    if(username==='admin' && password==='123456'){
      localStorage.setItem(AdminKEY, JSON.stringify({at:Date.now()}));
      return {ok:true};
    }
    return {ok:false, msg:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'};
  }
  function adminLogout(){ localStorage.removeItem(AdminKEY); }
  function isAdmin(){ return !!localStorage.getItem(AdminKEY); }

  /* ===== Public API ===== */
  window.QueueApp = {
    // core
    load, save, esc, msToMinSec,
    // queue ops
    addReservation, addWalkIn, getWaitingSorted, etaFor,
    myItems: (phone,code)=>{
      const d = load();
      const current = d.items.filter(x=>x.phone===phone && x.code===code);
      const history = d.history.filter(x=>x.phone===phone && x.code===code);
      return {current, history};
    },
    positionOf: (id)=>{
      const q = getWaitingSorted();
      const idx = q.findIndex(x=>x.id===id);
      return idx===-1? null : idx+1;
    },
    editItem, cancelItem, nextQueue, markSeated, complete, completeWithBill, markNoShow, requeue,
    seatByTable, uncallTable,
    // stats/exports
    stats, exportCSV,
    // settings
    setServiceLimit, getServiceLimit, setHoldLimit, getHoldLimit,
    setEarlyCallLimit, getEarlyCallLimit,
    // housekeeping
    sweepExpired, sweepCalled,
    // notify/sound
    enableNotifications, notify, beep,
    // tables
    tables, freeTable, assignTableFor, getActiveByTable, extendSeat,
    // admin auth
    adminLogin, adminLogout, isAdmin,
    // notes
    todayReservationsPending: ()=> getTodayReservationsPending(),
    futureReservationsCount: ()=> getFutureReservations().length
  };
})();
