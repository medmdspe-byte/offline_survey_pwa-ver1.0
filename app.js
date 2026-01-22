// app.js（GPS失敗理由を必ず表示 / リトライ付き / 外部ライブラリなし）
const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }
function setStatus(msg, ok=true){ statusEl.innerHTML = `<span style="color:${ok?"#0a7":"#c00"}">${esc(msg)}</span>`; }

const pad2 = n => (n<10?"0":"")+n;
const pad3 = n => (n<10?"00":(n<100?"0":""))+n;

// photo_name：年月日時分-枝番.ext（例 202601221416-001.jpg）
function makePhotoName(ext="jpg"){
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const key = `photo_seq_${stamp}`;
  let seq = parseInt(localStorage.getItem(key) || "0", 10) + 1;
  if (!Number.isFinite(seq) || seq < 1) seq = 1;
  localStorage.setItem(key, String(seq));
  return `${stamp}-${pad3(seq)}.${ext}`;
}

function fileToDataURL(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// GPS：高精度→失敗したら低精度で再試行（失敗理由は必ず返す）
function getGPSOnce(opts){
  return new Promise((resolve, reject)=>{
    if (!navigator.geolocation) return reject(new Error("GPS非対応ブラウザです"));
    navigator.geolocation.getCurrentPosition(
      (pos)=>resolve(pos.coords),
      (err)=>reject(err),
      opts
    );
  });
}
async function getGPS(){
  // 1) 高精度（GPS）
  try{
    return await getGPSOnce({ enableHighAccuracy:true, timeout:15000, maximumAge:0 });
  }catch(e1){
    // 2) 低精度（Wi-Fi/基地局）
    try{
      return await getGPSOnce({ enableHighAccuracy:false, timeout:20000, maximumAge:300000 });
    }catch(e2){
      // 失敗理由を整形して投げる
      const msg = geoErrorToText(e2 || e1);
      throw new Error(msg);
    }
  }
}
function geoErrorToText(err){
  // GeolocationPositionError: code 1=PERMISSION_DENIED 2=POSITION_UNAVAILABLE 3=TIMEOUT
  const code = err?.code;
  const raw = err?.message ? ` / ${err.message}` : "";
  if (code === 1) return `GPS失敗: 許可されていません（位置情報を許可してください）${raw}`;
  if (code === 2) return `GPS失敗: 位置を特定できません（屋外/窓際、位置情報ON確認）${raw}`;
  if (code === 3) return `GPS失敗: タイムアウト（少し待つ/屋外へ移動）${raw}`;
  return `GPS失敗: 不明エラー${raw}`;
}

function csvEscape(v){
  const s=(v ?? "").toString();
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function toQgisCsv(recs){
  const header = ["latitude","longitude","memo","photo_name"];
  const lines=[header.join(",")];
  for(const r of recs){
    lines.push([csvEscape(r.latitude),csvEscape(r.longitude),csvEscape(r.memo),csvEscape(r.photo_name)].join(","));
  }
  return lines.join("\r\n");
}

function downloadBlob(name, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=name;
  document.body.appendChild(a);
  a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

/* ZIP（非圧縮 store-only）: CSVも同梱 */
function u32le(n){ return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]; }
function u16le(n){ return [n&255,(n>>>8)&255]; }
const CRC32_TABLE=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=CRC32_TABLE[(c^bytes[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
const enc = new TextEncoder();
function strBytes(s){ return enc.encode(s); }
function concat(chunks){ let len=0; for(const c of chunks) len+=c.length; const out=new Uint8Array(len); let off=0; for(const c of chunks){ out.set(c,off); off+=c.length; } return out; }
function dateToDos(dt){
  const d=dt;
  const dosTime=((d.getHours()&31)<<11)|((d.getMinutes()&63)<<5)|((Math.floor(d.getSeconds()/2))&31);
  const dosDate=(((d.getFullYear()-1980)&127)<<9)|(((d.getMonth()+1)&15)<<5)|(d.getDate()&31);
  return {dosTime,dosDate};
}
async function dataUrlToBytes(dataUrl){
  const res = await fetch(dataUrl);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
async function makeZip(files){
  const localParts=[], centralParts=[];
  let offset=0;
  for(const f of files){
    const nameB=strBytes(f.name);
    const bytes=f.bytes;
    const crc=crc32(bytes);
    const size=bytes.length;
    const {dosTime,dosDate}=dateToDos(f.mtime||new Date());
    const localHdr=new Uint8Array([
      0x50,0x4b,0x03,0x04, 20,0, 0,0, 0,0,
      ...u16le(dosTime), ...u16le(dosDate),
      ...u32le(crc), ...u32le(size), ...u32le(size),
      ...u16le(nameB.length), 0,0
    ]);
    localParts.push(localHdr,nameB,bytes);

    const centralHdr=new Uint8Array([
      0x50,0x4b,0x01,0x02, 20,0, 20,0, 0,0, 0,0,
      ...u16le(dosTime), ...u16le(dosDate),
      ...u32le(crc), ...u32le(size), ...u32le(size),
      ...u16le(nameB.length), 0,0, 0,0, 0,0, 0,0,
      ...u32le(0), ...u32le(offset)
    ]);
    centralParts.push(centralHdr,nameB);

    offset += localHdr.length + nameB.length + bytes.length;
  }
  const centralStart=offset;
  const central=concat(centralParts);
  const local=concat(localParts);
  const cdSize=central.length;
  const eocd=new Uint8Array([
    0x50,0x4b,0x05,0x06, 0,0,0,0,
    ...u16le(files.length), ...u16le(files.length),
    ...u32le(cdSize), ...u32le(centralStart),
    0,0
  ]);
  return concat([local,central,eocd]);
}

/* UI */
async function refreshList(){
  const recs = await idbGetAll();
  $("count").textContent = String(recs.length);
  const list = $("list");
  if (!list) return;
  recs.sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||""));
  list.innerHTML = recs.map(r=>`<div style="padding:6px 0;border-bottom:1px dashed #eee">${esc(r.photo_name||"")} / ${esc(r.created_at||"")}</div>`).join("");
}

function setSavedPreview(rec){
  if (!$("savedName")) return; // index.htmlが旧なら無視
  $("savedName").textContent = rec ? (rec.photo_name||"") : "未保存";
  $("savedLatLon").textContent = rec ? `lat=${Number(rec.latitude).toFixed(6)} / lon=${Number(rec.longitude).toFixed(6)} (±${Math.round(rec.accuracy||0)}m)` : "未保存";
  $("savedMemo").textContent = rec ? (rec.memo||"") : "";
  const img=$("savedImg");
  if (img && rec?.photo_dataurl){ img.src=rec.photo_dataurl; img.style.display="block"; }
  else if (img){ img.style.display="none"; }
}

async function onRecord(){
  try{
    const f = $("photoInput")?.files?.[0];
    if (!f) return setStatus("写真を選んでください", false);

    setStatus("GPS取得中…（許可ダイアログが出たら許可）");
    const g = await getGPS(); // 失敗理由はthrowされる

    setStatus("写真を処理中…");
    const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
    const photo_name = makePhotoName(ext);
    const rec = {
      id: Date.now().toString() + "_" + Math.random().toString(16).slice(2),
      created_at: new Date().toISOString(),
      latitude: g.latitude,
      longitude: g.longitude,
      accuracy: g.accuracy,
      memo: $("memoInput")?.value || "",
      photo_name,
      photo_dataurl: await fileToDataURL(f)
    };

    await idbPut(rec);
    if ($("memoInput")) $("memoInput").value="";
    if ($("photoInput")) $("photoInput").value="";
    if ($("photoInfo")) $("photoInfo").textContent="";

    await refreshList();
    setSavedPreview(rec);
    setStatus(`保存OK: ${photo_name}`);
  }catch(e){
    setStatus(e?.message || String(e), false);
  }
}

async function onZip(){
  try{
    const recs = await idbGetAll();
    if (!recs.length) return setStatus("データがありません", false);
    recs.sort((a,b)=>(a.created_at||"").localeCompare(b.created_at||""));

    setStatus("ZIP生成中…");
    const d=new Date();
    const y=d.getFullYear(), mo=pad2(d.getMonth()+1), da=pad2(d.getDate()), hh=pad2(d.getHours()), mm=pad2(d.getMinutes());

    const csvName = `survey_qgis_${y}${mo}${da}_${hh}${mm}.csv`;
    const csv = toQgisCsv(recs);
    const files = [{ name: csvName, bytes: enc.encode(csv), mtime: new Date() }];

    for (const r of recs){
      if (!r.photo_dataurl || !r.photo_name) continue;
      const bytes = await dataUrlToBytes(r.photo_dataurl);
      files.push({ name: r.photo_name, bytes, mtime: new Date(r.created_at || Date.now()) });
    }
    if (files.length <= 1) return setStatus("写真がありません（CSVのみ）", false);

    const zipBytes = await makeZip(files);
    const zipName = `survey_export_${y}${mo}${da}_${hh}${mm}.zip`;
    downloadBlob(zipName, new Blob([zipBytes], {type:"application/zip"}));
    setStatus(`ZIPを書き出しました: ${zipName}`);
  }catch(e){
    setStatus(e?.message || String(e), false);
  }
}

async function onClear(){
  if (!confirm("端末内の記録を全削除します。よろしいですか？")) return;
  await idbClear();
  await refreshList();
  setSavedPreview(null);
  setStatus("全削除しました");
}

(async ()=>{
  // SW登録（存在すれば）
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js"); } catch {}
  }

  $("btnRecord") && ($("btnRecord").onclick = onRecord);
  $("btnZip") && ($("btnZip").onclick = onZip);
  $("btnRefresh") && ($("btnRefresh").onclick = refreshList);
  $("btnClear") && ($("btnClear").onclick = onClear);

  await refreshList();
  setStatus("準備OK");
})();
