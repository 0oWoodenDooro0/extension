// cloudSyncView.js - 雲端同步介面管理模組 (Google Drive Cloud Sync UI View)
// 封裝 Google Drive 帳號授權、立即同步、自訂 Client ID 與狀態更新

import { SYNC_STATUS } from './syncCoordinator.js';

export function initCloudSyncView({
  googleDriveAdapter,
  syncCoordinator,
  onSyncComplete,
  onClose
}) {
  const syncModal = document.getElementById('cloudSyncModal');
  const syncBtn = document.getElementById('cloudSyncButton');
  const closeBtn = document.getElementById('closeCloudSyncModalButton');
  const authSection = document.getElementById('cloudAuthSection');
  const connectedSection = document.getElementById('cloudConnectedSection');
  const userEmailSpan = document.getElementById('cloudUserEmail');
  const syncStatusText = document.getElementById('cloudSyncStatusText');
  const clientIdInput = document.getElementById('cloudClientIdInput');
  const redirectUriText = document.getElementById('cloudRedirectUriText');
  const copyRedirectUriBtn = document.getElementById('copyRedirectUriButton');
  const saveClientIdBtn = document.getElementById('saveClientIdButton');
  const connectBtn = document.getElementById('connectGoogleDriveButton');
  const disconnectBtn = document.getElementById('disconnectGoogleDriveButton');
  const syncNowBtn = document.getElementById('syncNowButton');
  const pullNowBtn = document.getElementById('pullNowButton');
  const pushNowBtn = document.getElementById('pushNowButton');

  // 開啟 Modal
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      await updateUI();
      if (syncModal) syncModal.style.display = 'flex';
    });
  }

  // 關閉 Modal
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (syncModal) syncModal.style.display = 'none';
      if (typeof onClose === 'function') onClose();
    });
  }

  // 點擊背景遮罩關閉
  if (syncModal) {
    syncModal.addEventListener('click', (e) => {
      if (e.target === syncModal) {
        syncModal.style.display = 'none';
        if (typeof onClose === 'function') onClose();
      }
    });
  }

  // 複製 Redirect URI
  if (copyRedirectUriBtn && redirectUriText) {
    copyRedirectUriBtn.addEventListener('click', async () => {
      const text = redirectUriText.textContent.trim();
      if (text && text !== '-') {
        try {
          await navigator.clipboard.writeText(text);
          const origText = copyRedirectUriBtn.textContent;
          copyRedirectUriBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyRedirectUriBtn.textContent = origText;
          }, 1500);
        } catch {
          // fallback
          alert(`Redirect URI: ${text}`);
        }
      }
    });
  }

  // 監聽狀態改變
  syncCoordinator.onStatusChange(({ status, detail, lastSyncTime }) => {
    renderStatusBadge(status, detail, lastSyncTime);
  });

  // 儲存自訂 Client ID
  if (saveClientIdBtn && clientIdInput) {
    saveClientIdBtn.addEventListener('click', async () => {
      const val = clientIdInput.value.trim();
      await googleDriveAdapter.saveConfig(val);
      alert('Google OAuth Client ID saved.');
    });
  }

  // 點擊登入 Google
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      try {
        connectBtn.disabled = true;
        connectBtn.textContent = 'Connecting...';
        await googleDriveAdapter.authorize(true);
        await updateUI();
        // 登入後自動執行第一次同步
        await syncCoordinator.sync();
        if (typeof onSyncComplete === 'function') onSyncComplete();
      } catch (err) {
        alert(`Google Login failed: ${err.message}`);
      } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect Google Drive';
      }
    });
  }

  // 登出
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      if (confirm('Disconnect from Google Drive on this device?')) {
        await googleDriveAdapter.disconnect();
        await updateUI();
      }
    });
  }

  // 立即雙向/三向智慧同步
  if (syncNowBtn) {
    syncNowBtn.addEventListener('click', async () => {
      try {
        syncNowBtn.disabled = true;
        syncNowBtn.textContent = 'Syncing...';
        const res = await syncCoordinator.sync();
        if (res.success) {
          if (typeof onSyncComplete === 'function') onSyncComplete();
        } else {
          alert(`Sync error: ${res.error}`);
        }
      } finally {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync Now (Smart Merge)';
      }
    });
  }

  // 下載覆蓋本地 (Pull)
  if (pullNowBtn) {
    pullNowBtn.addEventListener('click', async () => {
      if (confirm('Overwrite all local collections and shortcuts with cloud data?')) {
        try {
          pullNowBtn.disabled = true;
          const res = await syncCoordinator.pullFromCloud();
          if (res.success) {
            if (typeof onSyncComplete === 'function') onSyncComplete();
            alert('Local data updated successfully from cloud.');
          } else {
            alert(`Pull failed: ${res.error}`);
          }
        } finally {
          pullNowBtn.disabled = false;
        }
      }
    });
  }

  // 上傳覆蓋雲端 (Push)
  if (pushNowBtn) {
    pushNowBtn.addEventListener('click', async () => {
      if (confirm('Overwrite cloud backup with your current local data?')) {
        try {
          pushNowBtn.disabled = true;
          const res = await syncCoordinator.pushToCloud();
          if (res.success) {
            alert('Cloud backup successfully overwritten with local data.');
          } else {
            alert('Push failed.');
          }
        } finally {
          pushNowBtn.disabled = false;
        }
      }
    });
  }

  async function updateUI() {
    const config = await googleDriveAdapter.loadConfig();
    if (clientIdInput) {
      clientIdInput.value = config.clientId || '';
    }

    if (redirectUriText) {
      redirectUriText.textContent = googleDriveAdapter.getRedirectUri() || '-';
    }

    const isAuth = await googleDriveAdapter.isAuthenticated();
    if (isAuth) {
      if (authSection) authSection.style.display = 'none';
      if (connectedSection) connectedSection.style.display = 'block';

      const user = await googleDriveAdapter.getUserInfo();
      if (userEmailSpan) {
        userEmailSpan.textContent = user?.email || 'Connected User';
      }
      renderStatusBadge(syncCoordinator.status, null, syncCoordinator.lastSyncTime);
    } else {
      if (authSection) authSection.style.display = 'block';
      if (connectedSection) connectedSection.style.display = 'none';
    }
  }

  function renderStatusBadge(status, detail, lastSyncTime) {
    if (!syncStatusText) return;
    let timeStr = 'Never';
    if (lastSyncTime) {
      timeStr = new Date(lastSyncTime).toLocaleTimeString();
    }

    if (status === SYNC_STATUS.SYNCING) {
      syncStatusText.innerHTML = `<span style="color: #2563eb;">● Syncing... (${detail || ''})</span>`;
    } else if (status === SYNC_STATUS.SUCCESS) {
      syncStatusText.innerHTML = `<span style="color: #16a34a;">● In sync (Last: ${timeStr})</span>`;
    } else if (status === SYNC_STATUS.ERROR) {
      syncStatusText.innerHTML = `<span style="color: #dc2626;">● Sync Error (${detail || 'Check network'})</span>`;
    } else {
      syncStatusText.innerHTML = `<span style="color: #64748b;">● Idle (Last: ${timeStr})</span>`;
    }
  }

  // 初始載入配置
  googleDriveAdapter.loadConfig().catch(() => {});
}
