/* =========================================================
   PLATE — 筋トレ記録
   vanilla JS / localStorage. no build step.
   ========================================================= */
'use strict';

/* ---------- 定数 ---------- */
const PARTS = [
  { id:'chest',    ja:'胸'    },
  { id:'shoulder', ja:'肩'    },
  { id:'arm',      ja:'腕'    },
  { id:'back',     ja:'背中'  },
  { id:'leg',      ja:'脚'    },
  { id:'other',    ja:'その他' },
];
const CARDIO  = { id:'cardio', ja:'有酸素' };
const GROUPS  = PARTS.concat(CARDIO);            // 表示・集計上のまとまり
const PART_JA = Object.fromEntries(GROUPS.map(p => [p.id, p.ja]));

const DOW = ['日','月','火','水','木','金','土'];

/* 体調 5段階。絵文字は端末ごとに絵柄が変わるので自前で描く */
const MOODS = [
  { v:1, ja:'絶不調', mouth:'M8 16.5q4-3.6 8 0',   brow:'M5.6 8.2l3.2 1.4M18.4 8.2l-3.2 1.4' },
  { v:2, ja:'不調',   mouth:'M8.2 15.6q3.8-2 7.6 0', brow:'' },
  { v:3, ja:'ふつう', mouth:'M8.2 15h7.6',           brow:'' },
  { v:4, ja:'good',   mouth:'M8.2 14.4q3.8 2 7.6 0', brow:'' },
  { v:5, ja:'絶好調', mouth:'M7.8 13.6q4.2 4 8.4 0', brow:'M5.6 9.6l3.2-1.4M18.4 9.6l-3.2-1.4' },
];
MOODS[3].ja = '好調';

function faceSVG(m, size){
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="12" cy="12" r="10.2" fill="none" stroke="currentColor" stroke-width="1.5"/>
    ${m.v === 5
      ? '<path d="M7.4 10.2q1.4-1.6 2.8 0M13.8 10.2q1.4-1.6 2.8 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
      : '<circle cx="8.9" cy="10.2" r="1.15" fill="currentColor"/><circle cx="15.1" cy="10.2" r="1.15" fill="currentColor"/>'}
    ${m.brow ? `<path d="${m.brow}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` : ''}
    <path d="${m.mouth}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}
const moodOf = d => db.mood[d] || 0;
const KEY = 'plate.v1';

/* ---------- 小道具 ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const nf = n => Math.round(n).toLocaleString('en-US');

function ymd(d){
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function parseYmd(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function today(){ return ymd(new Date()); }
function shiftDay(s, n){ const d = parseYmd(s); d.setDate(d.getDate()+n); return ymd(d); }
function diffDays(a, b){ return Math.round((parseYmd(a) - parseYmd(b)) / 864e5); }
const isFuture = d => d > today();          // 未来日は記録も選択もできない

/* 数値は 62.5 → "62.5"、60 → "60" */
function w2s(n){ return (Math.round(n*100)/100).toString(); }

/* ---------- ストア ---------- */
/* 週の目標。既定は WHO・厚生労働省の身体活動基準に合わせる */
const WHO_MIN = 150, WHO_DAYS = 2;
const DEFAULT_SETTINGS = { rest:90, auto:true, sound:true, theme:'auto', wStep:2.5,
                           presets:[60,90,120,180], goalMin:WHO_MIN, goalDays:WHO_DAYS };

let db = load();

function load(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){ raw = null; }
  const d = raw && raw.sets ? raw : { v:1, sets:[], notes:{}, mood:{}, settings:{} };
  d.sets     = Array.isArray(d.sets) ? d.sets : [];
  d.notes    = d.notes  || {};
  d.mood     = d.mood   || {};
  d.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
  delete d.custom;            // 旧バージョンの自作種目リストは使わない
  return d;
}
let saveT = null;
function save(){
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch(e){ toast('保存できませんでした（容量超過）'); }
  }, 120);
}

/* 種目は記録履歴からのみ導かれる。プリセットは持たない。 */
const normName = n => String(n).trim().replace(/\s+/g, ' ');

function sortedSets(){
  return db.sets.slice().sort((a,b) => a.date === b.date ? b.ts - a.ts : (a.date < b.date ? 1 : -1));
}

/* 使った順（新しい順）。部位はその種目を最後に記録したときのもの。 */
function allExercises(){
  const seen = new Set(), out = [];
  for (const s of sortedSets()) if (!seen.has(s.ex)){
    seen.add(s.ex);
    out.push({ name:s.ex, part:isCardio(s) ? 'cardio' : s.part, cardio:isCardio(s) });
  }
  return out;
}
function exList(part){ return allExercises().filter(e => e.part === part).map(e => e.name); }

/* 履歴にない名前では null を返す（呼び出し側は今の部位を保つ） */
function partOfEx(name){
  const hit = allExercises().find(e => e.name === name);
  return hit ? hit.part : null;
}
/* 表記ゆれを吸収して、履歴にある綴りへ寄せる */
function canonicalName(name){
  const n = normName(name);
  const hit = allExercises().find(e => e.name.toLowerCase() === n.toLowerCase());
  return hit ? hit.name : n;
}

/* ---------- 種別 ---------- */
/* 筋トレ: {w, r} ／ 有酸素: {k:'c', min, km} */
const isCardio = s => s.k === 'c';

const fmtDur = m => {
  m = Math.round(m);
  return m >= 60 ? `${Math.floor(m/60)}時間${m % 60 ? (m % 60) + '分' : ''}` : `${m}分`;
};
/* 数値だけ大きく出すための HTML 版 */
const durHTML = m => {
  m = Math.round(m);
  return m >= 60 ? `${Math.floor(m/60)}<i>時間</i>${m % 60 ? (m % 60) + '<i>分</i>' : ''}`
                 : `${m}<i>分</i>`;
};
/* KPI 用（単位は <small>） */
const durKPI = m => {
  m = Math.round(m);
  return m >= 60 ? `${Math.floor(m/60)}<small>時間</small>${m % 60 ? (m % 60) + '<small>分</small>' : ''}`
                 : `${m}<small>分</small>`;
};
const paceOf  = s => (s.km > 0 && s.min > 0) ? s.min / s.km : 0;   // 分/km
const fmtPace = v => { const t = Math.round(v * 60); return `${Math.floor(t/60)}:${String(t % 60).padStart(2,'0')}`; };
const km2s    = n => (Math.round(n * 100) / 100).toString();

/* ---------- 集計 ---------- */
const vol = s => isCardio(s) ? 0 : s.w * s.r;
const setsOn   = date => db.sets.filter(s => s.date === date);
const setsOfEx = name => db.sets.filter(s => s.ex === name);
const dayVolume = date => setsOn(date).reduce((a,s) => a + vol(s), 0);

/* 自己ベスト: 重量優先、同重量なら回数 */
function prOf(name){
  let best = null;
  for (const s of setsOfEx(name)){
    if (isCardio(s)) continue;
    if (!best || s.w > best.w || (s.w === best.w && s.r > best.r)) best = s;
  }
  return best;
}
/* 有酸素の記録: 最長距離と、その距離以上での最速ペース */
function cardioBest(name){
  const ss = setsOfEx(name).filter(isCardio);
  if (!ss.length) return null;
  const far  = ss.reduce((a,b) => (b.km || 0) > (a.km || 0) ? b : a);
  const paced = ss.filter(s => paceOf(s) > 0);
  const fast = paced.length ? paced.reduce((a,b) => paceOf(b) < paceOf(a) ? b : a) : null;
  return {
    far, fast,
    n:    ss.length,
    min:  ss.reduce((a,s) => a + s.min, 0),
    km:   ss.reduce((a,s) => a + (s.km || 0), 0),
  };
}
const isCardioEx = name => setsOfEx(name).some(isCardio);
function est1RM(s){ return s.w * (1 + s.r/30); }

/* 直近の同種目セット（今日より前を優先） */
function lastSetOf(name, beforeDate){
  const c = setsOfEx(name)
    .filter(s => !beforeDate || s.date <= beforeDate)
    .sort((a,b) => a.date === b.date ? b.ts - a.ts : (a.date < b.date ? 1 : -1));
  return c[0] || null;
}

function trainedDates(){
  return [...new Set(db.sets.map(s => s.date))].sort();
}
function streak(){
  const set = new Set(db.sets.map(s => s.date));
  if (!set.size) return 0;
  let cur = today(), n = 0;
  if (!set.has(cur)) cur = shiftDay(cur, -1);        // 今日まだなら昨日から数える
  if (!set.has(cur)) return 0;
  while (set.has(cur)){ n++; cur = shiftDay(cur, -1); }
  return n;
}
function volumeByPart(fromDate){
  const m = Object.fromEntries(PARTS.map(p => [p.id, 0]));
  for (const s of db.sets) if (!isCardio(s) && (!fromDate || s.date >= fromDate)) m[s.part] += vol(s);
  return m;
}

/* ---------- UI 状態 ---------- */
const ui = {
  page:'log',
  date: today(),
  part:'chest',
  mode:'w',               // 追加シート内の種別。'w' 筋トレ / 'c' 有酸素
  ex:'',                  // 開いている種目ブロック
  pending:null,           // 追加直後でまだ1セットも無い種目
  sheetQ:'',
  w:'', r:'', min:'', km:'',
  editing:null,           // 編集中セット id
  calM: new Date().getMonth(), calY: new Date().getFullYear(), calSel:null,
  exQ:'',
};

/* ---------- トースト ---------- */
function toast(msg, opts = {}){
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (opts.pr ? ' is-pr' : '');
  t.innerHTML = msg + (opts.action ? `<button type="button">${esc(opts.action)}</button>` : '');
  if (opts.action) t.querySelector('button').onclick = () => { opts.onAction && opts.onAction(); kill(); };
  box.appendChild(t);
  const kill = () => { t.classList.add('is-out'); setTimeout(() => t.remove(), 220); };
  setTimeout(kill, opts.ms || 3400);
  while (box.children.length > 3) box.firstElementChild.remove();
}

/* =========================================================
   インターバルタイマー
   ========================================================= */
const T = { total: 90, left: 90, run:false, endAt:0, done:false, iv:null };

function tSet(sec){ T.total = sec; T.left = sec; T.done = false; if (T.run) T.endAt = Date.now() + sec*1000; tRender(); }
function tStart(sec){
  if (sec) { T.total = sec; T.left = sec; }
  if (T.left <= 0){ T.left = T.total; }
  T.done = false; T.run = true; T.endAt = Date.now() + T.left*1000;
  clearInterval(T.iv); T.iv = setInterval(tTick, 200);
  tRender();
}
function tPause(){ T.run = false; clearInterval(T.iv); T.left = Math.max(0, Math.ceil((T.endAt - Date.now())/1000)); tRender(); }
/* リセットは「設定した既定の休憩時間」へ戻す。+30 を重ねても元に戻せる。 */
function tReset(){
  T.run = false; T.done = false; clearInterval(T.iv);
  T.total = db.settings.rest; T.left = T.total;
  tRender();
}
function tAdd(sec){
  if (T.done){ T.done = false; T.total = Math.max(5, sec); T.left = T.total; tStart(); return; }
  const nt = clamp(T.total + sec, 5, 3600);
  const d  = nt - T.total;                 // 実際に動いた分だけ残り時間も動かす
  T.total = nt;
  if (T.run){
    T.endAt += d * 1000;
    if (T.endAt <= Date.now()){ T.left = 0; tTick(); return; }
  } else {
    T.left = clamp(T.left + d, 0, T.total);
  }
  tRender();
}
function tTick(){
  T.left = Math.max(0, Math.ceil((T.endAt - Date.now())/1000));
  if (T.left <= 0 && !T.done){
    T.done = true; T.run = false; clearInterval(T.iv);
    ding();
    // 一度も操作されていないページではブラウザが拒否して警告を出すので、事前に判定する
    const active = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
    try { if (active && navigator.vibrate) navigator.vibrate([90,70,90]); } catch(e){}
  }
  tRender();
}
function mmss(s){ return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0'); }

/* 音は AudioContext を1つ使い回す。
   iOS/Safari はユーザー操作の中で作った context でないと鳴らないので、
   最初のタップで先に開いておき、タイマー終了時はそれを再開して使う。 */
let AC = null;
function audioCtx(){
  const A = window.AudioContext || window.webkitAudioContext;
  if (!A) return null;
  if (!AC){ try { AC = new A(); } catch(e){ return null; } }
  if (AC.state === 'suspended') AC.resume().catch(() => {});
  return AC;
}
document.addEventListener('pointerdown', () => audioCtx(), { once:true, passive:true });

function ding(){
  if (!db.settings.sound) return;
  beep();
}
function beep(){
  const ac = audioCtx(); if (!ac) return;
  try{
    [0, .18, .36].forEach((t, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = i === 2 ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + t + .012);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + .15);
      o.connect(g); g.connect(ac.destination);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + .18);
    });
  }catch(e){}
}

function tState(){ return T.done ? 'done' : (T.run ? 'run' : 'idle'); }
function tRender(){
  const p = T.total ? clamp(1 - T.left / T.total, 0, 1) : 0;
  const label = T.done ? '再開' : (T.run ? '一時停止' : (T.left < T.total ? '再開' : '開始'));

  const panel = $('#timer');
  if (panel){
    panel.dataset.s = tState();
    panel.style.setProperty('--p', p);
    const read = $('#tRead', panel);
    read.firstChild.nodeValue = mmss(T.left);
    read.classList.toggle('is-done', T.done);
    $('#tSub', panel).textContent = T.done ? '完了' : (T.run ? '残り' : `${T.total}秒`);
    $('#tGo', panel).textContent = T.done ? 'もう一度' : label;
    $$('.tp', panel).forEach(b => b.classList.toggle('is-on', +b.dataset.sec === T.total));
  }

  const dock = $('#dock');
  const need = (T.run || T.done) || (isNarrow() && ui.page === 'log');
  if (need){
    if (dock.hidden){ dock.hidden = false; dock.innerHTML = dockHTML(); }
    dock.dataset.s = tState();
    dock.style.setProperty('--p', p);
    document.documentElement.style.setProperty('--dock-h', dock.offsetHeight + 'px');
    $('#dRead', dock).textContent = mmss(T.left);
    $('#dLab', dock).textContent = T.done ? 'インターバル完了' : 'インターバル';
    $('#dGo', dock).textContent = T.done ? '閉じる' : T.run ? '一時停止' : (T.left < T.total ? '再開' : '開始');
  } else if (!dock.hidden){
    dock.hidden = true; dock.innerHTML = '';
    document.documentElement.style.setProperty('--dock-h', '0px');
  }
}
const isNarrow = () => window.matchMedia('(max-width:960px)').matches;

function dockHTML(){
  return `<div>
      <div class="dock-l" id="dLab">インターバル</div>
      <div class="dock-read n" id="dRead">00:00</div>
    </div>
    <div class="dock-acts">
      <div class="nudge">
        <button data-t="add" data-sec="-30" aria-label="30秒 短く">−30</button>
        <button data-t="add" data-sec="30" aria-label="30秒 延長">+30</button>
      </div>
      <button class="btn-solid" data-t="go" id="dGo">一時停止</button>
      <button class="icon-btn dock-reset" data-t="reset" aria-label="既定の長さに戻す">⟲</button>
    </div>`;
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  const act = b.dataset.t;
  if (act === 'go'){
    if (T.done){ tReset(); }
    else if (T.run) tPause(); else tStart();
  }
  else if (act === 'add') tAdd(+b.dataset.sec);
  else if (act === 'reset') tReset();
  else if (act === 'preset'){ const s = +b.dataset.sec; tSet(s); db.settings.rest = s; save(); }
  else if (act === 'auto'){ db.settings.auto = !db.settings.auto; save(); renderLog(); }
});

/* =========================================================
   記録ページ
   種目ごとのブロックにセット表を持ち、選択中のブロックだけが
   「次のセット」の入力欄を開く。入口は下部の「種目を追加」ひとつ。
   ========================================================= */

/* その日の種目（記録順）＋ まだ1セットも入れていない追加直後の種目 */
function dayBlocks(){
  const ss = setsOn(ui.date), order = [];
  for (const s of ss) if (!order.includes(s.ex)) order.push(s.ex);
  if (ui.pending && !order.includes(ui.pending.name)) order.push(ui.pending.name);
  return order;
}
function blockInfo(name){
  const rows = setsOn(ui.date).filter(s => s.ex === name).sort((a,b) => a.ts - b.ts);
  if (rows.length) return { rows, cardio:isCardio(rows[0]), part:isCardio(rows[0]) ? 'cardio' : rows[0].part };
  const p = ui.pending || {};
  return { rows:[], cardio:!!p.cardio, part:p.cardio ? 'cardio' : (p.part || 'chest') };
}
/* 前回セッションの同じ番号のセット（Strong 系の「前回」列） */
function prevSets(name){
  const past = [...new Set(setsOfEx(name).filter(s => s.date < ui.date).map(s => s.date))].sort();
  const d = past[past.length - 1];
  return d ? { date:d, sets:setsOfEx(name).filter(s => s.date === d).sort((a,b) => a.ts - b.ts) } : null;
}
const setLabel = s => isCardio(s)
  ? `${s.min}分${s.km ? ' ' + km2s(s.km) + 'km' : ''}`
  : `${s.w ? w2s(s.w) + 'kg' : '自重'}×${s.r}`;

/* 入力欄の初期値 */
function suggest(){
  const info = ui.ex ? blockInfo(ui.ex) : null;
  const cardio = info ? info.cardio : ui.mode === 'c';
  const last = ui.ex ? lastSetOf(ui.ex, ui.date) : null;
  // 履歴のない種目に他種目の数値を入れると誤解を招くので空欄で出す
  if (cardio) return (last && isCardio(last))
    ? { min:String(last.min), km:last.km ? km2s(last.km) : '' }
    : { min:'', km:'' };
  return (last && !isCardio(last))
    ? { w:w2s(last.w), r:String(last.r) }
    : { w:'', r:'10' };
}
function syncInputs(){
  const s = suggest();
  if (s.min !== undefined){ ui.min = s.min; ui.km = s.km; }
  else { ui.w = s.w; ui.r = s.r; }
}

/* ---------- ヘッダ ---------- */
function dateHeadHTML(){
  const d = parseYmd(ui.date), n = diffDays(ui.date, today());
  const rel = n === 0 ? '<b>今日</b>' : n === -1 ? '昨日' : n === 1 ? '明日'
            : n < 0 ? `${-n}日前` : `${n}日後`;
  return `<div class="log-head"><div class="datenav">
    <button class="icon-btn" data-l="day" data-n="-1" aria-label="前の日">‹</button>
    <div class="date-block">
      <div class="date-line">
        <span class="d-num n">${d.getMonth()+1}<i>/</i>${d.getDate()}</span>
        <span class="d-dow" data-w="${d.getDay()}">${DOW[d.getDay()]}</span>
      </div>
      <div class="date-sub">${d.getFullYear()}年 · ${rel}</div>
    </div>
    <button class="icon-btn" data-l="day" data-n="1" aria-label="次の日"
      ${isFuture(shiftDay(ui.date, 1)) ? 'disabled' : ''}>›</button>
    ${n !== 0 ? '<button class="btn-text" data-l="today" style="margin-left:8px">今日へ</button>' : ''}
  </div>
  ${moodHTML()}</div>`;
}

function moodHTML(){
  const cur = moodOf(ui.date);
  return `<div class="mood" id="mood">
    <span class="mood-l">${cur ? MOODS[cur-1].ja : '体調'}</span>
    <div class="mood-row">${MOODS.map(m =>
      `<button class="mood-b ${cur === m.v ? 'is-on' : ''}" data-l="mood" data-v="${m.v}"
        aria-label="${m.ja}" aria-pressed="${cur === m.v}" title="${m.ja}">${faceSVG(m, 26)}</button>`).join('')}</div>
  </div>`;
}

function kpisHTML(){
  const ss = setsOn(ui.date);
  const w  = ss.filter(x => !isCardio(x)), c = ss.filter(isCardio);
  const kpi = (v, l, dim) => `<div class="kpi ${dim ? 'kpi--dim' : ''}"><span class="kpi-v n">${v}</span><span class="kpi-l">${l}</span></div>`;
  const out = [];
  if (w.length || !c.length){
    const v = w.reduce((a,s) => a + vol(s), 0), reps = w.reduce((a,s) => a + s.r, 0);
    out.push(kpi(w.length, 'セット', !w.length));
    if (!c.length) out.push(kpi(reps, 'レップ', !reps));
    out.push(kpi(`${nf(v)}<small>kg</small>`, '総挙上量', !v));
  }
  if (c.length){
    const min = c.reduce((a,s) => a + s.min, 0), km = c.reduce((a,s) => a + (s.km || 0), 0);
    out.push(kpi(durKPI(min), '有酸素'));
    if (km) out.push(kpi(`${km2s(km)}<small>km</small>`, '距離'));
  }
  if (!w.length || !c.length) out.push(kpi(new Set(ss.map(s => s.ex)).size, '種目', true));
  return `<div class="kpis" id="logKpis">${out.join('')}</div>`;
}

/* ---------- 種目ブロック ---------- */
function blockHTML(name){
  const { rows, cardio, part } = blockInfo(name);
  const on = ui.ex === name;
  const prev = prevSets(name);
  const pr = cardio ? null : prOf(name);

  const sum = cardio
    ? (rows.length ? `${rows.length}本 · <b>${fmtDur(rows.reduce((a,s)=>a+s.min,0))}</b>` : '')
    : (rows.length ? `${rows.length}セット${(() => { const v = rows.reduce((a,s)=>a+vol(s),0); return v ? ` · <b>${nf(v)}</b>kg` : ''; })()}` : '');

  const setRows = rows.map((s, i) => {
    const p = prev && prev.sets[i];
    const isPR = pr && pr.id === s.id && setsOfEx(name).filter(x => !isCardio(x)).length > 1;
    const val = isCardio(s)
      ? `${s.min}<i>分</i>${s.km ? ` <span class="s-dot">·</span> ${km2s(s.km)}<i>km</i>` : ''}${
          paceOf(s) ? `<em>${fmtPace(paceOf(s))}/km</em>` : ''}`
      : `${s.w ? w2s(s.w) + '<i>kg</i>' : '自重'} <span class="s-dot">×</span> ${s.r}${
          isPR ? '<em class="s-pr">自己ベスト</em>' : ''}`;
    return `<li class="srow" data-id="${s.id}">
      <span class="s-i">${i+1}</span>
      <span class="s-prev">${p ? esc(setLabel(p)) : ''}</span>
      <span class="s-val n">${val}</span>
      <button class="icon-btn s-menu" data-l="menu" data-id="${s.id}" aria-label="このセットの操作">⋯</button>
    </li>`;
  }).join('');

  return `<section class="blk ${on ? 'is-on' : ''}" style="--pig:var(--p-${part})" data-ex="${esc(name)}">
    <button class="blk-h" data-l="focus" data-v="${esc(name)}">
      <span class="pig"></span>
      <h3>${esc(name)}</h3>
      <span class="blk-tag">${PART_JA[part]}</span>
      <span class="blk-sum">${sum}</span>
    </button>
    ${rows.length ? `<ol class="blk-sets">${setRows}</ol>` : ''}
    ${on ? entryHTML(name, cardio, rows.length, prev)
         : `<button class="blk-more" data-l="focus" data-v="${esc(name)}">＋ セットを追加</button>`}
  </section>`;
}

/* ---------- 次のセットの入力 ---------- */
function fieldHTML(key, label, note, value, unit, step, quicks, ph){
  return `<div class="fld-wrap">
    <div class="fld-l">${label}${note ? `<span class="opt">${note}</span>` : ''}</div>
    <div class="fld">
      <button class="fld-b" data-l="${key}" data-n="-${step}" aria-label="減らす">−</button>
      <div class="fld-in">
        <input class="n" id="in${key}" inputmode="${key === 'r' || key === 'min' ? 'numeric' : 'decimal'}"
               value="${esc(value)}" ${ph ? `placeholder="${ph}"` : ''} aria-label="${label}">
        <span>${unit}</span>
      </div>
      <button class="fld-b" data-l="${key}" data-n="${step}" aria-label="増やす">＋</button>
    </div>
    <div class="quicks">${quicks}</div>
  </div>`;
}

function entryHTML(name, cardio, count, prev){
  const editing = ui.editing && db.sets.find(x => x.id === ui.editing);
  const nth = editing ? '' : `<b>${count + 1}</b>${cardio ? '本目' : 'セット目'}`;
  const ref = prev && prev.sets[count];
  const d = prev ? parseYmd(prev.date) : null;
  const hint = editing
    ? '<span class="ed">このセットを編集中</span>'
    : ref ? `前回 ${d.getMonth()+1}/${d.getDate()} は <b>${esc(setLabel(ref))}</b>`
    : prev ? `前回 ${d.getMonth()+1}/${d.getDate()} · ${prev.sets.length}${cardio ? '本' : 'セット'}`
    : 'この種目は初めてです';

  const fields = cardio
    ? fieldHTML('min', '時間', '', ui.min, '分', 5,
        [5,10,15,30].map(v => `<button class="q" data-l="min" data-n="${v}">+${v}</button>`).join(''), '—') +
      fieldHTML('km', '距離', '任意', ui.km, 'km', 0.5,
        [0.5,1,5].map(v => `<button class="q" data-l="km" data-n="${v}">+${v}</button>`).join(''), '—')
    : fieldHTML('w', '重量', '', ui.w, 'kg', db.settings.wStep,
        [2.5,5,10,20].map(v => `<button class="q" data-l="w" data-n="${v}">+${v}</button>`).join(''), '—') +
      fieldHTML('r', '回数', '', ui.r, '回', 1,
        [5,8,10,12,15].map(v => `<button class="q" data-l="rset" data-n="${v}">${v}</button>`).join(''));

  const pace = cardio ? (() => {
    const m = parseInt(ui.min,10), k = parseFloat(ui.km);
    const p = (k > 0 && m > 0) ? m / k : 0;
    return `<div class="pace ${p ? '' : 'is-off'}"><span class="micro">ペース</span><b class="n">${
      p ? fmtPace(p) : '—'}</b><i>/km</i></div>`;
  })() : '';

  return `<div class="entry ${editing ? 'is-edit' : ''}" id="entry">
    <div class="entry-top">${nth}<span class="entry-hint">${hint}</span>
      ${editing ? '<button class="btn-text" data-l="cancelEdit">やめる</button>' : ''}</div>
    <div class="entry-grid">
      ${fields}
      <div class="entry-go">${pace}
        <button class="btn-rec" id="btnLog" data-l="log">${editing ? '更新' : '記録'}</button></div>
    </div>
  </div>`;
}

/* ---------- サイド ---------- */
function sideTodayHTML(){
  const ss = setsOn(ui.date);
  if (!ss.length) return `<div class="side-empty">記録すると部位ごとの内訳が出ます。</div>`;
  const by = {}; for (const s of ss) by[isCardio(s) ? 'cardio' : s.part] = (by[isCardio(s) ? 'cardio' : s.part] || 0) + effVol(s);
  const tot = Object.values(by).reduce((a,b) => a+b, 0) || 1;
  const used = GROUPS.filter(p => by[p.id]);
  return `<div class="split">${used.map(p =>
      `<i style="--pig:var(--p-${p.id}); flex:${(by[p.id]/tot).toFixed(4)}"></i>`).join('')}</div>` +
    used.map(p => {
      const rows = ss.filter(s => (isCardio(s) ? 'cardio' : s.part) === p.id);
      const v = rows.reduce((a,s) => a + vol(s), 0);
      const val = p.id === 'cardio' ? durHTML(rows.reduce((a,s) => a + s.min, 0))
                : v ? nf(v)+'<i>kg</i>'
                : rows.reduce((a,s) => a + s.r, 0)+'<i>回</i>';
      return `<div class="mini-row" style="--pig:var(--p-${p.id})"><span class="pig"></span>
        <span>${p.ja}</span><b>${val}</b></div>`;
    }).join('');
}

function prevSessionHTML(){
  const past = trainedDates().filter(d => d < ui.date);
  const d = past[past.length - 1];
  if (!d) return `<div class="side-empty">過去のセッションはまだありません。</div>`;
  const ss = setsOn(d);
  const order = []; for (const s of ss) if (!order.includes(s.ex)) order.push(s.ex);
  const dd = parseYmd(d), gap = diffDays(ui.date, d);
  const parts = [...new Set(ss.map(s => isCardio(s) ? 'cardio' : s.part))];
  return `<button class="prev-sess" data-l="jump" data-d="${d}" title="この日を開く">
    <div class="ps-top">
      <span class="ps-date n">${dd.getMonth()+1}<i>/</i>${dd.getDate()}</span>
      <span class="ps-dow">${DOW[dd.getDay()]}</span>
      <span class="ps-gap">${gap}日前</span>
    </div>
    <div class="ps-vol"><b class="n">${nf(dayVolume(d))}</b>kg<span>${ss.length}セット · ${order.length}種目</span></div>
    <div class="ps-pigs">${parts.map(p => `<i style="--pig:var(--p-${p})"></i>`).join('')}</div>
    <p class="ps-list">${order.map(esc).join('、')}</p>
  </button>`;
}

function timerHTML(){
  return `<section class="timer" id="timer" data-s="idle" style="--p:0">
    <div class="timer-top">
      <span class="micro">インターバル</span>
      <button class="timer-auto" data-t="auto" aria-pressed="${db.settings.auto}">記録後に自動開始<span class="sw" data-on="${db.settings.auto ? 1 : 0}"></span></button>
    </div>
    <div class="timer-read n" id="tRead">01:30<small id="tSub">90秒</small></div>
    <div class="timer-presets">
      ${db.settings.presets.map(s => `<button class="tp" data-t="preset" data-sec="${s}">${s}<i>s</i></button>`).join('')}
    </div>
    <div class="timer-acts">
      <button class="btn-solid" data-t="go" id="tGo">開始</button>
      <div class="nudge">
        <button data-t="add" data-sec="-30">−30</button>
        <button data-t="add" data-sec="30">+30</button>
      </div>
      <button class="btn-text" data-t="reset">既定に戻す</button>
    </div>
  </section>`;
}

/* ---------- ページ ---------- */
function logHTML(){
  const blocks = dayBlocks();
  return `<div class="wrap">
    <header class="log-top">${dateHeadHTML()}${kpisHTML()}</header>
    <div class="work">
      <div class="work-main">
        ${blocks.length
          ? `<div class="sec-l">今日のメニュー</div><div class="blocks">${blocks.map(blockHTML).join('')}</div>`
          : `<div class="empty">
              <h4>${diffDays(ui.date, today()) === 0 ? 'まだ今日の記録はありません' : 'この日の記録はありません'}</h4>
              <p>下のボタンから種目を選ぶと、その種目のセット表が開きます。重量と回数を入れて「記録」を押すだけです。</p>
            </div>`}
        <button class="add-ex" data-l="addex">＋ 種目を追加</button>
        <div class="note-row">
          <span class="micro-ja">メモ</span>
          <input id="noteIn" value="${esc(db.notes[ui.date] || '')}" placeholder="体調、フォーム、次回の狙いなど">
        </div>
      </div>
      <aside class="work-side">
        ${timerHTML()}
        <div class="side-block"><h4>この日の内訳</h4><div id="sideToday">${sideTodayHTML()}</div></div>
        <div class="side-block"><h4>前回のセッション</h4><div id="sidePrev">${prevSessionHTML()}</div></div>
      </aside>
    </div>
  </div>`;
}

function renderLog(){
  // 開いた直後に入力欄が見えるよう、その日の最後に触った種目を開いておく
  if (!ui.ex && !ui.pending){
    const ss = setsOn(ui.date);
    if (ss.length){ ui.ex = ss.slice().sort((a,b) => b.ts - a.ts)[0].ex; syncInputs(); }
  }
  $('#page-log').innerHTML = logHTML();
  tRender();
}

/* ブロック内だけを描き直す（入力欄の再生成を最小限に） */
function refreshLog(){
  const blocks = dayBlocks();
  const box = $('.blocks');
  if (!box || !blocks.length){ renderLog(); renderRail(); return; }
  box.innerHTML = blocks.map(blockHTML).join('');
  $('#logKpis').outerHTML = kpisHTML();
  $('#sideToday').innerHTML = sideTodayHTML();
  $('#sidePrev').innerHTML = prevSessionHTML();
  renderRail();
}

/* ---------- 入力ヘルパ ---------- */
function bump(el){ el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump'); }
function setVal(key, v){
  ui[key] = v;
  const el = $('#in' + key);
  if (el && el.value !== v){ el.value = v; bump(el); }
  if (key === 'min' || key === 'km') repaintPace();
}
function repaintPace(){
  const box = $('.pace'); if (!box) return;
  const m = parseInt(ui.min,10), k = parseFloat(ui.km);
  const p = (k > 0 && m > 0) ? m / k : 0;
  box.classList.toggle('is-off', !p);
  $('b', box).textContent = p ? fmtPace(p) : '—';
}

/* ---------- 種目を追加するシート ---------- */
function sheetAddEx(){
  ui.sheetQ = '';
  openSheet(addExHTML(), 'sheet-add');
  const i = $('#addQ'); if (i && !isNarrow()) i.focus();
}
function addExHTML(){
  return `<div class="add-head">
      <h3>種目を追加</h3>
      <div class="mode">
        <button class="${ui.mode === 'w' ? 'is-on' : ''}" data-a="mode" data-m="w">筋トレ</button>
        <button class="${ui.mode === 'c' ? 'is-on' : ''}" data-a="mode" data-m="c">有酸素</button>
      </div>
    </div>
    <div class="add-field">
      <input id="addQ" value="${esc(ui.sheetQ)}" placeholder="${
        ui.mode === 'c' ? 'ランニング、バイクなど' : '種目名を入力'}" autocomplete="off" spellcheck="false">
      ${ui.sheetQ ? '<button class="btn-text" data-a="clear">クリア</button>' : ''}
    </div>
    ${ui.mode === 'w' ? `<div class="add-parts">${PARTS.map(p =>
      `<button class="part ${ui.part === p.id ? 'is-on' : ''}" data-a="part" data-p="${p.id}"
        style="--pig:var(--p-${p.id})"><i></i>${p.ja}</button>`).join('')}</div>` : ''}
    <div class="add-list" id="addList">${addListHTML()}</div>`;
}
function addListHTML(){
  const q = normName(ui.sheetQ), lc = q.toLowerCase();
  const pool = allExercises().filter(e => !!e.cardio === (ui.mode === 'c'));
  let head, items;
  if (q){
    items = pool.filter(e => e.name.toLowerCase().includes(lc));
    head  = items.length ? '履歴から' : '';
  } else if (ui.mode === 'c'){
    items = pool; head = '有酸素の履歴';
  } else {
    items = pool.filter(e => e.part === ui.part);
    head  = items.length ? `${PART_JA[ui.part]}の履歴` : '最近の種目';
    if (!items.length) items = pool;
  }
  const exists = pool.some(e => e.name.toLowerCase() === lc);
  const rows = items.slice(0, 60).map(e => {
    const n = setsOfEx(e.name).length;
    const hit = q ? e.name.indexOf(q) : -1;
    const label = hit >= 0
      ? esc(e.name.slice(0,hit)) + '<mark>' + esc(e.name.slice(hit, hit+q.length)) + '</mark>' + esc(e.name.slice(hit+q.length))
      : esc(e.name);
    return `<button class="add-item" data-a="pick" data-v="${esc(e.name)}" data-p="${e.part}"
      style="--pig:var(--p-${e.part})"><i></i><span>${label}</span><em>${n}</em></button>`;
  });
  const newRow = q && !exists
    ? `<button class="add-new" data-a="new" data-v="${esc(q)}">
         <span class="add-new-p">＋</span>
         <span class="add-new-t"><b>「${esc(q)}」を追加</b>
           <em>${ui.mode === 'c' ? '有酸素' : PART_JA[ui.part]}の新しい種目として登録します</em></span>
         <span class="add-new-go">›</span>
       </button>`
    : '';
  if (!rows.length && !newRow) return `<div class="add-empty">${
    pool.length ? '該当する履歴がありません。' : '種目名を入力すると、ここに追加ボタンが出ます。'}<br>
    <span>一度記録した名前は、次から候補に並びます。</span></div>`;
  return newRow + (head && rows.length ? `<div class="add-sec">${head}</div>` : '') + rows.join('');
}

function addExercise(name, part, cardio){
  name = canonicalName(name);
  if (!name) return;
  ui.ex = name; ui.editing = null;
  const existing = setsOn(ui.date).find(s => s.ex === name);
  ui.pending = existing ? null : { name, part:part || ui.part, cardio:!!cardio };
  syncInputs();
  closeSheet();
  renderLog();
  const blk = $(`.blk.is-on`);
  if (blk) blk.scrollIntoView({ block:'center', behavior:'smooth' });
}

$('#sheet').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a;
  if (a === 'mode'){ ui.mode = b.dataset.m; ui.sheetQ = ''; $('#sheetBox').innerHTML = addExHTML(); }
  else if (a === 'part'){ ui.part = b.dataset.p; $('#sheetBox').innerHTML = addExHTML(); }
  else if (a === 'clear'){ ui.sheetQ = ''; $('#sheetBox').innerHTML = addExHTML(); $('#addQ').focus(); }
  else if (a === 'pick') addExercise(b.dataset.v, b.dataset.p, b.dataset.p === 'cardio');
  else if (a === 'new')  addExercise(b.dataset.v, ui.part, ui.mode === 'c');
});
$('#sheet').addEventListener('input', e => {
  if (e.target.id !== 'addQ') return;
  ui.sheetQ = e.target.value;
  $('#addList').innerHTML = addListHTML();
});
$('#sheet').addEventListener('keydown', e => {
  if (e.target.id === 'addQ' && e.key === 'Enter'){
    e.preventDefault();
    const first = $('#addList .add-item'); if (first) first.click();
  }
});

/* ---------- 記録 ---------- */
function logSet(){
  const name = ui.ex; if (!name) return;
  const { cardio } = blockInfo(name);
  if (cardio) return logCardio(name);

  const w = parseFloat(ui.w), r = parseInt(ui.r, 10);
  if (!(r > 0)){ toast('回数を入れてください'); $('#inr').focus(); return; }
  const wv = isFinite(w) && w > 0 ? Math.round(w*100)/100 : 0;

  if (ui.editing){
    const s = db.sets.find(x => x.id === ui.editing);
    if (s){ s.w = wv; s.r = r; }
    ui.editing = null; save(); refreshLog(); toast('セットを更新しました');
    return;
  }

  const before = prOf(name);
  const part = ui.pending ? ui.pending.part : blockInfo(name).part;
  const s = { id:uid(), date:ui.date, part, ex:name, w:wv, r, ts:Date.now() };
  db.sets.push(s); save(); ui.pending = null;

  const isPR = !before || wv > before.w || (wv === before.w && r > before.r);
  refreshLog();

  if (isPR && before) toast(`<b>自己ベスト更新</b>　${esc(name)}　${w2s(wv)}kg × ${r}`, { pr:true, ms:4200 });
  else {
    const n = setsOn(ui.date).filter(x => x.ex === name).length;
    toast(`${esc(name)} <b>${n}</b>セット目を記録`, { action:'取り消す',
      onAction(){ db.sets = db.sets.filter(x => x.id !== s.id); save(); refreshLog(); tReset(); } });
  }
  if (db.settings.auto) tStart(db.settings.rest);
}

function logCardio(name){
  const min = parseInt(ui.min, 10), kmv = parseFloat(ui.km);
  if (!(min > 0)){ toast('時間を入れてください'); $('#inmin').focus(); return; }
  const km = isFinite(kmv) && kmv > 0 ? Math.round(kmv * 100) / 100 : 0;

  if (ui.editing){
    const s = db.sets.find(x => x.id === ui.editing);
    if (s){ s.min = min; s.km = km; }
    ui.editing = null; save(); refreshLog(); toast('記録を更新しました');
    return;
  }

  const best = cardioBest(name);
  const s = { id:uid(), date:ui.date, part:'cardio', ex:name, k:'c', min, km, ts:Date.now() };
  db.sets.push(s); save(); ui.pending = null;
  refreshLog();

  if (best && km > 0 && km > (best.far.km || 0))
    toast(`<b>自己最長</b>　${esc(name)}　${km2s(km)}km`, { pr:true, ms:4200 });
  else
    toast(`${esc(name)} <b>${fmtDur(min)}</b>${km ? ' ' + km2s(km) + 'km' : ''} を記録`, { action:'取り消す',
      onAction(){ db.sets = db.sets.filter(x => x.id !== s.id); save(); refreshLog(); } });
  /* 有酸素はセット間休憩を前提としないので、インターバルは自動で始めない */
}

function focusEx(name){
  if (ui.ex === name && !ui.editing) return;
  ui.ex = name; ui.editing = null; ui.pending = null;
  syncInputs(); refreshLog();
}
function editSet(id){
  const s = db.sets.find(x => x.id === id); if (!s) return;
  ui.ex = s.ex; ui.editing = id; ui.pending = null;
  if (isCardio(s)){ ui.min = String(s.min); ui.km = s.km ? km2s(s.km) : ''; }
  else { ui.w = w2s(s.w); ui.r = String(s.r); }
  refreshLog();
  const f = $(isCardio(s) ? '#inmin' : '#inw'); if (f){ f.focus(); f.select(); }
}
function delSet(id){
  const i = db.sets.findIndex(x => x.id === id); if (i < 0) return;
  const [s] = db.sets.splice(i, 1); save();
  if (ui.editing === id) ui.editing = null;
  if (!setsOn(s.date).some(x => x.ex === s.ex) && ui.ex === s.ex && s.date === ui.date)
    ui.pending = { name:s.ex, part:isCardio(s) ? 'cardio' : s.part, cardio:isCardio(s) };
  refreshLog();
  toast('セットを削除しました', { action:'元に戻す',
    onAction(){ db.sets.splice(i, 0, s); ui.pending = null; save(); refreshLog(); } });
}
function dupSet(id){
  const s = db.sets.find(x => x.id === id); if (!s) return;
  ui.ex = s.ex; ui.editing = null; ui.pending = null;
  if (isCardio(s)){ ui.min = String(s.min); ui.km = s.km ? km2s(s.km) : ''; }
  else { ui.w = w2s(s.w); ui.r = String(s.r); }
  db.sets.push({ ...s, id:uid(), ts:Date.now() }); save();
  refreshLog();
  if (!isCardio(s) && db.settings.auto) tStart(db.settings.rest);
}
function rowMenu(btn, id){
  $$('.lg-pop').forEach(p => p.remove());
  const pop = document.createElement('div');
  pop.className = 'lg-pop';
  pop.innerHTML = `<button data-l="edit" data-id="${id}">編集</button>
                   <button data-l="dup" data-id="${id}">複製</button>
                   <button class="d" data-l="del" data-id="${id}">削除</button>`;
  btn.closest('.srow').appendChild(pop);
  setTimeout(() => document.addEventListener('click', function off(e){
    if (!pop.contains(e.target)){ pop.remove(); document.removeEventListener('click', off); }
  }), 0);
}

/* ---------- 記録ページのイベント ---------- */
$('#page-log').addEventListener('click', e => {
  const b = e.target.closest('[data-l]'); if (!b) return;
  const l = b.dataset.l;
  if (l === 'day'){
    const nd = shiftDay(ui.date, +b.dataset.n);
    if (isFuture(nd)) return;
    ui.date = nd; ui.ex = ''; ui.editing = null; ui.pending = null; renderLog(); }
  else if (l === 'today'){ ui.date = today(); ui.ex = ''; ui.editing = null; ui.pending = null; renderLog(); }
  else if (l === 'jump'){ ui.date = b.dataset.d; ui.ex = ''; ui.editing = null; ui.pending = null; renderLog(); window.scrollTo(0,0); }
  else if (l === 'mood'){
    const v = +b.dataset.v;
    if (moodOf(ui.date) === v) delete db.mood[ui.date]; else db.mood[ui.date] = v;
    save(); $('#mood').outerHTML = moodHTML();
  }
  else if (l === 'addex') sheetAddEx();
  else if (l === 'focus') focusEx(b.dataset.v);
  else if (l === 'w')    setVal('w', w2s(clamp((parseFloat(ui.w)||0) + parseFloat(b.dataset.n), 0, 999)));
  else if (l === 'r')    setVal('r', String(clamp((parseInt(ui.r,10)||0) + parseInt(b.dataset.n,10), 0, 999)));
  else if (l === 'rset') setVal('r', b.dataset.n);
  else if (l === 'min')  setVal('min', String(clamp((parseInt(ui.min,10)||0) + parseFloat(b.dataset.n), 0, 999)));
  else if (l === 'km')   setVal('km', km2s(clamp((parseFloat(ui.km)||0) + parseFloat(b.dataset.n), 0, 999)));
  else if (l === 'cancelEdit'){ ui.editing = null; syncInputs(); refreshLog(); }
  else if (l === 'log') logSet();
  else if (l === 'menu') rowMenu(b, b.dataset.id);
  else if (l === 'edit') editSet(b.dataset.id);
  else if (l === 'dup')  dupSet(b.dataset.id);
  else if (l === 'del')  delSet(b.dataset.id);
});

$('#page-log').addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'inw') ui.w = t.value;
  else if (t.id === 'inr') ui.r = t.value;
  else if (t.id === 'inmin'){ ui.min = t.value; repaintPace(); }
  else if (t.id === 'inkm'){ ui.km = t.value; repaintPace(); }
  else if (t.id === 'noteIn'){
    const v = t.value.trim();
    if (v) db.notes[ui.date] = v; else delete db.notes[ui.date];
    save();
  }
});

$('#page-log').addEventListener('keydown', e => {
  const t = e.target;
  if (['inw','inr','inmin','inkm'].includes(t.id) && e.key === 'Enter'){ e.preventDefault(); logSet(); }
  if (t.id === 'noteIn' && e.key === 'Enter') t.blur();
});

/* =========================================================
   カレンダー
   ========================================================= */
/* 自重種目も見えるよう、体積が0のときは回数×8を代替値にする */
/* グラフの棒の高さ用。挙上量と有酸素を同じ尺度に乗せるための換算
   （1分 ≒ 60kg 相当。1時間の有酸素が中程度の筋トレ日と釣り合う） */
const effVol = s => isCardio(s) ? s.min * 60 : Math.max(vol(s), s.r * 8);

function monthCells(y, m){
  const lead = new Date(y, m, 1).getDay();
  const dim  = new Date(y, m+1, 0).getDate();
  const rows = Math.ceil((lead + dim) / 7);
  const start = new Date(y, m, 1 - lead);
  const cells = [];
  for (let i = 0; i < rows*7; i++){ const d = new Date(start); d.setDate(start.getDate()+i); cells.push(d); }
  return cells;
}
const tons = v => v >= 10000 ? nf(v/1000) : (v/1000).toFixed(1);

function calHTML(){
  const y = ui.calY, m = ui.calM;
  const cells = monthCells(y, m);
  const inMonth = cells.filter(d => d.getMonth() === m).map(ymd);
  const days = inMonth.filter(d => setsOn(d).length);
  const totalV = days.reduce((a,d) => a + dayVolume(d), 0);
  const totalS = inMonth.reduce((a,d) => a + setsOn(d).filter(x => !isCardio(x)).length, 0);
  const cMin   = inMonth.reduce((a,d) => a + setsOn(d).filter(isCardio).reduce((x,s) => x + s.min, 0), 0);
  const isThis = (y === new Date().getFullYear() && m === new Date().getMonth());

  let maxDay = 1;
  for (const d of inMonth) maxDay = Math.max(maxDay, setsOn(d).reduce((a,s) => a + effVol(s), 0));

  const cellHTML = d => {
    const k = ymd(d), ss = setsOn(k), out = d.getMonth() !== m;
    const by = {}; for (const s of ss) by[isCardio(s) ? 'cardio' : s.part] = (by[isCardio(s) ? 'cardio' : s.part] || 0) + effVol(s);
    const bars = GROUPS.filter(p => by[p.id]).map(p =>
      `<i style="--pig:var(--p-${p.id}); height:${clamp(by[p.id]/maxDay*100, 10, 100)}%"></i>`).join('');
    return `<button class="day ${out ? 'is-out' : ''} ${ss.length ? '' : 'is-rest'} ${k === today() ? 'is-today' : ''} ${k === ui.calSel ? 'is-sel' : ''} ${isFuture(k) ? 'is-future' : ''}"
      data-c="sel" data-d="${k}" title="${k}" ${isFuture(k) ? 'disabled' : ''}>
      <span class="day-n">${d.getDate()}</span>
      <span class="day-bars">${bars}</span>
      ${ss.length ? `<span class="day-sets">${ss.length}<span style="opacity:.6"> set</span></span>` : ''}
    </button>`;
  };

  return `<div class="wrap">
    <div class="cal-top">
      <div class="cal-title">
        <button class="icon-btn" data-c="mv" data-n="-1" title="前の月">‹</button>
        <div class="cal-ym">
          <div class="n">${y}<i>.</i>${String(m+1).padStart(2,'0')}</div>
          <span>${days.length ? `${days.length}日トレーニング` : 'この月の記録はまだありません'}</span>
        </div>
        <button class="icon-btn" data-c="mv" data-n="1" title="次の月" ${isThis ? 'disabled' : ''}>›</button>
        ${isThis ? '' : '<button class="btn-text" data-c="thismonth" style="margin-left:10px">今月へ</button>'}
      </div>
      <div class="cal-sum kpis">
        <div class="kpi ${days.length ? '' : 'kpi--dim'}"><span class="kpi-v n">${days.length}<small>/${inMonth.length}</small></span><span class="kpi-l">実施日</span></div>
        <div class="kpi ${totalS ? '' : 'kpi--dim'}"><span class="kpi-v n">${totalS}</span><span class="kpi-l">セット</span></div>
        <div class="kpi ${totalV ? '' : 'kpi--dim'}"><span class="kpi-v n">${tons(totalV)}<small>t</small></span><span class="kpi-l">総挙上量</span></div>
        ${cMin ? `<div class="kpi"><span class="kpi-v n">${durKPI(cMin)}</span><span class="kpi-l">有酸素</span></div>` : ''}
      </div>
    </div>

    <div class="cal-body">
      <div class="grid">
        <div class="grid-dow">${DOW.map(d => `<span>${d}</span>`).join('')}</div>
        <div class="grid-days">${cells.map(cellHTML).join('')}</div>
      </div>
      <aside class="cal-side">${calSideHTML()}</aside>
    </div>
  </div>`;
}

function calSideHTML(){
  const k = ui.calSel;
  if (!k) return `<div class="side-empty">日付を選ぶと内容が出ます。<br>棒の色は部位、高さはその日の挙上量です。</div>`;
  const d = parseYmd(k), ss = setsOn(k);
  const order = []; for (const s of ss) if (!order.includes(s.ex)) order.push(s.ex);
  const by = {}; for (const s of ss) by[isCardio(s) ? 'cardio' : s.part] = (by[isCardio(s) ? 'cardio' : s.part] || 0) + effVol(s);
  const wS = ss.filter(x => !isCardio(x)), cS = ss.filter(isCardio);
  const reps = wS.reduce((a,s) => a + s.r, 0);
  const cMin = cS.reduce((a,s) => a + s.min, 0), cKm = cS.reduce((a,s) => a + (s.km || 0), 0);

  const head = `<div class="cd-head">
      <span class="n">${d.getMonth()+1}<i>/</i>${d.getDate()}</span>
      <p>${DOW[d.getDay()]}曜日</p>
      ${moodOf(k) ? `<span class="cd-mood" title="${MOODS[moodOf(k)-1].ja}">${
        faceSVG(MOODS[moodOf(k)-1], 18)}<em>${MOODS[moodOf(k)-1].ja}</em></span>` : ''}
      <button class="btn-text" data-c="goto" data-d="${k}">${ss.length ? '編集する →' : '記録する →'}</button>
    </div>`;

  if (!ss.length) return head + `<div class="side-empty" style="padding-top:6px">この日の記録はありません。</div>`;

  return head + `
    <div class="cd-kpis">
      ${wS.length ? `<div class="kpi"><span class="kpi-v n">${wS.length}</span><span class="kpi-l">セット</span></div>
      <div class="kpi"><span class="kpi-v n">${reps}</span><span class="kpi-l">レップ</span></div>
      <div class="kpi"><span class="kpi-v n">${nf(dayVolume(k))}<small>kg</small></span><span class="kpi-l">挙上量</span></div>` : ''}
      ${cS.length ? `<div class="kpi"><span class="kpi-v n">${durKPI(cMin)}</span><span class="kpi-l">有酸素</span></div>
      ${cKm ? `<div class="kpi"><span class="kpi-v n">${km2s(cKm)}<small>km</small></span><span class="kpi-l">距離</span></div>` : ''}` : ''}
    </div>
    ${db.notes[k] ? `<div class="cd-note">${esc(db.notes[k])}</div>` : ''}
    <div class="split">${PARTS.filter(p => by[p.id]).map(p =>
        `<i style="--pig:var(--p-${p.id}); flex:${by[p.id].toFixed(0)}"></i>`).join('')}</div>
    ${order.map(name => {
      const rows = ss.filter(s => s.ex === name);
      const c = isCardio(rows[0]);
      const tot = c ? `${rows.reduce((a,s)=>a+s.min,0)}<i>分</i>` : `${nf(rows.reduce((a,s)=>a+vol(s),0))}<i>kg</i>`;
      const line = c
        ? rows.map(s => `${s.min}分${s.km ? ' ' + km2s(s.km) + 'km' : ''}`).join('<s>·</s>')
        : rows.map(s => s.w ? `${w2s(s.w)}×${s.r}` : `${s.r}回`).join('<s>·</s>');
      return `<div class="cd-ex" style="--pig:var(--p-${c ? 'cardio' : rows[0].part})">
        <div class="cd-ex-t"><span class="pig"></span><h4>${esc(name)}</h4><b>${tot}</b></div>
        <div class="cd-sets">${line}</div>
      </div>`;
    }).join('')}`;
}

function renderCal(){ $('#page-cal').innerHTML = calHTML(); }

$('#page-cal').addEventListener('click', e => {
  const b = e.target.closest('[data-c]'); if (!b) return;
  const c = b.dataset.c;
  if (c === 'mv'){
    let m = ui.calM + (+b.dataset.n), y = ui.calY;
    if (m < 0){ m = 11; y--; } if (m > 11){ m = 0; y++; }
    const now = new Date();
    if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) return;
    ui.calM = m; ui.calY = y; renderCal();
  }
  else if (c === 'thismonth'){ const n = new Date(); ui.calM = n.getMonth(); ui.calY = n.getFullYear(); renderCal(); }
  else if (c === 'sel'){
    if (isFuture(b.dataset.d)) return;
    ui.calSel = b.dataset.d;
    const d = parseYmd(ui.calSel);
    if (d.getMonth() !== ui.calM){ ui.calM = d.getMonth(); ui.calY = d.getFullYear(); renderCal(); return; }
    $$('.day').forEach(x => x.classList.toggle('is-sel', x.dataset.d === ui.calSel));
    $('.cal-side').innerHTML = calSideHTML();
  }
  else if (c === 'goto'){ ui.date = b.dataset.d; ui.editing = null; syncInputs(); renderLog(); go('log'); }
});

/* =========================================================
   種目ライブラリ
   ========================================================= */
function sparkHTML(name, part){
  const byDate = {};
  for (const s of setsOfEx(name)){
    const v = isCardio(s) ? (s.km || s.min) : (s.w || s.r);
    byDate[s.date] = Math.max(byDate[s.date] || 0, v);
  }
  const keys = Object.keys(byDate).sort().slice(-12);
  if (keys.length < 2) return `<svg class="ex-spark" width="96" height="24"></svg>`;
  const vals = keys.map(k => byDate[k]);
  const mn = Math.min(...vals), mx = Math.max(...vals), rg = (mx - mn) || 1;
  const pts = vals.map((v, i) => [3 + i * (90 / (vals.length - 1)), 20 - ((v - mn) / rg) * 16]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="ex-spark" width="96" height="24" style="--pig:var(--p-${part})" aria-hidden="true">
    <path d="${d}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.1"/></svg>`;
}

function exRowHTML(name, part){
  const rows  = setsOfEx(name);
  const cardio = isCardioEx(name);
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const last  = dates[dates.length - 1];
  const gap   = diffDays(today(), last);
  const ago   = gap === 0 ? '今日' : gap === 1 ? '昨日' : `${gap}日前`;

  let value;
  if (cardio){
    const b = cardioBest(name);
    value = b.far.km
      ? `${km2s(b.far.km)}<i>km</i><em>${b.fast ? '最速 ' + fmtPace(paceOf(b.fast)) + '/km' : '最長距離'}</em>`
      : `${b.far.min}<i>分</i><em>最長時間</em>`;
  } else {
    const pr = prOf(name);
    value = pr.w ? `${w2s(pr.w)}<i>kg</i> × ${pr.r}<em>推定1RM ${Math.round(est1RM(pr))}kg</em>`
                 : `${pr.r}<i>回</i><em>自重</em>`;
  }
  const count = cardio ? `${rows.length}本 ${fmtDur(rows.reduce((a,s)=>a+s.min,0))}`
                       : `${dates.length}日 ${rows.length}セット`;
  return `<div class="ex-row" style="--pig:var(--p-${part})">
    <div class="ex-main">
      <div class="ex-name">${esc(name)}</div>
      <div class="ex-meta"><b>${ago}</b> · ${count}<button
        class="ex-ren" data-x="ren" data-v="${esc(name)}">名前を変更</button></div>
    </div>
    <div class="ex-pr n">${value}</div>
    ${sparkHTML(name, part)}
    <button class="icon-btn ex-more" data-x="use" data-v="${esc(name)}" title="この種目で記録" style="font-size:15px">›</button>
  </div>`;
}

function exHTML(){
  const all = allExercises();
  if (!all.length) return `<div class="wrap">
    <div class="ph"><div><h1>種目</h1><p>記録した種目がここに集まります。</p></div></div>
    <div class="empty" style="max-width:400px">
      <h4>まだ種目の履歴がありません</h4>
      <p>記録ページで種目名を入力してセットを記録すると、その名前がここに残ります。次からは入力欄の候補から選べます。</p>
      <button class="btn-ghost" data-x="go" style="margin-top:16px">記録を始める →</button>
    </div></div>`;

  const q = normName(ui.exQ);
  const secs = GROUPS.map(p => {
    let names = all.filter(e => e.part === p.id).map(e => e.name);
    if (q) names = names.filter(n => n.toLowerCase().includes(q.toLowerCase()));
    if (!names.length) return '';
    names = names.sort((a,b) => setsOfEx(b).length - setsOfEx(a).length);
    return `<section class="ex-sec" style="--pig:var(--p-${p.id})">
      <div class="ex-sec-head"><span class="pig"></span><h3>${p.ja}</h3><span class="n">${names.length}</span></div>
      ${names.map(n => exRowHTML(n, p.id)).join('')}
    </section>`;
  }).join('');

  return `<div class="wrap">
    <div class="ph"><div><h1>種目</h1><p>記録した種目と、その自己ベスト。</p></div>
      <span class="micro">${all.length} 種目</span></div>
    <div class="ex-search">
      <span class="micro">検索</span>
      <input id="exQ" value="${esc(ui.exQ)}" placeholder="種目名で絞り込む" autocomplete="off">
      ${q ? '<button class="btn-text" data-x="clear">クリア</button>' : ''}
    </div>
    ${secs || '<div class="empty"><h4>該当する種目がありません</h4><p>記録した名前だけが候補になります。</p></div>'}
  </div>`;
}

function renderEx(){ $('#page-ex').innerHTML = exHTML(); }

$('#page-ex').addEventListener('click', e => {
  const b = e.target.closest('[data-x]'); if (!b) return;
  const x = b.dataset.x;
  if (x === 'use'){
    // 今日まだ記録がなければ、記録ページにその種目のブロックを用意して開く
    const name = b.dataset.v, part = partOfEx(name) || ui.part;
    ui.ex = name; ui.editing = null;
    ui.part = part === 'cardio' ? ui.part : part;
    ui.pending = setsOn(ui.date).some(s => s.ex === name)
      ? null : { name, part, cardio:isCardioEx(name) };
    syncInputs(); renderLog(); go('log');
  }
  else if (x === 'clear'){ ui.exQ = ''; renderEx(); }
  else if (x === 'go') go('log');
  else if (x === 'ren') sheetRename(b.dataset.v);
});
$('#page-ex').addEventListener('input', e => {
  if (e.target.id === 'exQ'){
    ui.exQ = e.target.value; const p = e.target.selectionStart; renderEx();
    const n = $('#exQ'); n.focus(); n.setSelectionRange(p, p);
  }
});

/* 自由記述なので表記ゆれが必ず出る。履歴全体を一括で書き換えられるようにする。 */
function sheetRename(name){
  const n = setsOfEx(name).length;
  openSheet(`<h3>種目名を変更</h3>
    <p>「${esc(name)}」で記録した <b>${n}</b> セットすべてに反映されます。</p>
    <input class="sheet-in" id="renIn" value="${esc(name)}" autocomplete="off" spellcheck="false">
    <p class="ren-note" id="renNote"></p>
    <div class="sheet-acts">
      <button class="btn-primary" id="okBtn">変更する</button>
      <button class="btn-text" id="closeBtn" style="margin-left:auto">やめる</button>
    </div>`);
  const inp = $('#renIn'), note = $('#renNote'), ok = $('#okBtn');
  const check = () => {
    const v = normName(inp.value);
    const dup = allExercises().find(e => e.name !== name && e.name.toLowerCase() === v.toLowerCase());
    note.textContent = !v ? '名前を入力してください'
      : dup ? `既存の「${dup.name}」に統合され、${setsOfEx(dup.name).length}セットと合算されます。` : '';
    note.className = 'ren-note' + (dup ? ' is-warn' : '');
    ok.disabled = !v;
  };
  inp.oninput = check; check();
  inp.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); ok.click(); } };
  inp.focus(); inp.select();
  ok.onclick = () => {
    const v = normName(inp.value);
    if (!v) return;
    const dup = allExercises().find(e => e.name !== name && e.name.toLowerCase() === v.toLowerCase());
    const to  = dup ? dup.name : v;
    if (to !== name){
      for (const st of db.sets) if (st.ex === name) st.ex = to;
      if (ui.ex === name) ui.ex = to;
      save();
    }
    closeSheet(); renderEx();
    toast(dup ? `「${esc(name)}」を「${esc(to)}」に統合しました` : `「${esc(to)}」に変更しました`);
  };
  $('#closeBtn').onclick = closeSheet;
}

/* =========================================================
   分析
   ========================================================= */
function weekStart(d){ const x = parseYmd(d); x.setDate(x.getDate() - ((x.getDay()+6)%7)); return ymd(x); }

function weeks(n){
  const out = []; let w = weekStart(today());
  for (let i = 0; i < n; i++){ out.unshift(w); w = shiftDay(w, -7); }
  return out;
}
/* 筋トレは時間を記録しないので、セット数から見積もる。
   1セット = 作業 SET_WORK 秒 + 設定した休憩時間。 */
const SET_WORK = 40;
const strengthMin = nSets => nSets * (SET_WORK + db.settings.rest) / 60;

/* 週の活動量。筋トレの「回数」は実施した日数で数える（目安の定義に合わせる） */
function weekActivity(w){
  const end = shiftDay(w, 6);
  const ss  = db.sets.filter(x => x.date >= w && x.date <= end);
  const wS  = ss.filter(x => !isCardio(x));
  return {
    cMin:  ss.filter(isCardio).reduce((a,x) => a + x.min, 0),
    sets:  wS.length,
    days:  new Set(wS.map(x => x.date)).size,
    sMin:  strengthMin(wS.length),
  };
}

function weekVolume(w){
  const end = shiftDay(w, 6);
  const by = Object.fromEntries(GROUPS.map(p => [p.id, 0]));
  let tot = 0, min = 0;
  for (const s of db.sets) if (s.date >= w && s.date <= end){
    by[isCardio(s) ? 'cardio' : s.part] += effVol(s);
    tot += vol(s); if (isCardio(s)) min += s.min;
  }
  return { by, tot, min, eff:Object.values(by).reduce((a,b)=>a+b,0) };
}

function statHTML(){
  if (!db.sets.length) return `<div class="wrap">
    <div class="ph"><div><h1>分析</h1><p>直近12週の推移と、部位ごとの偏り。</p></div></div>
    <div class="empty" style="max-width:380px">
      <h4>まだ集計できる記録がありません</h4>
      <p>セットを記録すると、週ごとの積み上げ、部位の偏り、種目ごとの自己ベストがここに並びます。</p>
      <button class="btn-ghost" data-v="log" style="margin-top:16px">記録を始める →</button>
    </div></div>`;
  const ws = weeks(12).map(w => ({ w, ...weekVolume(w) }));
  const maxEff = Math.max(1, ...ws.map(x => x.eff));
  const cur = ws[ws.length-1], prev = ws[ws.length-2];
  const delta = prev && prev.tot ? Math.round((cur.tot - prev.tot) / prev.tot * 100) : null;

  const from30 = shiftDay(today(), -29);
  const by30 = volumeByPart(from30);
  const tot30 = Object.values(by30).reduce((a,b) => a+b, 0) || 1;
  const max30 = Math.max(1, ...Object.values(by30));
  const setBy30 = Object.fromEntries(PARTS.map(p => [p.id,
    db.sets.filter(s => !isCardio(s) && s.date >= from30 && s.part === p.id).length]));
  const c30 = db.sets.filter(s => isCardio(s) && s.date >= from30);

  const prs = allExercises().filter(e => !e.cardio).map(e => ({ ...e, pr:prOf(e.name) }))
    .filter(e => e.pr && e.pr.w > 0)
    .sort((a,b) => est1RM(b.pr) - est1RM(a.pr)).slice(0, 12);

  const days = trainedDates();
  const st = streak();

  return `<div class="wrap">
    <div class="ph"><div><h1>分析</h1><p>直近12週の推移と、部位ごとの偏り。</p></div></div>

    <div class="hero">
      <div class="hero-main">
        <div class="n">${st}<small>日</small></div>
        <span class="kpi-l">連続トレーニング</span>
      </div>
      <div class="hero-sub">
        <div class="n">${nf(cur.tot)}<small>kg</small></div>
        <span class="kpi-l">今週の挙上量
          ${delta !== null ? `<span class="hero-delta ${delta >= 0 ? 'up' : 'dn'}">${delta >= 0 ? '↑' : '↓'}${Math.abs(delta)}%</span>` : ''}
        </span>
      </div>
      <div class="hero-sub">
        <div class="n">${nf(db.sets.length)}</div><span class="kpi-l">総セット</span>
      </div>
      <div class="hero-sub hero-sub--end">
        <div class="n">${days.length}<small>日</small></div><span class="kpi-l">実施日数</span>
      </div>
    </div>

    ${goalHTML()}

    <section class="stat-sec">
      <h3>週ごとの積み上げ — 直近12週</h3>
      <div class="wchart">
        ${ws.map((x, i) => {
          const h = Math.round(x.eff / maxEff * 100);
          const segs = GROUPS.filter(p => x.by[p.id]).map(p =>
            `<i style="--pig:var(--p-${p.id}); height:${(x.by[p.id]/x.eff*100).toFixed(2)}%"></i>`).join('');
          const d = parseYmd(x.w);
          return `<div class="wcol ${i === ws.length-1 ? 'is-cur' : ''}">
            <span class="wcol-v n">${x.tot ? nf(x.tot) + 'kg' : ''}${x.tot && x.min ? ' · ' : ''}${x.min ? x.min + '分' : ''}</span>
            ${x.eff ? `<div class="wcol-bar" style="height:${Math.max(h,2)}%">${segs}</div>`
                    : `<div class="wcol-bar is-zero"></div>`}
            <span class="wcol-l">${d.getMonth()+1}/${d.getDate()}</span>
          </div>`;
        }).join('')}
      </div>
    </section>

    <section class="stat-sec">
      <h3>部位のバランス — 直近30日</h3>
      <div class="pbars">
        ${PARTS.map(p => `<div class="pbar" style="--pig:var(--p-${p.id})">
          <div class="pbar-l"><i></i>${p.ja}</div>
          <div class="pbar-t"><i style="width:${by30[p.id] ? Math.max(by30[p.id]/max30*100, .8).toFixed(1) : 0}%"></i></div>
          <div class="pbar-v n">${nf(by30[p.id])}<i>kg</i>
            <em>${setBy30[p.id]}set · ${Math.round(by30[p.id]/tot30*100)}%</em></div>
        </div>`).join('')}
      </div>
    </section>

    ${balanceHTML(from30)}

    ${c30.length ? `<section class="stat-sec">
      <h3>有酸素 — 直近30日</h3>
      <div class="cardio-sum">
        <div class="kpi"><span class="kpi-v n">${c30.length}</span><span class="kpi-l">回</span></div>
        <div class="kpi"><span class="kpi-v n">${durKPI(c30.reduce((a,s)=>a+s.min,0))}</span><span class="kpi-l">合計時間</span></div>
        ${(() => { const km = c30.reduce((a,s)=>a+(s.km||0),0); const mn = c30.filter(s=>s.km).reduce((a,s)=>a+s.min,0);
          return km ? `<div class="kpi"><span class="kpi-v n">${km2s(km)}<small>km</small></span><span class="kpi-l">合計距離</span></div>
          <div class="kpi"><span class="kpi-v n">${fmtPace(mn/km)}<small>/km</small></span><span class="kpi-l">平均ペース</span></div>` : ''; })()}
      </div>
      <div class="cardio-list">
        ${[...new Set(c30.map(s => s.ex))].map(n => {
          const r = c30.filter(s => s.ex === n), km = r.reduce((a,s)=>a+(s.km||0),0);
          return `<div class="pr-row" style="--pig:var(--p-cardio)"><span class="pig"></span>
            <span>${esc(n)}</span><b>${r.length}<i>回</i>　${fmtDur(r.reduce((a,s)=>a+s.min,0))}${
            km ? `　${km2s(km)}<i>km</i>` : ''}</b></div>`;
        }).join('')}
      </div>
    </section>` : ''}

    <section class="stat-sec">
      <h3>自己ベスト</h3>
      ${prs.length ? `<div class="prlist">${prs.map(e => `<div class="pr-row" style="--pig:var(--p-${e.part})">
        <span class="pig"></span><span>${esc(e.name)}</span>
        <b>${w2s(e.pr.w)}<i>kg</i> × ${e.pr.r}</b></div>`).join('')}</div>`
      : `<div class="empty"><h4>まだ記録がありません</h4><p>数セット記録すると、種目ごとの自己ベストがここに並びます。</p></div>`}
    </section>
  </div>`;
}
function renderStat(){ $('#page-stat').innerHTML = statHTML(); }

/* ③ 週の目標に対する今週の充足率 */
function goalRow(label, pig, val, target, unit, sub, word){
  const scale = Math.max(target * 1.25, val || 0);
  const p = clamp((val / scale) * 100, 0, 100);
  const m = clamp((target / scale) * 100, 0, 100);
  const ok = val >= target;
  const rest = target - val;
  return `<div class="goal" style="--pig:${pig}">
    <div class="goal-top">
      <span class="goal-l">${label}</span>
      <b class="n">${val % 1 ? val.toFixed(1) : val}<i>${unit}</i></b>
      <span class="goal-s ${ok ? 'is-ok' : ''}">${ok ? `${word}を達成` : `あと${
        unit === '分' ? Math.ceil(rest) : rest}${unit}`}</span>
    </div>
    <div class="goal-t" style="--p:${p.toFixed(1)}%; --m:${m.toFixed(1)}%"><i></i></div>
    <div class="goal-b">${word} 週${target}${unit}${sub ? ` · ${sub}` : ''}</div>
  </div>`;
}

function goalHTML(){
  const gm = db.settings.goalMin, gd = db.settings.goalDays;
  if (!gm && !gd) return '';
  const w = weekStart(today());
  const cur = weekActivity(w), prev = weekActivity(shiftDay(w, -7));
  const nth = diffDays(today(), w) + 1;
  const isWHO = gm === WHO_MIN && gd === WHO_DAYS;
  return `<section class="stat-sec">
    <h3>今週の活動量 <span class="h3-note">${
      isWHO ? 'WHO・厚生労働省の目安に対して' : '設定した目標に対して'}</span>
      <button class="btn-text stat-edit" data-v="set">目標を変更</button></h3>
    <div class="goals ${gm && gd ? '' : 'is-single'}">
      ${gm ? goalRow('有酸素', 'var(--p-cardio)', cur.cMin, gm, '分',
        prev.cMin ? `先週 ${prev.cMin}分` : '', isWHO ? '目安' : '目標') : ''}
      ${gd ? goalRow('筋トレ', 'color-mix(in srgb, var(--ink) 72%, transparent)', cur.days, gd, '回',
        prev.days ? `先週 ${prev.days}回` : '', isWHO ? '目安' : '目標') : ''}
    </div>
    <p class="ts-note">月曜からの${nth}日目の集計です。${isWHO
      ? '目安は「中強度の有酸素を週150分以上、筋力トレーニングを週2回以上」。'
      : `目標は有酸素 週${gm}分・筋トレ 週${gd}回。設定ページで変えられます。`}</p>
  </section>`;
}

/* ② 筋トレと有酸素の時間配分（筋トレはセット数からの推定） */
function balanceHTML(from){
  const ss = db.sets.filter(x => x.date >= from);
  const nSets = ss.filter(x => !isCardio(x)).length;
  const cSets = ss.filter(isCardio);
  const sMin = strengthMin(nSets), cMin = cSets.reduce((a,x) => a + x.min, 0);
  const tot = sMin + cMin;
  if (!tot) return '';
  const sp = Math.round(sMin / tot * 100), cp = 100 - sp;
  const seg = (cls, pct, name) => pct <= 0 ? '' :
    `<i class="${cls}" style="flex:${pct}">${pct >= 18 ? `<span>${name} ${pct}%</span>` : ''}</i>`;
  return `<section class="stat-sec">
    <h3>時間の配分 — 直近30日 <span class="h3-note">筋トレは推定値</span></h3>
    <div class="tsplit">${seg('ts-w', sp, '筋トレ')}${seg('ts-c', cp, '有酸素')}</div>
    <div class="tsrows">
      <div class="tsrow"><span class="pig" style="--pig:color-mix(in srgb, var(--ink) 86%, transparent)"></span>
        <span>筋トレ</span><b class="n">${durHTML(sMin)}</b><em>${nSets}セットから推定</em></div>
      <div class="tsrow"><span class="pig" style="--pig:var(--p-cardio)"></span>
        <span>有酸素</span><b class="n">${durHTML(cMin)}</b><em>${cSets.length}回</em></div>
    </div>
    <p class="ts-note">筋トレの時間は「1セット ≒ 作業${SET_WORK}秒 + 休憩${db.settings.rest}秒」で見積もっています。
      設定の休憩時間を変えると再計算されます。</p>
  </section>`;
}

/* =========================================================
   設定
   ========================================================= */
function setHTML(){
  const s = db.settings;
  const seg = (name, opts, cur) => `<div class="seg">${opts.map(o =>
    `<button class="${o[0] == cur ? 'is-on' : ''}" data-s="${name}" data-v="${o[0]}">${o[1]}</button>`).join('')}</div>`;
  const bytes = new Blob([JSON.stringify(db)]).size;

  return `<div class="wrap">
    <div class="ph"><div><h1>設定</h1><p>データはこの端末のブラウザにだけ保存されます。</p></div>
      <span class="micro">${db.sets.length} sets · ${(bytes/1024).toFixed(1)} KB</span></div>

    <div class="set-grid">
      <div class="set-sec-t">インターバル</div>
      <div class="set-row"><div><h4>既定の休憩時間</h4><p>プリセットの選択でも変わります。</p></div>
        <div class="set-ctl"><input class="num-sm n" id="restIn" value="${s.rest}" inputmode="numeric"><span class="unit">秒</span></div></div>
      <div class="set-row"><div><h4>記録したら自動で開始</h4><p>セットを記録した瞬間にカウントを始めます。</p></div>
        <div class="set-ctl"><button class="sw" data-s="auto" data-on="${s.auto?1:0}" aria-pressed="${s.auto}" aria-label="記録したら自動で開始"></button></div></div>
      <div class="set-row"><div><h4>終了音とバイブ</h4>
        <p>0秒になったら短く3回鳴らします。端末がマナーモードだと鳴らないことがあります。</p></div>
        <div class="set-ctl">
          <button class="btn-ghost" data-s="testSound">音を試す</button>
          <button class="sw" data-s="sound" data-on="${s.sound?1:0}" aria-pressed="${s.sound}" aria-label="終了音とバイブ"></button>
        </div></div>

      <div class="set-sec-t">週の目標</div>
      <div class="set-row"><div><h4>有酸素の目標</h4><p>1週間の合計時間。0 にすると目標を表示しません。</p></div>
        <div class="set-ctl"><input class="num-sm n" id="goalMinIn" value="${s.goalMin}" inputmode="numeric"><span class="unit">分</span></div></div>
      <div class="set-row"><div><h4>筋トレの目標</h4><p>1週間に筋トレをする日数。0 にすると目標を表示しません。</p></div>
        <div class="set-ctl"><input class="num-sm n" id="goalDaysIn" value="${s.goalDays}" inputmode="numeric"><span class="unit">回</span></div></div>
      <div class="set-row"><div><h4>目安の出典</h4>
        <p>既定値は WHO と厚生労働省の身体活動基準（中強度の有酸素を週150分以上、筋力トレーニングを週2回以上）です。</p></div>
        <div class="set-ctl"><button class="btn-ghost" data-s="goalReset">既定に戻す</button></div></div>

      <div class="set-sec-t">入力</div>
      <div class="set-row"><div><h4>重量の増減幅</h4><p>＋− ボタンで一度に動く量です。</p></div>
        <div class="set-ctl">${seg('wStep', [[1,'1kg'],[1.25,'1.25'],[2.5,'2.5kg'],[5,'5kg']], s.wStep)}</div></div>

      <div class="set-sec-t">外観</div>
      <div class="set-row"><div><h4>テーマ</h4><p>「自動」は端末の設定に従います。</p></div>
        <div class="set-ctl">${seg('theme', [['auto','自動'],['light','ライト'],['dark','ダーク']], s.theme)}</div></div>

      <div class="set-sec-t">データ</div>
      <div class="set-row"><div><h4>書き出し</h4><p>全記録を JSON で取り出します。バックアップや機種変更に。</p></div>
        <div class="set-ctl"><button class="btn-ghost" data-s="export">書き出す</button></div></div>
      <div class="set-row"><div><h4>読み込み</h4><p>書き出した JSON を貼り付けて復元します。</p></div>
        <div class="set-ctl"><button class="btn-ghost" data-s="import">読み込む</button></div></div>
      <div class="set-row"><div><h4>全データの削除</h4><p>取り消せません。先に書き出しておくことを推奨します。</p></div>
        <div class="set-ctl"><button class="btn-text is-danger" data-s="wipe">全データを削除</button></div></div>

    </div>
  </div>`;
}
function renderSet(){ $('#page-set').innerHTML = setHTML(); }

$('#page-stat').addEventListener('click', e => {
  const b = e.target.closest('[data-v]'); if (b) go(b.dataset.v);
});

$('#page-set').addEventListener('click', e => {
  const b = e.target.closest('[data-s]'); if (!b) return;
  const k = b.dataset.s;
  if (k === 'auto' || k === 'sound'){ db.settings[k] = !db.settings[k]; save(); renderSet(); if (ui.page==='log') renderLog(); }
  else if (k === 'wStep'){ db.settings.wStep = parseFloat(b.dataset.v); save(); renderSet(); }
  else if (k === 'theme'){ db.settings.theme = b.dataset.v; save(); applyTheme(); renderSet(); }
  else if (k === 'goalReset'){
    db.settings.goalMin = WHO_MIN; db.settings.goalDays = WHO_DAYS; save(); renderSet();
    toast('目標を既定（WHO・厚生労働省の目安）に戻しました');
  }
  else if (k === 'testSound'){
    beep();
    if (!db.settings.sound) toast('いまは終了音がオフです。右のスイッチで有効にできます');
  }
  else if (k === 'export') sheetExport();
  else if (k === 'import') sheetImport();
  else if (k === 'wipe') sheetWipe();
});
$('#page-set').addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'restIn'){
    const v = clamp(parseInt(e.target.value,10) || 0, 5, 900);
    db.settings.rest = v; save(); if (!T.run) tSet(v);
  }
  else if (id === 'goalMinIn'){
    db.settings.goalMin = clamp(parseInt(e.target.value,10) || 0, 0, 2000); save();
  }
  else if (id === 'goalDaysIn'){
    db.settings.goalDays = clamp(parseInt(e.target.value,10) || 0, 0, 7); save();
  }
});

/* ---------- シート ---------- */
function openSheet(html, cls){
  const box = $('#sheetBox');
  box.className = 'sheet-box' + (cls ? ' ' + cls : '');
  box.innerHTML = html;
  $('#sheet').hidden = false;
}
function closeSheet(){ $('#sheet').hidden = true; $('#sheetBox').innerHTML = ''; }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

function sheetExport(){
  const json = JSON.stringify(db, null, 1);
  openSheet(`<h3>データを書き出す</h3>
    <p>下のテキストをコピーして保存してください。ファイルとして保存もできます。</p>
    <textarea class="sheet-ta" id="expTa" readonly>${esc(json)}</textarea>
    <div class="sheet-acts">
      <button class="btn-primary" id="copyBtn">コピーする</button>
      <a class="btn-ghost" id="dlBtn" download="plate-${today()}.json">ファイルで保存</a>
      <button class="btn-text" id="closeBtn" style="margin-left:auto">閉じる</button>
    </div>`);
  const a = $('#dlBtn');
  a.href = URL.createObjectURL(new Blob([json], { type:'application/json' }));
  $('#copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(json); toast('クリップボードにコピーしました'); }
    catch(e){ $('#expTa').select(); document.execCommand('copy'); toast('コピーしました'); }
  };
  $('#closeBtn').onclick = closeSheet;
}

function sheetImport(){
  openSheet(`<h3>データを読み込む</h3>
    <p>書き出した JSON を貼り付けてください。<b>現在のデータは置き換わります。</b></p>
    <textarea class="sheet-ta" id="impTa" placeholder='{"v":1,"sets":[ … ]}'></textarea>
    <div class="sheet-acts">
      <button class="btn-primary" id="impBtn">読み込む</button>
      <button class="btn-text" id="closeBtn" style="margin-left:auto">やめる</button>
    </div>`);
  $('#closeBtn').onclick = closeSheet;
  $('#impBtn').onclick = () => {
    try{
      const o = JSON.parse($('#impTa').value);
      if (!o || !Array.isArray(o.sets)) throw 0;
      db = { v:1, sets:o.sets, notes:o.notes || {}, mood:o.mood || {},
             settings:Object.assign({}, DEFAULT_SETTINGS, o.settings || {}) };
      localStorage.setItem(KEY, JSON.stringify(db));
      closeSheet(); applyTheme(); renderAll();
      toast(`${db.sets.length}件のセットを読み込みました`);
    }catch(e){ toast('読み込めませんでした。JSONを確認してください'); }
  };
}

function sheetWipe(){
  openSheet(`<h3>全データを削除しますか</h3>
    <p>${db.sets.length}件のセット、${Object.keys(db.notes).length}件のメモ、${Object.keys(db.mood).length}件の体調がすべて消えます。種目の履歴も同時に失われます。この操作は取り消せません。</p>
    <div class="sheet-acts">
      <button class="btn-primary" id="noBtn">やめておく</button>
      <button class="btn-text is-danger" id="yesBtn">削除する</button>
    </div>`);
  $('#noBtn').onclick = closeSheet;
  $('#yesBtn').onclick = () => {
    db = { v:1, sets:[], notes:{}, mood:{}, settings:Object.assign({}, DEFAULT_SETTINGS, db.settings) };
    localStorage.setItem(KEY, JSON.stringify(db));
    closeSheet(); renderAll(); toast('すべて削除しました');
  };
}

/* =========================================================
   レール / ページ切替 / 起動
   ========================================================= */
function renderRail(){
  const st = streak(), set = new Set(db.sets.map(s => s.date));
  const dots = [];
  for (let i = 6; i >= 0; i--){
    const d = shiftDay(today(), -i);
    dots.push(`<i ${set.has(d) ? 'data-on="1"' : ''} ${i === 0 ? 'data-today' : ''} title="${d}"></i>`);
  }
  $('#railStreak').innerHTML = `<span class="streak-n n">${st}</span>
    <span class="streak-l">${st ? '日連続' : '今日から'}</span>
    <div class="streak-dots">${dots.join('')}</div>`;
}

const RENDER = { log:renderLog, cal:renderCal, ex:renderEx, stat:renderStat, set:renderSet };
function go(page){
  ui.page = page;
  $$('.nav-item').forEach(b => {
    const on = b.dataset.page === page;
    b.classList.toggle('is-on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $$('.page').forEach(p => p.classList.toggle('is-on', p.id === 'page-' + page));
  RENDER[page]();
  tRender();
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  // 空の日だけ、種目入力に誘導する（内容を隠さないため）
  if (page === 'log' && !isNarrow() && !ui.ex && !setsOn(ui.date).length){
    setTimeout(() => { const i = $('#exIn'); if (i) i.focus(); }, 40);
  }
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('.nav-item'); if (b) go(b.dataset.page); });

function renderAll(){ RENDER[ui.page](); renderRail(); tRender(); }

function applyTheme(){
  const t = db.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
$('#themeBtn').onclick = () => {
  const order = ['auto','light','dark'];
  db.settings.theme = order[(order.indexOf(db.settings.theme) + 1) % 3];
  save(); applyTheme();
  toast(`外観：${{auto:'自動', light:'ライト', dark:'ダーク'}[db.settings.theme]}`, { ms:1600 });
  if (ui.page === 'set') renderSet();
};

window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(tRender, 150); });

/* ---------- 起動 ---------- */
(function boot(){
  applyTheme();
  ui.calSel = today();
  T.total = T.left = db.settings.rest;
  syncInputs();
  renderLog(); renderRail(); tRender();
})();
