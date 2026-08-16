// ============================================================
// 設定(方法A: PCサーバーに依存せず、GitHub Gistのスナップショットのみを見る)
// ============================================================
const SNAPSHOT_URL_KEY = "bookmgr_snapshot_url";
const SNAPSHOT_CACHE_KEY = "bookmgr_snapshot_cache"; // { generated_at, items, fetched_at }
const HISTORY_KEY = "bookmgr_scan_history";
const HISTORY_MAX = 10;
const RESCAN_COOLDOWN_MS = 1800; // 同じバーコードを連続で読み取らないためのクールダウン

const { findByIsbn, seriesVolumes, searchText } = window.BookMatching;

let html5QrCode = null;
let lastScannedIsbn = null;
let lastScannedAt = 0;

function $(sel) { return document.querySelector(sel); }

// ============================================================
// QRコード経由の初回設定(?src=... を検出したら自動でURLを保存)
// PC画面で生成されるQRコードには、GitHub PagesのURLに
// Gistの生データURLが ?src= パラメータとして埋め込まれている。
// これにより、スマホでQRコードを読み取るだけで手入力なしに設定が完了する。
// ============================================================
(function applySetupUrlFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const src = params.get("src");
  if (!src) return;

  try {
    localStorage.setItem(SNAPSHOT_URL_KEY, decodeURIComponent(src));
  } catch (_) {
    localStorage.setItem(SNAPSHOT_URL_KEY, src);
  }

  // URLをブックマーク・共有してもsrcが残らないよう、履歴を汚さずクエリを消す
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, "", cleanUrl);
})();

// ============================================================
// Service Worker登録(PWA・アプリシェルのオフライン対応)
// ============================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ============================================================
// スナップショットURLの設定(初回設定 / 変更)
// ============================================================
function getSnapshotUrl() {
  return localStorage.getItem(SNAPSHOT_URL_KEY);
}

function openSettings() {
  $("#snapshotUrlInput").value = getSnapshotUrl() || "";
  $("#settingsError").textContent = "";
  $("#settingsOverlay").hidden = false;
}

function closeSettings() {
  $("#settingsOverlay").hidden = true;
}

$("#settingsBtn").addEventListener("click", openSettings);
$("#settingsCancelBtn").addEventListener("click", () => {
  // 初回設定(まだURL未設定)の場合はキャンセルさせない(設定必須のため)
  if (getSnapshotUrl()) closeSettings();
});

$("#settingsSaveBtn").addEventListener("click", async () => {
  const url = $("#snapshotUrlInput").value.trim();
  const errorEl = $("#settingsError");

  if (!url || !/^https?:\/\//.test(url)) {
    errorEl.textContent = "有効なURLを入力してください";
    return;
  }

  errorEl.textContent = "確認しています…";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.items)) throw new Error("想定した形式のデータではありません");

    localStorage.setItem(SNAPSHOT_URL_KEY, url);
    localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify({ ...data, fetched_at: new Date().toISOString() }));
    closeSettings();
    updateSyncStatusDisplay();
  } catch (err) {
    errorEl.textContent = `取得できませんでした: ${err.message}`;
  }
});

// ============================================================
// スナップショットの取得・キャッシュ
// ============================================================
function loadSnapshotCache() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function formatTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "";
  }
}

async function refreshSnapshot() {
  const url = getSnapshotUrl();
  if (!url) {
    // 初回起動時は設定を求める
    openSettings();
    updateSyncStatusDisplay();
    return;
  }

  if (!navigator.onLine) {
    updateSyncStatusDisplay();
    return;
  }

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    if (!Array.isArray(data.items)) throw new Error("invalid format");
    localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify({ ...data, fetched_at: new Date().toISOString() }));
  } catch (_) {
    // オンラインでも同期先が一時的に落ちている場合はキャッシュを使い続ける
  }
  updateSyncStatusDisplay();
}

function updateSyncStatusDisplay() {
  const statusEl = $("#syncStatus");
  const cache = loadSnapshotCache();

  if (!getSnapshotUrl()) {
    statusEl.textContent = "未設定(右上の⚙から設定してください)";
    return;
  }
  if (!cache) {
    statusEl.textContent = "データ未取得";
    return;
  }
  const onlineLabel = navigator.onLine ? "" : "(オフライン)";
  statusEl.textContent = `${cache.items.length}冊・PC側の同期: ${formatTime(cache.generated_at)} ${onlineLabel}`;
}

window.addEventListener("online", refreshSnapshot);
window.addEventListener("focus", refreshSnapshot);
refreshSnapshot();

// ============================================================
// 照合(完全にlocalStorageのキャッシュに対して行う。ネットワーク呼び出しなし)
// ============================================================
function checkIsbn(isbn) {
  const cache = loadSnapshotCache();
  if (!cache) {
    return { found: false, noCache: true };
  }
  const hit = findByIsbn(cache.items, isbn);
  if (!hit) {
    return { found: false };
  }
  return {
    found: true,
    title: hit.title,
    seriesName: hit.series_name,
    volume: hit.volume,
    seriesVolumes: seriesVolumes(cache.items, hit.series_name),
  };
}

function runLocalTextSearch(q) {
  const cache = loadSnapshotCache();
  if (!cache) return null; // null = キャッシュなし(呼び出し側でエラー表示)
  return searchText(cache.items, q);
}

// ============================================================
// 結果表示
// ============================================================
function showResult(isbn, result) {
  const overlay = $("#resultOverlay");
  const icon = $("#resultIcon");
  const headline = $("#resultHeadline");
  const titleEl = $("#resultTitle");
  const subEl = $("#resultSub");
  const volumesEl = $("#resultVolumes");

  volumesEl.innerHTML = "";

  if (result.noCache) {
    icon.className = "result-icon offline";
    icon.textContent = "!";
    headline.textContent = "判定できません";
    titleEl.textContent = "データが未設定・未取得です";
    subEl.textContent = "右上の⚙からPCで表示されたURLを設定してください";
  } else if (result.found) {
    icon.className = "result-icon found";
    icon.textContent = "✓";
    headline.textContent = "持っています";
    titleEl.textContent = result.title || "(タイトル不明)";
    subEl.textContent = "登録済みです";

    if (result.seriesVolumes && result.seriesVolumes.length > 1) {
      volumesEl.innerHTML = result.seriesVolumes
        .map(v => `<span class="vol-chip">${v}巻</span>`)
        .join("");
    }
  } else {
    icon.className = "result-icon not-found";
    icon.textContent = "✕";
    headline.textContent = "持っていません";
    titleEl.textContent = isbn;
    subEl.textContent = "未登録の書籍です";
  }

  overlay.hidden = false;
  addHistory(isbn, result);
}

$("#resultCloseBtn").addEventListener("click", () => {
  $("#resultOverlay").hidden = true;
});

// ============================================================
// スキャン履歴
// ============================================================
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function addHistory(isbn, result) {
  const history = loadHistory();
  history.unshift({
    isbn,
    title: result.title || null,
    found: !!result.found && !result.noCache,
    time: new Date().toISOString(),
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_MAX)));
  renderHistory();
}

function renderHistory() {
  const history = loadHistory();
  const container = $("#historyList");
  if (!history.length) {
    container.innerHTML = `<p class="history-empty">まだ履歴がありません</p>`;
    return;
  }
  container.innerHTML = history.map(h => `
    <div class="history-item">
      <span class="history-dot ${h.found ? "found" : "not-found"}"></span>
      <span class="h-title">${escapeHtml(h.title || h.isbn)}</span>
      <span class="h-time">${new Date(h.time).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span>
    </div>
  `).join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

renderHistory();

// ============================================================
// カメラスキャン(html5-qrcode)
// ============================================================
$("#startCameraBtn").addEventListener("click", startCamera);

async function startCamera() {
  if (typeof Html5Qrcode === "undefined") {
    alert("バーコード読み取りライブラリを読み込めませんでした。手入力をご利用ください。");
    return;
  }
  $("#startCameraBtn").hidden = true;
  try {
    // ISBNのバーコード(EAN-13)を明示的に指定し、検出精度を上げる。
    // formatsToSupportはstart()ではなくコンストラクタで指定するのが正しい仕様。
    html5QrCode = new Html5Qrcode("reader", {
      formatsToSupport: window.Html5QrcodeSupportedFormats ? [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
      ] : undefined,
    });
    await html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: { width: 280, height: 120 },
        // 対応ブラウザ(Chrome等)ではOSネイティブのバーコード検出APIを使い、精度・速度を上げる。
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      },
      onScanSuccess,
      () => {}
    );
  } catch (err) {
    console.error("カメラ起動エラー:", err);
    alert("カメラを起動できませんでした。ブラウザのカメラ権限を確認してください。");
    $("#startCameraBtn").hidden = false;
  }
}

function onScanSuccess(decodedText) {
  const digits = decodedText.replace(/[^0-9]/g, "");
  if (digits.length !== 13) return;

  const now = Date.now();
  if (digits === lastScannedIsbn && now - lastScannedAt < RESCAN_COOLDOWN_MS) return;
  lastScannedIsbn = digits;
  lastScannedAt = now;

  showResult(digits, checkIsbn(digits));
}

// ============================================================
// 手入力照合
// ============================================================
$("#manualCheckBtn").addEventListener("click", () => {
  const isbn = $("#manualIsbnInput").value.trim().replace(/[^0-9]/g, "");
  if (!isbn) return;
  showResult(isbn, checkIsbn(isbn));
  $("#manualIsbnInput").value = "";
});

// ============================================================
// テキスト検索(ISBNなし本向け)
// ============================================================
$("#modeToggleBtn").addEventListener("click", () => {
  const scanMode = $("#scanMode");
  const textMode = $("#textMode");
  const toText = scanMode.classList.contains("is-active");
  scanMode.classList.toggle("is-active", !toText);
  textMode.classList.toggle("is-active", toText);
});

$("#textSearchBtn").addEventListener("click", runTextSearchUi);
$("#textSearchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runTextSearchUi();
});

function runTextSearchUi() {
  const q = $("#textSearchInput").value.trim();
  const resultsEl = $("#textSearchResults");
  if (!q) return;

  const items = runLocalTextSearch(q);
  if (items === null) {
    resultsEl.innerHTML = `<p class="no-results">データが未設定・未取得です。右上の⚙から設定してください</p>`;
    return;
  }
  if (!items.length) {
    resultsEl.innerHTML = `<p class="no-results">見つかりませんでした(持っていない可能性があります)</p>`;
    return;
  }
  resultsEl.innerHTML = items.map(b => `
    <div class="text-result-item">
      <p class="r-title">${escapeHtml(b.title)}</p>
      <p class="r-meta">${escapeHtml(b.circle_name || b.author || "")}</p>
    </div>
  `).join("");
  addHistory(q, { found: true, title: `${items.length}件ヒット: ${items[0].title}` });
}
