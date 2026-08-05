/* Flighty Logbook Converter — all flight-file processing happens in the browser. */
const AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const $ = (id) => document.getElementById(id);
const fileInput = $('fileInput');
const convertBtn = $('convertBtn');
const statusEl = $('status');
const progressEl = $('progress');
let chosenFile = null;
let convertedRows = [];
let airportMap = null;

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

fileInput.addEventListener('change', () => {
  chosenFile = fileInput.files?.[0] || null;
  $('fileName').textContent = chosenFile ? chosenFile.name : 'No file selected';
  convertBtn.disabled = !chosenFile;
  setStatus(chosenFile ? 'Ready to convert.' : 'Choose a CSV to begin.');
});
convertBtn.addEventListener('click', convertFile);
$('xlsxBtn').addEventListener('click', exportXlsx);
$('csvBtn').addEventListener('click', exportCsv);

function setStatus(message, kind='') {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
}
function setProgress(value, message) {
  progressEl.hidden = false;
  progressEl.value = value;
  if (message) setStatus(message);
}

async function convertFile() {
  try {
    convertBtn.disabled = true;
    $('resultsCard').hidden = true;
    setProgress(5, 'Reading the Flighty CSV…');
    assertLibraries();
    const text = await chosenFile.text();
    const parsed = Papa.parse(text, {header:true, skipEmptyLines:true});
    if (parsed.errors?.length && !parsed.data.length) throw new Error(parsed.errors[0].message);
    validateHeaders(parsed.meta.fields || []);

    setProgress(15, 'Loading airport coordinates and time zones…');
    if (!airportMap) airportMap = await loadAirports();
    setProgress(35, `Airport database ready. Processing ${parsed.data.length} flights…`);

    const role = $('crewRole').value;
    const nightOffset = Number($('nightOffset').value);
    const useDiversion = $('useDiversion').checked;
    const results = [];
    const warnings = [];
    const seen = new Set();

    for (let i=0; i<parsed.data.length; i++) {
      const raw = parsed.data[i];
      const dedupeKey = raw['Flight Flighty ID'] || [raw.Date, raw.From, raw.To, raw['Gate Departure (Actual)'], raw['Tail Number']].join('|');
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      if (String(raw.Canceled).toLowerCase() === 'true') continue;
      try {
        const result = processFlight(raw, role, nightOffset, useDiversion);
        results.push(result);
      } catch (err) {
        warnings.push(`Row ${i+2}: ${err.message}`);
      }
      if (i % 5 === 0) {
        setProgress(35 + Math.round((i / Math.max(parsed.data.length,1)) * 55), `Processing flight ${i+1} of ${parsed.data.length}…`);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    if (!results.length) throw new Error(warnings[0] || 'No completed flights could be converted.');
    convertedRows = results;
    renderResults(results, warnings);
    setProgress(100, `Converted ${results.length} flights${warnings.length ? ` with ${warnings.length} warning(s)` : ''}.`);
    setStatus(`Converted ${results.length} flights. Save the Excel or CSV file below.${warnings.length ? ` ${warnings.length} row(s) need review.` : ''}`, warnings.length ? '' : 'success');
    progressEl.hidden = true;
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), 'error');
    progressEl.hidden = true;
  } finally {
    convertBtn.disabled = !chosenFile;
  }
}

function assertLibraries() {
  if (!window.Papa) throw new Error('CSV library did not load. Check your internet connection and reopen the app.');
  if (!window.SunCalc) throw new Error('Sunset library did not load. Check your internet connection and reopen the app.');
  if (!window.ExcelJS) throw new Error('Excel export library did not load. Check your internet connection and reopen the app.');
  if (!window.luxon?.DateTime) throw new Error('UTC conversion library did not load. Check your internet connection and reopen the app.');
  if (!getTzLookup()) throw new Error('Time-zone library did not load. Check your internet connection and reopen the app.');
}
function getTzLookup() {
  return window.tzlookup || window.tzLookup || window.tz_lookup || (typeof window.tz === 'function' ? window.tz : null);
}
function validateHeaders(fields) {
  const required = ['Date','From','To','Gate Departure (Actual)','Take off (Actual)','Landing (Actual)','Gate Arrival (Actual)','Aircraft Type Name','Tail Number'];
  const missing = required.filter(h => !fields.includes(h));
  if (missing.length) throw new Error(`This does not look like a Flighty export. Missing: ${missing.join(', ')}`);
}

async function loadAirports() {
  let csvText;
  try {
    const response = await fetch(AIRPORTS_URL, {cache:'force-cache'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    csvText = await response.text();
  } catch (e) {
    throw new Error('Could not download the airport database. Connect to the internet and try again.');
  }
  const parsed = Papa.parse(csvText, {header:true, skipEmptyLines:true, dynamicTyping:false});
  const map = new Map();
  for (const a of parsed.data) {
    const lat = Number(a.latitude_deg), lon = Number(a.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const record = {name:a.name, lat, lon, ident:a.ident, iata:a.iata_code, gps:a.gps_code};
    for (const code of [a.iata_code, a.gps_code, a.ident, a.local_code]) {
      if (code && !map.has(code.toUpperCase())) map.set(code.toUpperCase(), record);
    }
  }
  if (map.size < 1000) throw new Error('Airport database loaded incorrectly. Try again with a stable internet connection.');
  return map;
}

function processFlight(raw, role, nightOffsetMin, useDiversion) {
  const fromCode = String(raw.From || '').trim().toUpperCase();
  const scheduledTo = String(raw.To || '').trim().toUpperCase();
  const diversion = String(raw['Diverted To'] || '').trim().toUpperCase();
  const actualToCode = useDiversion && diversion ? diversion : scheduledTo;
  const dep = airportMap.get(fromCode);
  const arr = airportMap.get(actualToCode);
  if (!dep) throw new Error(`Airport ${fromCode || '(blank)'} was not found.`);
  if (!arr) throw new Error(`Airport ${actualToCode || '(blank)'} was not found.`);
  const tzFn = getTzLookup();
  const depTz = tzFn(dep.lat, dep.lon);
  const arrTz = tzFn(arr.lat, arr.lon);

  const outUtc = zonedLocalToUtc(raw['Gate Departure (Actual)'], depTz);
  const inUtc = zonedLocalToUtc(raw['Gate Arrival (Actual)'], arrTz);
  const takeoffUtc = zonedLocalToUtc(raw['Take off (Actual)'], depTz);
  const landingUtc = zonedLocalToUtc(raw['Landing (Actual)'], arrTz);
  if (!outUtc || !inUtc) throw new Error('Missing actual gate departure or arrival time.');
  const totalMinutes = Math.round((inUtc - outUtc) / 60000);
  if (totalMinutes < 0 || totalMinutes > 24*60) throw new Error(`Calculated block time ${totalMinutes} minutes is invalid.`);

  let nightMinutes = 0, dayLandings = 0, nightLandings = 0, lateLanding = false;
  if (takeoffUtc && landingUtc && landingUtc > takeoffUtc) {
    nightMinutes = calculateNightMinutes(takeoffUtc, landingUtc, dep, arr, nightOffsetMin);
    const nightLanding = isNightAt(landingUtc, arr.lat, arr.lon, nightOffsetMin);
    nightLandings = nightLanding ? 1 : 0;
    dayLandings = nightLanding ? 0 : 1;
    lateLanding = isNightAt(landingUtc, arr.lat, arr.lon, 60);
  }

  return {
    date: raw.Date,
    from: fromCode,
    to: scheduledTo,
    actualTo: actualToCode,
    totalMinutes,
    nightMinutes,
    picMinutes: role === 'PIC' ? totalMinutes : 0,
    sicMinutes: role === 'SIC' ? totalMinutes : 0,
    aircraft: raw['Aircraft Type Name'] || '',
    tail: raw['Tail Number'] || '',
    dayLandings,
    nightLandings,
    lateLanding,
    remarks: diversion ? `Diverted to ${diversion}` : '',
    depTz, arrTz
  };
}

function zonedLocalToUtc(value, timeZone) {
  if (!value) return null;
  const text = String(value).trim();
  const DateTime = window.luxon?.DateTime;
  if (!DateTime) throw new Error('UTC conversion library is unavailable.');

  // Flighty exports airport-local timestamps without an offset. Interpret the
  // wall-clock value in that airport's IANA time zone, then convert to UTC.
  // If a future Flighty export includes Z or an explicit offset, preserve it.
  const hasExplicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  let dt = hasExplicitOffset
    ? DateTime.fromISO(text, {setZone:true})
    : DateTime.fromISO(text, {zone:timeZone, setZone:true});

  if (!dt.isValid) {
    throw new Error(`Could not interpret timestamp "${text}" in ${timeZone}: ${dt.invalidExplanation || dt.invalidReason}`);
  }
  return dt.toUTC().toJSDate();
}

function calculateNightMinutes(start, end, dep, arr, offsetMin) {
  const duration = (end-start)/60000;
  const whole = Math.max(1, Math.ceil(duration));
  let night = 0;
  for (let i=0;i<whole;i++) {
    const intervalStart = new Date(start.getTime()+i*60000);
    const intervalEnd = new Date(Math.min(end.getTime(), intervalStart.getTime()+60000));
    const midpoint = new Date((intervalStart.getTime()+intervalEnd.getTime())/2);
    const fraction = Math.min(1, Math.max(0, (midpoint-start)/(end-start)));
    const point = greatCirclePoint(dep.lat, dep.lon, arr.lat, arr.lon, fraction);
    if (isNightAt(midpoint, point.lat, point.lon, offsetMin)) night += (intervalEnd-intervalStart)/60000;
  }
  return Math.round(night);
}
function isNightAt(date, lat, lon, offsetMin) {
  const sunsets=[], sunrises=[];
  for (const shift of [-1,0,1]) {
    const probe = new Date(date.getTime()+shift*86400000);
    const t = SunCalc.getTimes(probe, lat, lon);
    if (validDate(t.sunset)) sunsets.push(new Date(t.sunset.getTime()+offsetMin*60000));
    if (validDate(t.sunrise)) sunrises.push(t.sunrise);
  }
  const previousSunset = sunsets.filter(x=>x<=date).sort((a,b)=>b-a)[0];
  if (!previousSunset) return false;
  const followingSunrise = sunrises.filter(x=>x>previousSunset).sort((a,b)=>a-b)[0];
  return date >= previousSunset && (!followingSunrise || date < followingSunrise);
}
function validDate(d){return d instanceof Date && !Number.isNaN(d.getTime());}
function greatCirclePoint(lat1,lon1,lat2,lon2,f) {
  const r=Math.PI/180, p1=lat1*r,l1=lon1*r,p2=lat2*r,l2=lon2*r;
  const delta=2*Math.asin(Math.sqrt(Math.sin((p2-p1)/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin((l2-l1)/2)**2));
  if (!delta) return {lat:lat1,lon:lon1};
  const A=Math.sin((1-f)*delta)/Math.sin(delta), B=Math.sin(f*delta)/Math.sin(delta);
  const x=A*Math.cos(p1)*Math.cos(l1)+B*Math.cos(p2)*Math.cos(l2);
  const y=A*Math.cos(p1)*Math.sin(l1)+B*Math.cos(p2)*Math.sin(l2);
  const z=A*Math.sin(p1)+B*Math.sin(p2);
  return {lat:Math.atan2(z,Math.sqrt(x*x+y*y))/r,lon:Math.atan2(y,x)/r};
}

function renderResults(rows, warnings) {
  $('resultsCard').hidden = false;
  $('resultTitle').textContent = `${rows.length} flights processed`;
  const totals = rows.reduce((a,r)=>({total:a.total+r.totalMinutes,night:a.night+r.nightMinutes,day:a.day+r.dayLandings,nl:a.nl+r.nightLandings}),{total:0,night:0,day:0,nl:0});
  $('summaryGrid').innerHTML = [
    metric(formatMinutes(totals.total),'Total time'), metric(formatMinutes(totals.night),'Night time'), metric(totals.day,'Day landings'), metric(totals.nl,'Night landings')
  ].join('');
  $('previewBody').innerHTML = rows.slice(0,100).map(r=>`<tr class="${r.lateLanding?'late':''}"><td>${escapeHtml(r.date)}</td><td>${r.from}</td><td>${r.to}${r.actualTo!==r.to?` → ${r.actualTo}`:''}</td><td>${formatMinutes(r.totalMinutes)}</td><td>${formatMinutes(r.nightMinutes)}</td><td>${formatMinutes(r.picMinutes)}</td><td>${formatMinutes(r.sicMinutes)}</td><td>${r.dayLandings}</td><td>${r.nightLandings}</td></tr>`).join('');
  if (warnings.length) console.warn(warnings.join('\n'));
}
function metric(value,label){return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;}
function formatMinutes(m){m=Math.max(0,Math.round(Number(m)||0));return `${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`;}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function exportXlsx() {
  if (!convertedRows.length) return;
  try {
    setStatus('Building Excel workbook…');
    const wb = new ExcelJS.Workbook();
    wb.creator='Flighty Logbook Converter';
    const ws=wb.addWorksheet('Logbook Import',{views:[{state:'frozen',ySplit:1}]});
    ws.columns=[
      {header:'Date',key:'date',width:13},{header:'From',key:'from',width:9},{header:'To',key:'to',width:9},
      {header:'Total Time',key:'total',width:13},{header:'Night Time',key:'night',width:13},{header:'PIC',key:'pic',width:11},{header:'SIC',key:'sic',width:11},
      {header:'Aircraft Type',key:'aircraft',width:20},{header:'Tail Number',key:'tail',width:14},{header:'Day Landings',key:'day',width:14},{header:'Night Landings',key:'nightLdg',width:15},{header:'Remarks',key:'remarks',width:22}
    ];
    ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}}; ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F4E78'}};
    for(const r of convertedRows){
      const row=ws.addRow({date:dateOnly(r.date),from:r.from,to:r.to,total:r.totalMinutes/1440,night:r.nightMinutes/1440,pic:r.picMinutes/1440,sic:r.sicMinutes/1440,aircraft:r.aircraft,tail:r.tail,day:r.dayLandings,nightLdg:r.nightLandings,remarks:r.remarks});
      for(const c of [4,5,6,7]) row.getCell(c).numFmt='[h]:mm';
      row.getCell(1).numFmt='mm/dd/yyyy';
      if(r.lateLanding) row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};
    }
    ws.autoFilter={from:'A1',to:'L1'};
    const notes=wb.addWorksheet('Calculation Notes');
    notes.addRows([
      ['Setting','Method'],['Total Time','Actual gate departure to actual gate arrival, converted to UTC using airport-coordinate time zones.'],
      ['Night Time',`Estimated airborne minutes after ${$('nightOffset').value} minutes past sunset and before sunrise, sampled along the great-circle route.`],
      ['Landings','One day or night landing per completed flight with an actual landing timestamp.'],
      ['Yellow rows','Landing occurred at least one hour after local sunset.'],['Crew role',$('crewRole').value],['Airport data','OurAirports public dataset']
    ]);
    notes.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};notes.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F4E78'}};notes.columns=[{width:22},{width:100}];notes.getColumn(2).alignment={wrapText:true};
    const buffer=await wb.xlsx.writeBuffer();
    saveAs(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),`Converted_Logbook_${todayStamp()}.xlsx`);
    setStatus('Excel workbook created.', 'success');
  } catch(e){setStatus(`Excel export failed: ${e.message}`,'error');}
}
function dateOnly(s){const p=String(s).split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2]));}
function exportCsv() {
  const fields=['Date','From','To','Total Time','Night Time','PIC','SIC','Aircraft Type','Tail Number','Day Landings','Night Landings','Remarks'];
  const data=convertedRows.map(r=>[r.date,r.from,r.to,formatMinutes(r.totalMinutes),formatMinutes(r.nightMinutes),formatMinutes(r.picMinutes),formatMinutes(r.sicMinutes),r.aircraft,r.tail,r.dayLandings,r.nightLandings,r.remarks]);
  const csv=Papa.unparse({fields,data});
  saveAs(new Blob([csv],{type:'text/csv;charset=utf-8'}),`Converted_Logbook_${todayStamp()}.csv`);
}
function todayStamp(){return new Date().toISOString().slice(0,10);}
