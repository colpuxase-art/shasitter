(() => {
'use strict';

const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));

const state = {
  clients:[],
  prestations:[],
  upcoming:[],
  past:[],
  compta:null,
  pie:null,
  activePanel:'home'
};

const fmt = n => (Math.round((Number(n||0))*100)/100).toFixed(2);
const today = ()=> new Date().toISOString().slice(0,10);

function setPanel(name){
  state.activePanel = name;

  $$('.panel').forEach(p=>p.classList.remove('active'));
  $('#panel'+name[0].toUpperCase()+name.slice(1))?.classList.add('active');

  $$('.bn-item').forEach(b=>b.classList.remove('active'));
  $('#btn'+name[0].toUpperCase()+name.slice(1))?.classList.add('active');
}

async function fetchJSON(url,opts={}){
  const r = await fetch(url,{headers:{'Content-Type':'application/json'},...opts});
  if(!r.ok) throw new Error(await r.text());
  return r.json();
}

function toast(msg){
  const t=$('#toast');
  if(!t) return alert(msg);
  t.textContent=msg;
  t.style.display='block';
  setTimeout(()=>t.style.display='none',2000);
}

/* ================= BOOKING CARD ================= */

function bookingCard(b){
  const range = b.start_date===b.end_date
    ? b.start_date
    : `${b.start_date} → ${b.end_date}`;

  return `
  <div class="presta-card" data-id="${b.id}">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div>
        <strong>${b.clients?.name||'—'}</strong>
        <span style="opacity:.4;font-size:11px;">#${b.id}</span>
      </div>
      <div style="font-weight:700;color:#a855f7;">
        ${fmt(b.total_chf)} CHF
      </div>
    </div>

    <div style="opacity:.75;font-size:13px;margin-top:4px;">
      🐾 ${b.pets?.name||'—'} · ${b.prestations?.name||'—'}
    </div>

    <div style="opacity:.5;font-size:12px;margin-top:4px;">
      ${range}
    </div>
  </div>`;
}

/* ================= RENDER ================= */

function renderHome(){
  $('#upcomingList').innerHTML =
    state.upcoming.map(bookingCard).join('') ||
    `<div style="opacity:.6;">Aucune réservation.</div>`;
}

function renderPrestations(){
  $('#prestationsGrid').innerHTML =
    state.prestations.filter(p=>p.active!==false).map(p=>`
      <div class="presta-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${p.name}</strong>
          <span style="color:#a855f7;font-weight:700;">
            ${fmt(p.price_chf)} CHF
          </span>
        </div>

        <div style="opacity:.7;font-size:13px;margin-top:4px;">
          ${p.animal_type} · ${p.category}
          ${p.duration_min?` · ${p.duration_min} min`:''}
        </div>

        ${p.description
          ? `<div style="opacity:.5;font-size:12px;margin-top:6px;">${p.description}</div>`
          : ''
        }
      </div>
    `).join('') ||
    `<div style="opacity:.6;">Aucune prestation.</div>`;
}

function renderBookings(){
  const up = state.upcoming.filter(b=>b.end_date>=today());
  const past = state.past.filter(b=>b.end_date<today());

  $('#bookingsUpcoming').innerHTML =
    up.length
      ? up.map(bookingCard).join('')
      : `<div style="opacity:.6;">Rien à venir.</div>`;

  $('#bookingsPast').innerHTML =
    past.length
      ? past.map(bookingCard).join('')
      : `<div style="opacity:.6;">Rien en historique.</div>`;
}

function renderCompta(){
  const c = state.compta;
  if(!c) return;

  $('#comptaTotal').textContent = fmt(c.totalAll);
  $('#comptaEmp').textContent = fmt(c.totalEmp);
  $('#comptaCo').textContent = fmt(c.totalCo);

  const canvas = document.getElementById('comptaChart');
  if(!canvas || !window.Chart) return;

  if(state.pie) state.pie.destroy();

  state.pie = new Chart(canvas,{
    type:'doughnut',
    data:{
      labels:(c.topPrestations||[]).map(x=>x.prestation),
      datasets:[{
        data:(c.topPrestations||[]).map(x=>Number(x.total||0)),
        backgroundColor:[
          '#a855f7',
          '#9333ea',
          '#7e22ce',
          '#6b21a8',
          '#581c87'
        ]
      }]
    },
    options:{
      plugins:{
        legend:{position:'bottom'}
      },
      responsive:true
    }
  });

  $('#comptaPrestations').innerHTML =
    (c.topPrestations||[]).map(x=>`
      <div style="display:flex;justify-content:space-between;">
        <span>${x.prestation}</span>
        <strong>${fmt(x.total)} CHF</strong>
      </div>
    `).join('');
}

/* ================= LOAD ================= */

async function loadAll(){
  try{
    const [clients,prestations,upcoming,past,compta] = await Promise.all([
      fetchJSON('/api/clients'),
      fetchJSON('/api/prestations'),
      fetchJSON('/api/bookings/upcoming'),
      fetchJSON('/api/bookings/past'),
      fetchJSON('/api/compta/summary')
    ]);

    state.clients=clients||[];
    state.prestations=prestations||[];
    state.upcoming=upcoming||[];
    state.past=past||[];
    state.compta=compta||null;

    renderHome();
    renderPrestations();
    renderBookings();
    renderCompta();

  }catch(e){
    console.error(e);
    toast("Erreur chargement");
  }
}

/* ================= EVENTS ================= */

function wire(){
  $('#btnHome')?.addEventListener('click',()=>setPanel('home'));
  $('#btnPrestations')?.addEventListener('click',()=>setPanel('prestations'));
  $('#btnBookings')?.addEventListener('click',()=>setPanel('bookings'));
  $('#btnCompta')?.addEventListener('click',()=>setPanel('compta'));
}

document.addEventListener('DOMContentLoaded',()=>{
  wire();
  loadAll();
});

})();
