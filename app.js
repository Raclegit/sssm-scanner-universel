// ── STATE ──────────────────────────────────────────────────────────
let stream = null;
let scanLoop = null;
let busyDetect = false;
let currentMode = 'personnel';       // 'personnel' | 'marchandise'
let scannedData = null;              // badge parsé
let scannedMerch = null;             // marchandise parsée
let selectedType = null;             // Entrée / Sortie
let selectedEtape = null;
const history = [];
const pendingQueue = [];             // scans en échec réseau, en mémoire (survit tant que la page reste ouverte)

// ── DÉTECTION BARCODE NATIVE (QR + DataMatrix + Code128/EAN) ───────
let detector = null;
let useNative = false;
if ('BarcodeDetector' in window) {
  (async () => {
    try {
      const supported = await BarcodeDetector.getSupportedFormats();
      const wanted = ['qr_code','data_matrix','code_128','code_39','ean_13','ean_8','itf'].filter(f => supported.includes(f));
      detector = new BarcodeDetector({ formats: wanted.length ? wanted : ['qr_code'] });
      useNative = true;
    } catch (e) { useNative = false; showDetectorWarning(); }
  })();
} else {
  showDetectorWarning();
}
function showDetectorWarning() {
  document.getElementById('detector-warning').style.display = 'block';
}

// ── HORLOGE ───────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById('hdr-time').textContent = now.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  document.getElementById('hdr-date').textContent = now.toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
}
updateClock();
setInterval(updateClock, 10000);

// ── INIT SELECTS ──────────────────────────────────────────────────
function fillSelect(id, options) {
  const sel = document.getElementById(id);
  options.forEach(s => { const o = document.createElement('option'); o.value = o.textContent = s; sel.appendChild(o); });
}
fillSelect('site-select-p', CONFIG.SITE_OPTIONS);
fillSelect('site-select-m', CONFIG.SITE_OPTIONS);
fillSelect('etape-select', CONFIG.ETAPE_OPTIONS);
document.getElementById('etape-select').addEventListener('change', e => { selectedEtape = e.target.value; });
selectedEtape = CONFIG.ETAPE_OPTIONS[0];

// ── BASCULE DE MODE ──────────────────────────────────────────────
  function setMode(mode) {
  currentMode = mode;
  stopScan();
  resetResultZone();
  document.getElementById('mbtn-p').className = 'mode-btn' + (mode === 'personnel' ? ' active-p' : '');
  document.getElementById('mbtn-m').className = 'mode-btn' + (mode === 'marchandise' ? ' active-m' : '');
  document.getElementById('mbtn-rh').className = 'mode-btn' + (mode === 'asp-rh' ? ' active-p' : '');
  document.getElementById('mbtn-cps').className = 'mode-btn' + (mode === 'cps-rh' ? ' active-p' : '');
  document.getElementById('mbtn-bso').className = 'mode-btn' + (mode === 'bso-rh' ? ' active-p' : '');
  document.getElementById('pre-scan-m').style.display = mode === 'marchandise' ? 'block' : 'none';
  document.getElementById('scan-card-title').textContent = mode === 'marchandise' ? 'Scanner le carton' : 'Scanner le badge';
  document.getElementById('btn-scan-label').textContent = mode === 'marchandise' ? 'Scanner le carton' : 'Scanner le badge SSSM';
  document.getElementById('btn-scan').className = 'btn-scan' + (mode === 'marchandise' ? ' mode-m' : '');
  document.getElementById('scan-hint').textContent = mode === 'marchandise' ? 'Centrer le DataMatrix / code-barres / QR' : 'Centrer le QR Code dans le cadre';
  document.getElementById('form-section-p').style.display = 'none';
  document.getElementById('form-section-m').style.display = 'none';
  const rhModes = ['asp-rh', 'cps-rh', 'bso-rh'];
  document.querySelector('.card').style.display = rhModes.includes(mode) ? 'none' : 'block';
  document.getElementById('asp-rh-panel').style.display = mode === 'asp-rh' ? 'block' : 'none';
  document.getElementById('cps-rh-panel').style.display = mode === 'cps-rh' ? 'block' : 'none';
  document.getElementById('bso-rh-panel').style.display = mode === 'bso-rh' ? 'block' : 'none';
}

// ── SCANNER (caméra) ─────────────────────────────────────────────
async function startScan() {
  const wrap = document.getElementById('scanner-wrap');
  const video = document.getElementById('camVideo');
  const btnScan = document.getElementById('btn-scan');
  const btnCancel = document.getElementById('btn-cancel');

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    wrap.classList.add('active');
    btnScan.style.display = 'none';
    btnCancel.style.display = 'block';
    resetResultZone();
    scanLoop = requestAnimationFrame(tick);
  } catch (e) {
    showStatus('Caméra inaccessible. Vérifiez les autorisations dans Chrome.', 'fail');
  }
}

async function tick() {
  const video = document.getElementById('camVideo');
  if (video.readyState === video.HAVE_ENOUGH_DATA && !busyDetect) {
    if (useNative && detector) {
      busyDetect = true;
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length > 0) { handleScan(codes[0].rawValue, codes[0].format); busyDetect = false; return; }
      } catch (e) { /* frame illisible, on continue */ }
      busyDetect = false;
    } else {
      const canvas = document.getElementById('camCanvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code) { handleScan(code.data, 'qr_code'); return; }
    }
  }
  scanLoop = requestAnimationFrame(tick);
}

function stopScan() {
  cancelAnimationFrame(scanLoop);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  document.getElementById('scanner-wrap').classList.remove('active');
  document.getElementById('btn-scan').style.display = 'flex';
  document.getElementById('btn-cancel').style.display = 'none';
}

function resetResultZone() {
  document.getElementById('result-zone').style.display = 'none';
  document.getElementById('result-zone').className = '';
  document.getElementById('res-extra').textContent = '';
}

// ── ROUTAGE DU SCAN SELON LE MODE ───────────────────────────────
function handleScan(raw, format) {
  stopScan();

  // Interception ASP, prioritaire sur le mode courant
  if (raw.startsWith(ASP_QR_PREFIX)) {
    handleASPScan(raw);
    return;
  }

  // Interception CPS, prioritaire sur le mode courant
  if (raw.startsWith(CPS_QR_PREFIX)) {
    handleCPSScan(raw);
    return;
  }

  if (currentMode === 'personnel') handleBadgeScan(raw);
  else handleMerchScan(raw, format);
}
// ── TRAITEMENT BADGE (personnel) ────────────────────────────────
function handleBadgeScan(raw) {
  const parts = raw.split('|');
  const rz = document.getElementById('result-zone');
  rz.style.display = 'block';
  rz.className = '';
  document.getElementById('res-label-top').textContent = 'Badge scanné';

  const isSSMM = parts[0] === 'SALAMA-SSSM';
  const isSAL  = parts[0] === 'SALAMA';

  if ((isSSMM || isSAL) && parts.length >= 3) {
    let mat, nom, svc, poste = '';

    if (isSSMM) {
      mat = (parts.find(p => p.startsWith('CODE:')) || '').replace('CODE:', '').trim() || parts[1] || '?';
      const catPart = parts.find(p => p.startsWith('CAT:'));
      svc = catPart ? catPart.replace('CAT:', '').trim() : (parts[2] || '—');
      const rolePart = parts.find(p => p.startsWith('ROLE:'));
      nom = rolePart ? rolePart.replace('ROLE:', '').trim() : (parts[3] || '—');
      const emPart = parts.find(p => p.startsWith('EMISSION:'));
      if (emPart) nom += ' · Émis : ' + emPart.replace('EMISSION:', '').trim();
    } else {
      mat = parts[1]?.replace('MAT:', '').trim() || '?';
      nom = parts[2] || '—';
      svc = parts[3] || '—';
      poste = parts[4] || '';
    }

    scannedData = { matricule: mat, nom, service: svc, poste, raw, isSSMM };

    document.getElementById('res-matricule').textContent = isSSMM ? mat : 'N° ' + mat;
    document.getElementById('res-matricule').className = 'res-value success-anim';
    document.getElementById('res-nom').textContent = nom;
    document.getElementById('res-service').textContent = (isSSMM ? 'Catégorie : ' : 'Service : ') + svc;
    document.getElementById('res-extra').textContent = (poste ? 'Poste : ' + poste + '  ·  ' : '') + '→ ' + (isSSMM ? CONFIG.TABLE_SSSM : CONFIG.TABLE_PERSONNEL);
    rz.classList.add('success-anim');

    document.getElementById('form-section-p').style.display = 'block';
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    autoDetectType();
  } else {
    rz.className = 'error';
    document.getElementById('res-matricule').className = 'res-value error';
    document.getElementById('res-matricule').textContent = 'QR invalide';
    document.getElementById('res-nom').textContent = raw.substring(0, 60);
    document.getElementById('res-service').textContent = 'Format attendu : SALAMA-SSSM|CODE:...|CAT:...|ROLE:... ou SALAMA|MAT:...|NOM|SERVICE';
    document.getElementById('res-extra').textContent = '';
    scannedData = null;
  }
}

function autoDetectType() {
  const now = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  setType(totalMin < 12 * 60 ? 'Entrée' : 'Sortie');
}
function setType(type) {
  selectedType = type;
  document.getElementById('btn-in').className  = 'type-btn' + (type === 'Entrée' ? ' selected-in' : '');
  document.getElementById('btn-out').className = 'type-btn' + (type === 'Sortie' ? ' selected-out' : '');
  updateSubmitBtn();
}

// ── TRAITEMENT MARCHANDISES / MÉDICAMENTS ───────────────────────
// Décodage GS1 (DataMatrix pharma : 01=GTIN/PC, 17=EXP, 10=LOT, 21=SN)
function parseGS1(raw) {
  const GS = String.fromCharCode(29);
  let s = raw.replace(/^\]d2/i, '').replace(/^\]Q3/i, ''); // retire l'identifiant de symbologie si présent
  const AIs = { '01':{len:14}, '17':{len:6}, '10':{len:null}, '21':{len:null}, '240':{len:null} };
  const out = {}; let i = 0;
  while (i < s.length) {
    let ai = null;
    if (AIs[s.substr(i,3)] !== undefined) ai = s.substr(i,3);
    else if (AIs[s.substr(i,2)] !== undefined) ai = s.substr(i,2);
    if (!ai) break;
    i += ai.length;
    const def = AIs[ai];
    let val;
    if (def.len) { val = s.substr(i, def.len); i += def.len; }
    else {
      const gsIdx = s.indexOf(GS, i);
      if (gsIdx === -1) { val = s.substr(i); i = s.length; }
      else { val = s.substring(i, gsIdx); i = gsIdx + 1; }
    }
    if (ai === '01') out.GTIN = val;
    if (ai === '17') out.EXP = val;
    if (ai === '10') out.LOT = val;
    if (ai === '21') out.SN = val;
    if (ai === '240') out.CIP = val;
  }
  return out;
}

function parseMerchandise(raw) {
  // On extrait uniquement le GTIN (AI 01, 14 chiffres) qui est fiable et non ambigu.
  // Lot/Expiration/Série ne sont PAS déduits automatiquement : sur ces cartons, les
  // champs GS1 variables ne sont pas séparés par un caractère GS détectable, donc un
  // découpage automatique donnerait de FAUSSES dates de péremption — trop risqué en
  // pharma. L'agent les saisit manuellement en les lisant sur la boîte.
  const gtinMatch = raw.match(/^01(\d{14})/);
  const codeProduit = gtinMatch ? gtinMatch[1] : raw;
  return { codeProduit, raw };
}

function handleMerchScan(raw, format) {
  const m = parseMerchandise(raw);
  scannedMerch = m;

  const rz = document.getElementById('result-zone');
  rz.style.display = 'block';
  rz.className = 'mode-m';
  document.getElementById('res-label-top').textContent = 'Carton scanné (' + (format || '?') + ')';
  document.getElementById('res-matricule').className = 'res-value success-anim';
  document.getElementById('res-matricule').textContent = m.codeProduit;
  document.getElementById('res-nom').textContent = 'Complétez le lot et la date de péremption ci-dessous (lus sur la boîte)';
  document.getElementById('res-service').textContent = '';
  document.getElementById('res-extra').textContent = 'Étape : ' + selectedEtape;
  rz.classList.add('success-anim');

  document.getElementById('form-section-m').style.display = 'block';
  document.getElementById('qty-input').value = '';
  document.getElementById('lot-input').value = '';
  document.getElementById('exp-input').value = '';
  updateSubmitBtn();
  if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
}

function updateSubmitBtn() {
  document.getElementById('btn-submit-p').disabled = !(scannedData && selectedType);
  const qty = document.getElementById('qty-input').value;
  const lot = document.getElementById('lot-input').value.trim();
  const exp = document.getElementById('exp-input').value.trim();
  document.getElementById('btn-submit-m').disabled = !(scannedMerch && qty && Number(qty) > 0 && lot && exp);
}

function resetForm() {
  scannedData = null; selectedType = null;
  scannedMerch = null;
  document.getElementById('btn-in').className  = 'type-btn';
  document.getElementById('btn-out').className = 'type-btn';
  document.getElementById('btn-submit-p').disabled = true;
  document.getElementById('btn-submit-m').disabled = true;
}

// ── ENVOI AIRTABLE — BADGE (routage SSSM vs Personnel) ──────────
async function submitPointage() {
  if (!scannedData || !selectedType) return;
  if (scannedData.isSSMM) return submitMouvementSSSM();
  return submitPointagePersonnel();
}

// SSSM : une ligne par scan (comportement inchangé)
async function submitMouvementSSSM() {
  const btn = document.getElementById('btn-submit-p');
  const now = new Date();
  const body = { fields: {
    "Code_Badge":      scannedData.matricule,
    "Categorie":       scannedData.service,
    "Role":            scannedData.nom,
    "Type_Mouvement":  selectedType,
    "Site_Poste":      document.getElementById('site-select-p').value,
    "Date_Heure":      now.toISOString().slice(0, 16),
  }};
  const ok = await sendToAirtable(CONFIG.TABLE_SSSM, body, btn);
  if (ok) {
    const heure = now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
    addHistory('p', scannedData.matricule, scannedData.nom, selectedType, heure);
    showStatus(`Pointage SSSM enregistré — ${scannedData.matricule} ${selectedType} à ${heure}`, 'ok');
    if (navigator.vibrate) navigator.vibrate([100,50,100,50,200]);
    setTimeout(() => { resetResultZone(); document.getElementById('form-section-p').style.display='none'; resetForm(); resetSubmitBtn(btn,'p'); }, 1800);
  } else { resetSubmitBtn(btn, 'p'); }
}

// Personnel administratif : upsert (1 ligne par matricule/jour)
async function submitPointagePersonnel() {
  const btn = document.getElementById('btn-submit-p');
  btn.disabled = true;
  btn.innerHTML = 'Envoi en cours…';
  showStatus('Enregistrement en cours…', 'sending');

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);      // YYYY-MM-DD
  const heureIso = now.toISOString().slice(0, 16);       // YYYY-MM-DDTHH:MM
  const heure = now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  const heureField = selectedType === 'Entrée' ? "Heure d'entrée théorique" : "Heure de sortie théorique";

  try {
    // 1. Chercher les lignes existantes pour ce matricule (les plus récentes),
    //    puis comparer la date côté code — plus fiable qu'un AND() de formule
    //    Airtable mêlant texte et champ Date (source du bug précédent).
    const formula = encodeURIComponent(`{Matricule}='${scannedData.matricule}'`);
    const searchUrl = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CONFIG.TABLE_PERSONNEL)}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=ID%20Pointage&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=10`;
    const searchResp = await fetch(searchUrl, { headers: { 'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}` } });
    if (!searchResp.ok) throw new Error('recherche impossible (HTTP ' + searchResp.status + ')');
    const searchData = await searchResp.json();
    const existing = (searchData.records || []).find(r => (r.fields['Date'] || '').slice(0, 10) === dateStr);

    let resp;
    if (existing) {
      resp = await fetch(`https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CONFIG.TABLE_PERSONNEL)}/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [heureField]: heureIso } }),
      });
    } else {
      resp = await fetch(`https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CONFIG.TABLE_PERSONNEL)}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
          "Date":       dateStr,
          "Matricule":  scannedData.matricule,
          "Nom":        scannedData.nom,
          "Service":    scannedData.service,
          "Poste":      scannedData.poste || '',
          "Site_Poste": document.getElementById('site-select-p').value,
          "Saisie par QR Code": true,
          [heureField]: heureIso,
        }}),
      });
    }

    if (resp.ok) {
      addHistory('p', scannedData.matricule, scannedData.nom, selectedType, heure);
      showStatus(`Pointage enregistré — ${scannedData.matricule} ${selectedType} à ${heure}`, 'ok');
      if (navigator.vibrate) navigator.vibrate([100,50,100,50,200]);
      setTimeout(() => { resetResultZone(); document.getElementById('form-section-p').style.display='none'; resetForm(); resetSubmitBtn(btn,'p'); }, 1800);
    } else {
      const err = await resp.json().catch(() => ({}));
      showStatus('Erreur Airtable : ' + (err?.error?.message || resp.status) + ' — merci de rescanner le badge.', 'fail');
      resetSubmitBtn(btn, 'p');
    }
  } catch (e) {
    showStatus('Réseau indisponible — réessayez le scan dans un instant (l\'upsert nécessite une recherche préalable, pas de mise en attente automatique possible pour ce type de pointage).', 'fail');
    resetSubmitBtn(btn, 'p');
  }
}

// ── ENVOI AIRTABLE — MARCHANDISES ───────────────────────────────
async function submitMouvementStock() {
  if (!scannedMerch) return;
  const qty = Number(document.getElementById('qty-input').value);
  if (!qty || qty <= 0) return;
  const btn = document.getElementById('btn-submit-m');
  const now = new Date();
  const body = { fields: {
    "Code_Produit":     scannedMerch.codeProduit,
    "Lot":              document.getElementById('lot-input').value.trim(),
    "Date_Expiration":  document.getElementById('exp-input').value.trim(),
    "Numero_Serie":     '',
    "Etape":            selectedEtape,
    "Quantite_Boites":  qty,
    "Site_Poste":       document.getElementById('site-select-m').value,
    "Date_Heure":       now.toISOString().slice(0, 16),
    "Code_Brut":        scannedMerch.raw,
  }};
  const ok = await sendToAirtable(CONFIG.TABLE_STOCK, body, btn);
  if (ok) {
    const heure = now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
    addHistory('m', scannedMerch.codeProduit, selectedEtape + ' · ' + qty + ' boîte(s)', '', heure);
    showStatus(`Mouvement enregistré — ${scannedMerch.codeProduit} (${qty} boîtes) à ${heure}`, 'ok');
    if (navigator.vibrate) navigator.vibrate([100,50,100,50,200]);
    setTimeout(() => { resetResultZone(); document.getElementById('form-section-m').style.display='none'; resetForm(); resetSubmitBtn(btn,'m'); }, 1800);
  } else { resetSubmitBtn(btn, 'm'); }
}

function resetSubmitBtn(btn, kind) {
  btn.disabled = kind === 'p' ? !(scannedData && selectedType) : !(scannedMerch);
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> ' + (kind === 'p' ? 'Valider le pointage' : 'Valider le mouvement');
}

// ── ENVOI GÉNÉRIQUE AVEC FILE D'ATTENTE HORS-LIGNE ──────────────
async function sendToAirtable(table, body, btn) {
  btn.disabled = true;
  btn.innerHTML = 'Envoi en cours…';
  showStatus('Enregistrement en cours…', 'sending');
  try {
    const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok) return true;
    const err = await resp.json().catch(() => ({}));
    const msg = err?.error?.message || `Erreur ${resp.status}`;
    queueAndWarn(table, body, 'Erreur Airtable : ' + msg);
    return false;
  } catch (e) {
    queueAndWarn(table, body, 'Réseau indisponible — scan mis en attente.');
    return false;
  }
}

function queueAndWarn(table, body, msg) {
  pendingQueue.push({ table, body });
  showStatus(msg + ` (${pendingQueue.length} en attente)`, 'fail', true);
}

async function retryQueue() {
  if (!pendingQueue.length) return;
  showStatus('Nouvel envoi de ' + pendingQueue.length + ' scan(s) en attente…', 'sending');
  const remaining = [];
  for (const item of pendingQueue) {
    try {
      const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(item.table)}`;
      const resp = await fetch(url, { method:'POST', headers:{ 'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`, 'Content-Type':'application/json' }, body: JSON.stringify(item.body) });
      if (!resp.ok) remaining.push(item);
    } catch (e) { remaining.push(item); }
  }
  pendingQueue.length = 0;
  pendingQueue.push(...remaining);
  showStatus(remaining.length ? `${remaining.length} scan(s) toujours en attente.` : 'Tous les scans en attente ont été envoyés.', remaining.length ? 'fail' : 'ok', remaining.length > 0);
}

// ── HISTORIQUE LOCAL (mémoire de session) ───────────────────────
function addHistory(kind, code, info, type, heure) {
  history.unshift({ kind, code, info, type, heure });
  const list = document.getElementById('history-list');
  const isIn = type === 'Entrée';
  const badgeClass = kind === 'm' ? 'm' : (isIn ? 'in' : 'out');
  const badgeGlyph = kind === 'm' ? '📦' : (isIn ? '→' : '←');
  const item = document.createElement('div');
  item.className = 'hist-item success-anim';
  item.innerHTML = `
    <div class="hist-badge ${badgeClass}">${badgeGlyph}</div>
    <div>
      <div class="hist-mat">${code}</div>
      <div class="hist-info">${info}${type ? ' — <span style="color:'+(isIn?'#2A7A26':'#C04A1A')+';font-weight:600">'+type+'</span>' : ''}</div>
    </div>
    <div class="hist-time">${heure}</div>
  `;
  if (list.querySelector('p')) list.innerHTML = '';
  list.prepend(item);
}

// ── BARRE DE STATUT ──────────────────────────────────────────────
function showStatus(msg, type, withRetry) {
  const bar = document.getElementById('status-bar');
  bar.innerHTML = msg + (withRetry ? ' <button onclick="retryQueue()">Réessayer</button>' : '');
  bar.className = type;
  bar.style.display = 'block';
  if (type === 'ok' || (type === 'fail' && !withRetry)) setTimeout(() => { bar.style.display = 'none'; }, 4000);
}
// ==================== MODULE ASP ====================

function checkRHPin() {
  const input = document.getElementById('asp-pin-input').value;
  if (input === RH_PIN) {
    document.getElementById('asp-pin-gate').style.display = 'none';
    document.getElementById('asp-form-container').style.display = 'block';
  } else {
    document.getElementById('asp-pin-error').style.display = 'block';
  }
}

function genererIdASP() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return 'asp_' + suffix;
}

async function genererASP() {
  const matricule = document.getElementById('asp-matricule').value.trim();
  const nom = document.getElementById('asp-nom').value.trim();
  const service = document.getElementById('asp-service').value;
  const motif = document.getElementById('asp-motif').value.trim();
  const sortiePrevue = document.getElementById('asp-sortie-prevue').value;
  const autorisePar = document.getElementById('asp-autorise-par').value.trim();

  if (!matricule || !nom || !service || !autorisePar) {
    alert('Veuillez remplir au minimum : matricule, nom, service, votre nom.');
    return;
  }

  const idAsp = genererIdASP();

  const record = {
    fields: {
      "ID_ASP": idAsp,
      "Matricule": matricule,
      "Nom": nom,
      "Service": service,
      "Motif": motif,
      "Date_Heure_Sortie_Prevue": sortiePrevue ? new Date(sortiePrevue).toISOString() : null,
      "Statut": ASP_STATUT.AUTORISE,
      "Autorisé_par": autorisePar
    }
  };

  try {
    const response = await fetch(`https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(ASP_TABLE)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(record)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erreur Airtable: ${errText}`);
    }

    const qrContent = `${ASP_QR_PREFIX}MAT:${matricule}|ID:${idAsp}`;
    afficherQRCode(qrContent, idAsp);

  } catch (err) {
    console.error(err);
    alert('Erreur lors de la création de l\'ASP: ' + err.message);
  }
}

function afficherQRCode(content, idAsp) {
  const container = document.getElementById('asp-qr-canvas');
  container.innerHTML = '';
  new QRCode(container, {
    text: content,
    width: 240,
    height: 240
  });
  document.getElementById('asp-qr-id').textContent = 'ID: ' + idAsp;
  document.getElementById('asp-qr-result').style.display = 'block';
}
function resetASPForm() {
  document.getElementById('asp-matricule').value = '';
  document.getElementById('asp-nom').value = '';
  document.getElementById('asp-service').value = '';
  document.getElementById('asp-motif').value = '';
  document.getElementById('asp-sortie-prevue').value = '';
  document.getElementById('asp-qr-result').style.display = 'none';
}

// ==================== ROUTAGE SCAN ASP ====================
// À insérer dans votre fonction de routage existante, AVANT le test SALAMA-SSSM/SALAMA

async function handleASPScan(raw) {
  const parts = raw.split('|');
  const idAsp = parts[2]?.split(':')[1];

  const rz = document.getElementById('result-zone');
  rz.style.display = 'block';

  if (!idAsp) {
    afficherErreurScanASP('QR ASP invalide');
    return;
  }

  try {
    const formula = encodeURIComponent(`{ID_ASP}='${idAsp}'`);
    const searchUrl = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(ASP_TABLE)}?filterByFormula=${formula}`;
    const searchResp = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}` }
    });
    if (!searchResp.ok) throw new Error('recherche impossible (HTTP ' + searchResp.status + ')');
    const searchData = await searchResp.json();

    if (!searchData.records || searchData.records.length === 0) {
      afficherErreurScanASP('ASP introuvable');
      return;
    }

    const record = searchData.records[0];
    const statutActuel = record.fields.Statut;
    const now = new Date().toISOString();

    if (statutActuel === ASP_STATUT.AUTORISE) {
      await mettreAJourASP(record.id, {
        "Date_Heure_Sortie_Reelle": now,
        "Statut": ASP_STATUT.SORTI
      });
      record.fields.Statut = ASP_STATUT.SORTI;
      afficherSuccesScanASP(record, 'sortie');

    } else if (statutActuel === ASP_STATUT.SORTI) {
      await mettreAJourASP(record.id, {
        "Date_Heure_Retour_Reelle": now,
        "Statut": ASP_STATUT.RENTRE
      });
      record.fields.Statut = ASP_STATUT.RENTRE;
      afficherSuccesScanASP(record, 'retour');

    } else {
      afficherErreurScanASP(`ASP déjà utilisée (statut: ${statutActuel})`);
    }

  } catch (err) {
    console.error(err);
    afficherErreurScanASP("Erreur lors du traitement de l'ASP");
  }
}

async function mettreAJourASP(recordId, fields) {
  const resp = await fetch(`https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(ASP_TABLE)}/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(errText);
  }
}

function afficherSuccesScanASP(record, typeAction) {
  const rz = document.getElementById('result-zone');
  rz.style.display = 'block';
  rz.className = '';
  rz.classList.add('success-anim');

  document.getElementById('res-label-top').textContent =
    typeAction === 'sortie' ? 'ASP — Sortie enregistrée' : 'ASP — Retour enregistré';

  document.getElementById('res-matricule').textContent = 'N° ' + record.fields.Matricule;
  document.getElementById('res-matricule').className = 'res-value success-anim';
  document.getElementById('res-nom').textContent = record.fields.Nom;
  document.getElementById('res-service').textContent = 'Service : ' + record.fields.Service;
  document.getElementById('res-extra').textContent =
    'Motif : ' + (record.fields.Motif || '—') + '  ·  → ' + ASP_TABLE;
}

function afficherErreurScanASP(message) {
  const rz = document.getElementById('result-zone');
  rz.style.display = 'block';
  rz.className = '';

  document.getElementById('res-label-top').textContent = 'ASP — Erreur';
  document.getElementById('res-matricule').textContent = '—';
  document.getElementById('res-nom').textContent = message;
  document.getElementById('res-service').textContent = '';
  document.getElementById('res-extra').textContent = '';
}
// ==================== MODULE CPS — PANNEAU RH ====================

let cpsRechercheEnCours = false;

async function rechercherSoldeCPS() {
  const matricule = document.getElementById('cps-matricule').value.trim();
  const infoBox = document.getElementById('cps-solde-info');
  const absentBox = document.getElementById('cps-solde-absent');
  const valeurSpan = document.getElementById('cps-solde-valeur');

  infoBox.style.display = 'none';
  absentBox.style.display = 'none';

  if (!matricule || cpsRechercheEnCours) return;
  cpsRechercheEnCours = true;

  try {
    const formula = encodeURIComponent(`{Matricule}='${matricule}'`);
    const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CPS_SOLDES_TABLE)}?filterByFormula=${formula}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}` }
    });
    if (!res.ok) throw new Error('recherche impossible');
    const data = await res.json();

    if (data.records && data.records.length > 0) {
      const solde = data.records[0].fields.Droit_Calcule;
      valeurSpan.textContent = (typeof solde === 'number') ? solde.toFixed(1) : '—';
      infoBox.style.display = 'block';

      // Pré-remplissage automatique du nom/service si disponibles
      const nomEmploye = data.records[0].fields.Nom;
      const serviceEmploye = data.records[0].fields.Service;
      if (nomEmploye) document.getElementById('cps-nom').value = nomEmploye;
      if (serviceEmploye) document.getElementById('cps-service').value = serviceEmploye;
    } else {
      absentBox.style.display = 'block';
    }
  } catch (err) {
    console.error(err);
  } finally {
    cpsRechercheEnCours = false;
  }
}

function genererIdCPS() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return 'cps_' + suffix;
}

async function genererCPS() {
  const matricule = document.getElementById('cps-matricule').value.trim();
  const nom = document.getElementById('cps-nom').value.trim();
  const service = document.getElementById('cps-service').value;
  const departPrevue = document.getElementById('cps-depart-prevue').value;
  const retourPrevue = document.getElementById('cps-retour-prevue').value;
  const autorisePar = document.getElementById('cps-autorise-par').value.trim();

  if (!matricule || !nom || !service || !departPrevue || !retourPrevue || !autorisePar) {
    alert('Veuillez remplir tous les champs.');
    return;
  }

  const idCps = genererIdCPS();

  const record = {
    fields: {
      "ID_CPS": idCps,
      "Matricule": matricule,
      "Nom": nom,
      "Service": service,
      "Date_Depart_Prevue": new Date(departPrevue).toISOString(),
      "Date_Retour_Prevue": new Date(retourPrevue).toISOString(),
      "Statut": CPS_STATUT.AUTORISE,
      "Autorisé_par": autorisePar
    }
  };

  try {
    const response = await fetch(`https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CPS_CONGES_TABLE)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(record)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText);
    }

    const qrContent = `${CPS_QR_PREFIX}MAT:${matricule}|ID:${idCps}`;
    afficherQRCodeCPS(qrContent, idCps);

  } catch (err) {
    console.error(err);
    alert('Erreur lors de la création du congé: ' + err.message);
  }
}

function afficherQRCodeCPS(content, idCps) {
  const container = document.getElementById('cps-qr-canvas');
  container.innerHTML = '';
  new QRCode(container, {
    text: content,
    width: 240,
    height: 240
  });
  document.getElementById('cps-qr-id').textContent = 'ID: ' + idCps;
  document.getElementById('cps-qr-result').style.display = 'block';
}

function resetCPSForm() {
  document.getElementById('cps-matricule').value = '';
  document.getElementById('cps-nom').value = '';
  document.getElementById('cps-service').value = '';
  document.getElementById('cps-depart-prevue').value = '';
  document.getElementById('cps-retour-prevue').value = '';
  document.getElementById('cps-solde-info').style.display = 'none';
  document.getElementById('cps-solde-absent').style.display = 'none';
  document.getElementById('cps-qr-result').style.display = 'none';
}
// ==================== TRAITEMENT SCAN CPS ====================

let cpsScanEnCours = false;

async function handleCPSScan(raw) {
  if (cpsScanEnCours) return;
  cpsScanEnCours = true;

  try {
    const parts = raw.split('|');
    const idCps = parts[2]?.split(':')[1];

    const rz = document.getElementById('result-zone');
    rz.style.display = 'block';

    if (!idCps) {
      afficherErreurScanCPS('QR Congé invalide');
      return;
    }

    const formula = encodeURIComponent(`{ID_CPS}='${idCps}'`);
    const searchUrl = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CPS_CONGES_TABLE)}?filterByFormula=${formula}`;
    const searchResp = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}` }
    });
    if (!searchResp.ok) throw new Error('recherche impossible (HTTP ' + searchResp.status + ')');
    const searchData = await searchResp.json();

    if (!searchData.records || searchData.records.length === 0) {
      afficherErreurScanCPS('Congé introuvable');
      return;
    }

    const record = searchData.records[0];
    const statutActuel = record.fields.Statut;
    const now = new Date().toISOString();

    if (statutActuel === CPS_STATUT.AUTORISE) {
      // Scan DÉPART
      await mettreAJourCPS(record.id, {
        "Date_Depart_Reelle": now,
        "Statut": CPS_STATUT.EN_CONGE
      });
      record.fields.Statut = CPS_STATUT.EN_CONGE;
      afficherSuccesScanCPS(record, 'depart');

    } else if (statutActuel === CPS_STATUT.EN_CONGE) {
      // Scan RETOUR — calcul des jours pris + mise à jour du solde
      const dateDepart = new Date(record.fields.Date_Depart_Reelle);
      const dateRetour = new Date(now);
      const joursPris = Math.round((dateRetour - dateDepart) / (1000 * 60 * 60 * 24) * 10) / 10;

      await mettreAJourCPS(record.id, {
        "Date_Retour_Reelle": now,
        "Statut": CPS_STATUT.TERMINE,
        "Jours_Pris": joursPris
      });

      await mettreAJourSoldeCPS(record.fields.Matricule, joursPris);

      record.fields.Statut = CPS_STATUT.TERMINE;
      record.fields.Jours_Pris = joursPris;
      afficherSuccesScanCPS(record, 'retour');

    } else {
      afficherErreurScanCPS(`Congé déjà utilisé (statut: ${statutActuel})`);
    }

  } catch (err) {
    console.error(err);
    afficherErreurScanCPS("Erreur lors du traitement du congé");
  } finally {
    cpsScanEnCours = false;
  }
}

async function mettreAJourCPS(recordId, fields) {
  const resp = await fetch(`https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CPS_CONGES_TABLE)}/${recordId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(errText);
  }
}

async function mettreAJourSoldeCPS(matricule, joursAjoutes) {
  // Recherche l'enregistrement du solde de l'employé
  const formula = encodeURIComponent(`{Matricule}='${matricule}'`);
  const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CPS_SOLDES_TABLE)}?filterByFormula=${formula}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}` }
  });
  if (!res.ok) throw new Error('recherche solde impossible');
  const data = await res.json();

  if (!data.records || data.records.length === 0) {
    console.error('Aucun solde trouvé pour la mise à jour du matricule ' + matricule);
    return;
  }

  const soldeRecord = data.records[0];
  const cumulActuel = soldeRecord.fields.Jours_Consommes_Cumules || 0;
  const nouveauCumul = cumulActuel + joursAjoutes;

  const updateResp = await fetch(`https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(CPS_SOLDES_TABLE)}/${soldeRecord.id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields: { "Jours_Consommes_Cumules": nouveauCumul } })
  });
  if (!updateResp.ok) {
    const errText = await updateResp.text();
    throw new Error(errText);
  }
}

function afficherSuccesScanCPS(record, typeAction) {
  const rz = document.getElementById('result-zone');
  rz.style.display = 'block';
  rz.className = '';
  rz.classList.add('success-anim');

  document.getElementById('res-label-top').textContent =
    typeAction === 'depart' ? 'CPS — Départ en congé' : 'CPS — Retour de congé';

  document.getElementById('res-matricule').textContent = 'N° ' + record.fields.Matricule;
  document.getElementById('res-matricule').className = 'res-value success-anim';
  document.getElementById('res-nom').textContent = record.fields.Nom;
  document.getElementById('res-service').textContent = 'Service : ' + record.fields.Service;
  document.getElementById('res-extra').textContent =
    typeAction === 'retour'
      ? `Jours pris : ${record.fields.Jours_Pris} · → ${CPS_CONGES_TABLE}`
      : `→ ${CPS_CONGES_TABLE}`;
}

function afficherErreurScanCPS(message) {
  const rz = document.getElementById('result-zone');
  rz.style.display = 'block';
  rz.className = '';

  document.getElementById('res-label-top').textContent = 'CPS — Erreur';
  document.getElementById('res-matricule').textContent = '—';
  document.getElementById('res-nom').textContent = message;
  document.getElementById('res-service').textContent = '';
  document.getElementById('res-extra').textContent = '';
}
// ==================== MODULE BSO — PANNEAU DIRECTION ====================

let bsoRechercheEnCours = false;
let bsoASPValide = null; // stocke l'ID_ASP trouvé
let bsoListeObjets = []; // liste des objets ajoutés avant validation

async function rechercherASPPourBSO() {
  const matricule = document.getElementById('bso-matricule').value.trim();
  const infoBox = document.getElementById('bso-asp-info');
  const absentBox = document.getElementById('bso-asp-absent');
  const idSpan = document.getElementById('bso-asp-id');

  infoBox.style.display = 'none';
  absentBox.style.display = 'none';
  bsoASPValide = null;

  if (!matricule || bsoRechercheEnCours) return;
  bsoRechercheEnCours = true;

  try {
    // Recherche une ASP de ce matricule dont le statut est Autorisé ou Sorti (donc "active" aujourd'hui)
    const formula = encodeURIComponent(`AND({Matricule}='${matricule}', OR({Statut}='${ASP_STATUT.AUTORISE}', {Statut}='${ASP_STATUT.SORTI}'))`);
    const url = `https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(ASP_TABLE)}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Date_Creation&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}` }
    });
    if (!res.ok) throw new Error('recherche impossible');
    const data = await res.json();

    if (data.records && data.records.length > 0) {
      const asp = data.records[0].fields;
      bsoASPValide = asp.ID_ASP;
      idSpan.textContent = asp.ID_ASP;
      infoBox.style.display = 'block';

      if (asp.Nom) document.getElementById('bso-nom').value = asp.Nom;
      if (asp.Service) document.getElementById('bso-service').value = asp.Service;
    } else {
      absentBox.style.display = 'block';
    }
  } catch (err) {
    console.error(err);
  } finally {
    bsoRechercheEnCours = false;
  }
}

function genererIdBSO() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return 'bso_' + suffix;
}

function ajouterObjetBSO() {
  const code = document.getElementById('bso-code-objet').value.trim();
  const description = document.getElementById('bso-description-objet').value.trim();

  if (!description) {
    alert('Veuillez renseigner au moins une description pour l\'objet.');
    return;
  }

  bsoListeObjets.push({
    code: code,
    description: description,
    typeSaisie: code ? 'Scan' : 'Manuel'
  });

  document.getElementById('bso-code-objet').value = '';
  document.getElementById('bso-description-objet').value = '';

  afficherListeObjetsBSO();
}

function retirerObjetBSO(index) {
  bsoListeObjets.splice(index, 1);
  afficherListeObjetsBSO();
}

function afficherListeObjetsBSO() {
  const container = document.getElementById('bso-liste-objets');
  if (bsoListeObjets.length === 0) {
    container.innerHTML = '<p style="color:#aaa;font-size:13px;text-align:center;padding:10px 0">Aucun objet ajouté</p>';
    return;
  }

  container.innerHTML = bsoListeObjets.map((obj, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;background:#f5f5f5;border-radius:8px;padding:10px 12px;margin-bottom:6px;">
      <div>
        <div style="font-weight:600;font-size:14px;">${obj.description}</div>
        <div style="font-size:12px;color:#888;">${obj.code ? 'Code: ' + obj.code : 'Saisie manuelle'}</div>
      </div>
      <button onclick="retirerObjetBSO(${i})" style="background:none;border:none;color:#C0392B;font-size:18px;cursor:pointer;padding:4px 10px;">✕</button>
    </div>
  `).join('');
}

async function validerBSO() {
  const matricule = document.getElementById('bso-matricule').value.trim();
  const nom = document.getElementById('bso-nom').value.trim();
  const service = document.getElementById('bso-service').value;
  const validePar = document.getElementById('bso-valide-par').value.trim();

  if (!bsoASPValide) {
    alert('Aucune ASP valide trouvée pour ce matricule. Le BSO ne peut pas être créé.');
    return;
  }
  if (!matricule || !nom || !service || !validePar) {
    alert('Veuillez remplir tous les champs (matricule, nom, service, votre nom).');
    return;
  }
  if (bsoListeObjets.length === 0) {
    alert('Veuillez ajouter au moins un objet à la liste.');
    return;
  }

  const qrContainer = document.getElementById('bso-qr-result');
  qrContainer.innerHTML = '<p style="text-align:center;color:#888;">Génération en cours...</p>';
  qrContainer.style.display = 'block';

  const qrCodesGeneres = [];

  try {
    for (const objet of bsoListeObjets) {
      const idBso = genererIdBSO();

      const record = {
        fields: {
          "ID_BSO": idBso,
          "ID_ASP_Associe": bsoASPValide,
          "Matricule": matricule,
          "Nom": nom,
          "Service": service,
          "Code_Objet": objet.code || "",
          "Description_Objet": objet.description,
          "Type_Saisie": objet.typeSaisie,
          "Valide_par": validePar,
          "Statut": BSO_STATUT.AUTORISE
        }
      };

      const response = await fetch(`https://api.airtable.com/v0/${CONFIG.AIRTABLE_BASE_ID}/${encodeURIComponent(BSO_TABLE)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(record)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText);
      }

      const qrContent = `${BSO_QR_PREFIX}MAT:${matricule}|ID:${idBso}`;
      qrCodesGeneres.push({ idBso, description: objet.description, qrContent });
    }

    afficherQRCodesBSO(qrCodesGeneres);

  } catch (err) {
    console.error(err);
    alert('Erreur lors de la création du BSO: ' + err.message);
  }
}

function afficherQRCodesBSO(listeQR) {
  const container = document.getElementById('bso-qr-result');
  container.innerHTML = '';

  listeQR.forEach(item => {
    const bloc = document.createElement('div');
    bloc.style.cssText = 'text-align:center; margin-bottom:24px; padding-bottom:20px; border-bottom:1px solid #eee;';

    const titre = document.createElement('p');
    titre.style.cssText = 'font-weight:600; margin-bottom:8px;';
    titre.textContent = item.description;
    bloc.appendChild(titre);

    const qrDiv = document.createElement('div');
    bloc.appendChild(qrDiv);

    const idLabel = document.createElement('p');
    idLabel.style.cssText = 'font-size:12px; color:#888; margin-top:6px;';
    idLabel.textContent = 'ID: ' + item.idBso;
    bloc.appendChild(idLabel);

    container.appendChild(bloc);

    new QRCode(qrDiv, {
      text: item.qrContent,
      width: 200,
      height: 200
    });
  });

  document.getElementById('bso-btn-reset').style.display = 'block';
}

function resetBSOForm() {
  document.getElementById('bso-matricule').value = '';
  document.getElementById('bso-nom').value = '';
  document.getElementById('bso-service').value = '';
  document.getElementById('bso-valide-par').value = '';
  document.getElementById('bso-code-objet').value = '';
  document.getElementById('bso-description-objet').value = '';
  document.getElementById('bso-asp-info').style.display = 'none';
  document.getElementById('bso-asp-absent').style.display = 'none';
  document.getElementById('bso-qr-result').style.display = 'none';
  document.getElementById('bso-qr-result').innerHTML = '';
  document.getElementById('bso-btn-reset').style.display = 'none';
  bsoASPValide = null;
  bsoListeObjets = [];
  afficherListeObjetsBSO();
}
