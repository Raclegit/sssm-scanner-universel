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
  document.getElementById('pre-scan-m').style.display = mode === 'marchandise' ? 'block' : 'none';
  document.getElementById('scan-card-title').textContent = mode === 'marchandise' ? 'Scanner le carton' : 'Scanner le badge';
  document.getElementById('btn-scan-label').textContent = mode === 'marchandise' ? 'Scanner le carton' : 'Scanner le badge SSSM';
  document.getElementById('btn-scan').className = 'btn-scan' + (mode === 'marchandise' ? ' mode-m' : '');
  document.getElementById('scan-hint').textContent = mode === 'marchandise' ? 'Centrer le DataMatrix / code-barres / QR' : 'Centrer le QR Code dans le cadre';
  document.getElementById('form-section-p').style.display = 'none';
  document.getElementById('form-section-m').style.display = 'none';
  document.querySelector('.card').style.display = mode === 'asp-rh' ? 'none' : 'block';
  document.getElementById('asp-rh-panel').style.display = mode === 'asp-rh' ? 'block' : 'none';
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
