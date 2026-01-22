const $=id=>document.getElementById(id);
const statusEl=$("status");
const pad2=n=>(n<10?"0":"")+n, pad3=n=>(n<10?"00":n<100?"0":"")+n;

function setStatus(m,ok=true){statusEl.innerHTML=`<span style="color:${ok?"#0a7":"#c00"}">${m}</span>`;}

function makePhotoName(ext="jpg"){
  const d=new Date();
  const stamp=`${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const k=`seq_${stamp}`; let s=+(localStorage.getItem(k)||0)+1; localStorage.setItem(k,s);
  return `${stamp}-${pad3(s)}.${ext}`;
}
const fileToDataURL=f=>new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(f);});
const getGPS=()=>new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(p=>res(p.coords),e=>rej(e)));

function toCSV(rs){
  return ["latitude,longitude,memo,photo_name"].concat(rs.map(r=>`${r.latitude},${r.longitude},"${(r.memo||"").replace(/"/g,'""')}",${r.photo_name}`)).join("\n");
}
function download(name,blob){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();}

async function refresh(){
  const rs=await idbGetAll(); $("count").textContent=rs.length;
  $("list").innerHTML=rs.map(r=>`<div>${r.photo_name}</div>`).join("");
}

function preview(r){
  $("savedName").textContent=r.photo_name;
  $("savedLatLon").textContent=`${r.latitude}, ${r.longitude}`;
  $("savedMemo").textContent=r.memo||"";
  $("savedImg").src=r.photo_dataurl; $("savedImg").style.display="block";
}

$("btnRecord").onclick=async()=>{
  try{
    const f=$("photoInput").files[0]; if(!f) return setStatus("写真なし",false);
    setStatus("GPS取得中…"); const g=await getGPS();
    const name=makePhotoName(f.name.split(".").pop());
    const rec={id:Date.now(),created_at:new Date().toISOString(),
      latitude:g.latitude,longitude:g.longitude,accuracy:g.accuracy,
      memo:$("memoInput").value||"",photo_name:name,photo_dataurl:await fileToDataURL(f)};
    await idbPut(rec); await refresh(); preview(rec);
    setStatus(`保存OK: ${name}`);
  }catch(e){setStatus("失敗",false);}
};

$("btnZip").onclick=async()=>{
  const rs=await idbGetAll(); if(!rs.length) return setStatus("データなし",false);
  const csv=new TextEncoder().encode(toCSV(rs));
  const files=[{name:"survey.csv",bytes:csv}];
  for(const r of rs){ files.push({name:r.photo_name,bytes:await (await fetch(r.photo_dataurl)).arrayBuffer()}); }
  const zip=new JSZip(); files.forEach(f=>zip.file(f.name,f.bytes));
  download("survey_export.zip",await zip.generateAsync({type:"blob"}));
};

$("btnRefresh").onclick=refresh;
$("btnClear").onclick=async()=>{await idbClear(); await refresh(); setStatus("全削除");};

refresh(); setStatus("準備OK");
