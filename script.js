/* Mutual Fund SIP & Lumpsum calculator script
   - Supports amount slider 1,000 - 500,000
   - Rate 1% - 30% (annual)
   - Tenure 1 - 20 years
*/

let chart = null;
let fundChart = null;

// --- Fund charting map & generator ---
const fundDataMap = {
  'sbi-gold': { title: 'SBI Gold Fund', desc: 'Representative yearly returns (%)' },
  'nippon-gold': { title: 'Nippon India Gold Fund', desc: 'Representative yearly returns (%)' },
  'hdfc-gold': { title: 'HDFC Gold Fund', desc: 'Representative yearly returns (%)' },
  'icici-gold-etf': { title: 'ICICI Prudential Gold ETF', desc: 'Representative yearly returns (%)' },
  'aditya-birla-gold': { title: 'Aditya Birla Sun Life Gold Fund', desc: 'Representative yearly returns (%)' },
  'kotak-gold-etf': { title: 'Kotak Gold ETF', desc: 'Representative yearly returns (%)' },
  'uti-gold-etf': { title: 'UTI Gold ETF', desc: 'Representative yearly returns (%)' },
  'axis-gold-etf': { title: 'Axis Gold ETF', desc: 'Representative yearly returns (%)' },
  'invesco-gold': { title: 'Invesco India Gold Fund', desc: 'Representative yearly returns (%)' },
  'edelweiss-gold': { title: 'Edelweiss Gold ETF', desc: 'Representative yearly returns (%)' }
};

// seeded pseudo-random generator (deterministic per slug)
function xmur3(str){
  for(var i=0,iLen=str.length, h=1779033703 ^ iLen; i<iLen; i++){
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function(){
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }
}
function mulberry32(a){
  return function(){
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

function generateSeries(slug, years = 10){
  const seedFn = xmur3(slug);
  const seed = seedFn();
  const rand = mulberry32(seed);
  const labels = [];
  const data = [];
  const currentYear = new Date().getFullYear();
  const base = 4 + (seed % 10); // base mean
  let value = base;
  for(let i = years-1; i >= 0; i--){
    const year = currentYear - i;
    labels.push(String(year));
    const shock = (rand() - 0.5) * (4 + rand()*6);
    value = Math.max(-15, Math.min(40, value * (0.92 + rand()*0.16) + shock));
    data.push(Math.round(value*10)/10);
  }
  return { labels, data };
}

const el = {
  modeSip: document.getElementById('mode-sip'),
  modeLumpsum: document.getElementById('mode-lumpsum'),
  amount: document.getElementById('amount'),
  rate: document.getElementById('rate'),
  tenure: document.getElementById('tenure'),
  amountLabel: document.getElementById('amount-label'),
  rateLabel: document.getElementById('rate-label'),
  tenureLabel: document.getElementById('tenure-label'),
  calcBtn: document.getElementById('calc'),
  resetBtn: document.getElementById('reset'),
  statMode: document.getElementById('stat-mode'),
  statAmountType: document.getElementById('stat-amount-type'),
  simpleInvested: document.getElementById('simple-invested'),
  simpleReturns: document.getElementById('simple-returns'),
  chartCanvas: document.getElementById('resultChart')
};

function formatCurrency(val){
  try{
    return val.toLocaleString('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0});
  }catch(e){
    return '₹' + Math.round(val).toString();
  }
}

function updateLabels(){
  el.amountLabel.textContent = formatCurrency(Number(el.amount.value));
  el.rateLabel.textContent = Number(el.rate.value) + '%';
  el.tenureLabel.textContent = el.tenure.value;
  // mode text
  if(el.modeSip.checked){
    el.statMode.textContent = 'SIP (monthly)';
    el.statAmountType.textContent = 'Monthly contribution';
  }else{
    el.statMode.textContent = 'Lumpsum';
    el.statAmountType.textContent = 'One-time investment';
  }
}

function calc(){
  const mode = el.modeSip.checked ? 'sip' : 'lumpsum';
  const amount = Number(el.amount.value);
  const annualRate = Number(el.rate.value)/100;
  const years = Number(el.tenure.value);

  let invested = 0, fv = 0, returns = 0, cagr = 0;

  if(mode === 'sip'){
    const monthly = amount;
    const r = annualRate/12;
    const n = years*12;
    if(r === 0){
      fv = monthly * n;
    }else{
      fv = monthly * ((Math.pow(1 + r, n) - 1)/r) * (1 + r);
    }
    invested = monthly * n;
    returns = fv - invested;
    // approximate annualized return (CAGR) for SIP via numeric solve (bisection)
    cagr = solveAnnualizedRateForSIP(monthly, n, fv) || 0;
  }else{
    invested = amount;
    fv = invested * Math.pow(1 + annualRate, years);
    returns = fv - invested;
    cagr = Math.pow(fv/invested, 1/years) - 1;
  }

  // Update UI (detailed breakdown below the chart)
  if(el.simpleInvested) el.simpleInvested.textContent = formatCurrency(Math.round(invested));
  if(el.simpleReturns) el.simpleReturns.textContent = formatCurrency(Math.round(returns));
  const totalEl = document.getElementById('simple-total');
  if(totalEl) totalEl.textContent = formatCurrency(Math.round(invested + returns));

  updateChart(invested, Math.max(0, returns));
}

function updateChart(invested, returns){
  const ctx = el.chartCanvas.getContext('2d');
  const data = [invested, Math.max(0, returns)];
  if(chart){ chart.destroy(); }
  chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Invested','Returns'],
      datasets:[{data, backgroundColor:['#2563eb','#10b981'], hoverOffset:6}]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false}
      }
    }
  });
}

// Solve for annualized rate for SIP using bisection
function solveAnnualizedRateForSIP(monthly, nMonths, targetFV){
  // find annual rate r such that monthly * ((1+r_month)^n -1)/r_month * (1+r_month) = targetFV
  const f = (annual) => {
    const r = annual/12;
    if(r === 0) return monthly * nMonths - targetFV;
    return monthly * ((Math.pow(1 + r, nMonths) - 1)/r) * (1 + r) - targetFV;
  };
  let lo = 0; let hi = 1; // 0% to 100%
  if(f(hi) < 0) return null; // even 100% can't reach target (unlikely)
  let mid, val;
  for(let i=0;i<60;i++){
    mid = (lo+hi)/2;
    val = f(mid);
    if(Math.abs(val) < 1) break; // close enough
    if(val > 0) hi = mid; else lo = mid;
  }
  return mid; // annual rate in decimal
}

// Reset to defaults
function resetAll(){
  el.amount.value = 10000;
  el.rate.value = 8;
  el.tenure.value = 10;
  el.modeSip.checked = true;
  updateLabels();
  calc();
}

// Event listeners
el.amount.addEventListener('input', updateLabels);
el.rate.addEventListener('input', updateLabels);
el.tenure.addEventListener('input', updateLabels);
el.modeSip.addEventListener('change', updateLabels);
el.modeLumpsum.addEventListener('change', updateLabels);
el.calcBtn.addEventListener('click', calc);
el.resetBtn.addEventListener('click', resetAll);

// Initialize
document.addEventListener('DOMContentLoaded', ()=>{
  updateLabels();
  calc();
  // if a fund query param is present, render its chart
  const params = new URLSearchParams(window.location.search);
  const fund = params.get('fund');
  if(fund){
    renderFundFromParam(fund);
  }
});

function renderFundFromParam(slug){
  const meta = fundDataMap[slug];
  const card = document.getElementById('fundCard');
  const titleEl = document.getElementById('fundTitle');
  const descEl = document.getElementById('fundDesc');
  const canvas = document.getElementById('fundChart');
  if(!meta || !card || !canvas) return;
  // hide calculator UI so only fund view is visible
  const left = document.querySelector('.left-panel');
  const resultCard = document.querySelector('.result-card');
  const right = document.querySelector('.right-panel');
  if(left) left.style.display = 'none';
  if(resultCard) resultCard.style.display = 'none';
  if(right) right.style.width = '100%';

  // show card
  card.style.display = 'block';
  titleEl.textContent = meta.title;
  descEl.textContent = meta.desc;
  const series = generateSeries(slug, 10);
  if(fundChart) fundChart.destroy();
  const ctx = canvas.getContext('2d');
  fundChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: [{ label: 'Yearly %', data: series.data, borderColor: '#D4AF37', backgroundColor: 'rgba(212,175,55,0.14)', fill: true, tension: 0.38, pointRadius:5, pointHoverRadius:7 }]
    },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label: ctx => `${ctx.parsed.y}%`}} },
      scales: { y: { ticks: { callback: v => v + '%' } } }
    }
  });
  // populate year-over-year changes below the chart
  const changesEl = document.getElementById('fundChanges');
  if(changesEl){
    changesEl.innerHTML = '';
    const vals = series.data; // yearly % values
    const labs = series.labels;
    // create bullets for each year-to-year change: "YYYY → YYYY: +X%"
    for(let i=1;i<vals.length;i++){
      const prev = Number(vals[i-1]);
      const curr = Number(vals[i]);
      const diff = Math.round((curr - prev) * 10) / 10; // one decimal
      const sign = diff > 0 ? '+' : (diff < 0 ? '' : '');
      const li = document.createElement('li');
      // color positive green, negative red
      const color = diff >= 0 ? '#10b981' : '#ef4444';
      li.innerHTML = `${labs[i-1]} → ${labs[i]}: <strong style="color:${color}">${sign}${diff}%</strong> <span style="color:var(--muted)">(${prev}% → ${curr}%)</span>`;
      changesEl.appendChild(li);
    }
  }
  // wire close button to restore UI
  const closeBtn = document.getElementById('closeFund');
  if(closeBtn){
    // navigate to the Top 10 Gold Funds page when closing a fund view
    closeBtn.onclick = () => {
      // prefer a full navigation so user clearly leaves the calculator view
      window.location.href = 'gold.html';
    };
  }
}
