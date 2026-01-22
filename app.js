const DB_NAME = "surveyDB";
const STORE = "records";

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STORE, { keyPath: "id" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function record() {
  const photo = document.getElementById("photo").files[0];
  if (!photo) return alert("写真を選択してください");

  navigator.geolocation.getCurrentPosition(async pos => {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      id: Date.now(),
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      memo: document.getElementById("memo").value,
      photo_name: photo.name
    });
    document.getElementById("status").textContent = "保存しました";
  });
}

async function exportCSV() {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).getAll();
  req.onsuccess = () => {
    const rows = req.result;
    let csv = "latitude,longitude,memo,photo_name\n";
    rows.forEach(r => {
      csv += `${r.latitude},${r.longitude},"${r.memo}",${r.photo_name}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "survey.csv";
    a.click();
  };
}
