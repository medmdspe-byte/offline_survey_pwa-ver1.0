// ★ 安定版GPS：watchPositionで一度掴む
async function getGPS() {
  if (!navigator.geolocation) {
    throw new Error("GPS非対応ブラウザです");
  }

  return new Promise((resolve, reject) => {
    let resolved = false;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (resolved) return;
        resolved = true;
        navigator.geolocation.clearWatch(watchId);
        resolve(pos.coords);
      },
      (err) => {
        if (resolved) return;
        navigator.geolocation.clearWatch(watchId);

        // 失敗理由を明示
        if (err.code === 1) reject(new Error("GPS失敗: 許可されていません"));
        else if (err.code === 2) reject(new Error("GPS失敗: 位置を特定できません（屋外へ）"));
        else if (err.code === 3) reject(new Error("GPS失敗: タイムアウト（待って再試行）"));
        else reject(new Error("GPS失敗: 不明エラー"));
      },
      {
        enableHighAccuracy: false, // ★ 重要：まず低精度で掴む
        maximumAge: 0,
        timeout: 30000
      }
    );

    // 念のための保険タイマー
    setTimeout(() => {
      if (!resolved) {
        navigator.g
