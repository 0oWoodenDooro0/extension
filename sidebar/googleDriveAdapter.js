// googleDriveAdapter.js - Google Drive REST API v3 專用適配模組 (Deep Module)
// 封裝 OAuth2 授權、自動靜默續期、應用程式隱藏資料夾 (appDataFolder) 檔案讀取、上傳、元資料查詢與刪除

const GDRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GDRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
export const GDRIVE_APP_DATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const DEFAULT_SYNC_FILENAME = 'collection_data.json';

/**
 * 記憶體/模擬 Google Drive 適配器 (適用於測試環境與無瀏覽器環境)
 */
export class MemoryGoogleDriveAdapter {
  constructor(initialFiles = {}) {
    this.clientId = '';
    this.token = null;
    this.userInfo = null;
    this.autoConnect = false;
    this.tokenExpired = false;
    this.silentAuthShouldFail = false;
    this.interactiveAuthShouldFail = false;
    this.authCalls = [];
    // Map of filename -> { id, name, content, modifiedTime, parents }
    this.files = new Map();
    for (const [name, content] of Object.entries(initialFiles)) {
      const id = `mem-file-${Math.random().toString(36).slice(2, 8)}`;
      this.files.set(name, {
        id,
        name,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        modifiedTime: new Date().toISOString(),
        parents: ['appDataFolder']
      });
    }
  }

  setClientId(clientId) {
    this.clientId = (clientId || '').trim();
  }

  getClientId() {
    return this.clientId || '';
  }

  getRedirectUri() {
    return 'https://mock.chromiumapp.org/';
  }

  async loadConfig() {
    return {
      clientId: this.clientId || '',
      isAuthenticated: await this.isAuthenticated(),
      autoConnect: this.autoConnect,
      user: this.userInfo
    };
  }

  async saveConfig(clientId) {
    this.setClientId(clientId);
  }

  setMockAuth({ token = 'mock_token_123', email = 'test@example.com', autoConnect = true } = {}) {
    this.token = token;
    this.userInfo = { email };
    this.autoConnect = autoConnect;
    this.tokenExpired = false;
  }

  expireToken() {
    this.token = null;
    this.tokenExpired = true;
  }

  async canAutoConnect() {
    return Boolean(this.autoConnect || this.token);
  }

  async isAuthenticated() {
    return !!this.token && !this.tokenExpired;
  }

  async authorize(interactive = true) {
    this.authCalls.push({ interactive });
    if (!interactive && this.silentAuthShouldFail) {
      throw new Error('Silent authentication failed (interaction_required)');
    }
    if (interactive && this.interactiveAuthShouldFail) {
      throw new Error('Interactive authentication was cancelled or failed');
    }
    this.token = interactive ? 'mock_interactive_token' : 'mock_silent_token';
    this.tokenExpired = false;
    this.autoConnect = true;
    if (!this.userInfo) {
      this.userInfo = { email: 'test@example.com' };
    }
    return { token: this.token, user: this.userInfo };
  }

  async ensureAuthenticated({ allowInteractiveFallback = true } = {}) {
    if (this.token && !this.tokenExpired) {
      return true;
    }
    if (!this.autoConnect) {
      return false;
    }
    try {
      await this.authorize(false);
      return true;
    } catch {
      if (allowInteractiveFallback) {
        try {
          await this.authorize(true);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  async getUserInfo() {
    if (!this.token) throw new Error('Not authenticated');
    return this.userInfo || { email: 'user@example.com' };
  }

  async disconnect() {
    this.token = null;
    this.userInfo = null;
    this.autoConnect = false;
    this.tokenExpired = false;
  }

  async _ensureTokenOrThrow(allowInteractiveFallback = true) {
    if (!this.token || this.tokenExpired) {
      const ok = await this.ensureAuthenticated({ allowInteractiveFallback });
      if (!ok || !this.token) {
        throw new Error('Not authenticated');
      }
    }
  }

  async findFile(filename = DEFAULT_SYNC_FILENAME) {
    await this._ensureTokenOrThrow();
    const file = this.files.get(filename);
    if (!file) return null;
    return {
      id: file.id,
      name: file.name,
      modifiedTime: file.modifiedTime
    };
  }

  async downloadJson(fileId) {
    await this._ensureTokenOrThrow();
    for (const file of this.files.values()) {
      if (file.id === fileId) {
        return JSON.parse(file.content);
      }
    }
    throw new Error(`File not found: ${fileId}`);
  }

  async uploadJson(data, filename = DEFAULT_SYNC_FILENAME) {
    await this._ensureTokenOrThrow();
    const jsonString = JSON.stringify(data, null, 2);
    const existing = this.files.get(filename);
    const now = new Date().toISOString();

    if (existing) {
      existing.content = jsonString;
      existing.modifiedTime = now;
      return { id: existing.id, name: existing.name, modifiedTime: now };
    } else {
      const id = `mem-file-${Date.now()}`;
      const newFile = { id, name: filename, content: jsonString, modifiedTime: now, parents: ['appDataFolder'] };
      this.files.set(filename, newFile);
      return { id, name: filename, modifiedTime: now };
    }
  }
}

/**
 * 真實環境 Google Drive 適配器 (使用標準 fetch + chrome.identity.launchWebAuthFlow)
 */
export class GoogleDriveAdapter {
  /**
   * @param {Object} options
   * @param {string} [options.clientId] - Google OAuth2 Client ID
   * @param {Object} [options.storage] - Storage adapter for caching auth tokens
   * @param {Object} [options.identity] - Chrome identity seam
   * @param {Object} [options.identityImpl] - Alias for Chrome identity seam
   * @param {Function} [options.fetchImpl] - Injected fetch seam for Node.js / testing
   */
  constructor({ clientId = '', storage = null, identity = null, identityImpl = null, fetchImpl = null } = {}) {
    this.clientId = clientId;
    this.storage = storage;
    this.identity = identity || identityImpl || (typeof chrome !== 'undefined' ? chrome.identity : null);
    this.fetchImpl = fetchImpl;
    this.cachedToken = null;
    this.cachedUser = null;
    this.autoConnect = false;
    this.tokenExpiry = null;
    this._authPromise = null;

    if (this.storage && typeof this.storage.onChanged === 'function') {
      this.unsubscribeStorage = this.storage.onChanged((changes) => {
        if (changes.gdrive_client_id !== undefined) {
          this.clientId = changes.gdrive_client_id.newValue || '';
        }
        if (changes.gdrive_token !== undefined) {
          this.cachedToken = changes.gdrive_token.newValue || null;
        }
        if (changes.gdrive_user !== undefined) {
          this.cachedUser = changes.gdrive_user.newValue || null;
        }
        if (changes.gdrive_auto_connect !== undefined) {
          this.autoConnect = !!changes.gdrive_auto_connect.newValue;
        }
        if (changes.gdrive_token_expiry !== undefined) {
          this.tokenExpiry = changes.gdrive_token_expiry.newValue || null;
        }
      });
    }
  }

  async _fetch(url, options = {}) {
    const fetchFn = this.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) {
      throw new Error('fetch implementation is not available.');
    }
    return fetchFn(url, options);
  }

  setClientId(clientId) {
    this.clientId = (clientId || '').trim();
  }

  getClientId() {
    return this.clientId;
  }

  /**
   * 載入儲存的 Token、ClientId 與自動登入設定
   */
  async loadConfig() {
    if (this.storage) {
      const data = await this.storage.get([
        'gdrive_client_id',
        'gdrive_token',
        'gdrive_user',
        'gdrive_auto_connect',
        'gdrive_token_expiry'
      ]);
      if (data.gdrive_client_id !== undefined) this.clientId = data.gdrive_client_id || '';
      if (data.gdrive_token !== undefined) this.cachedToken = data.gdrive_token || null;
      if (data.gdrive_user !== undefined) this.cachedUser = data.gdrive_user || null;
      if (data.gdrive_token_expiry !== undefined) this.tokenExpiry = data.gdrive_token_expiry || null;
      if (data.gdrive_auto_connect !== undefined) {
        this.autoConnect = !!data.gdrive_auto_connect;
      } else if (data.gdrive_token || data.gdrive_user) {
        this.autoConnect = true;
      }
    }
    return {
      clientId: this.clientId,
      isAuthenticated: !!this.cachedToken && !this.isTokenExpired(),
      autoConnect: this.autoConnect,
      user: this.cachedUser
    };
  }

  async saveConfig(clientId) {
    this.setClientId(clientId);
    if (this.storage) {
      await this.storage.set({ gdrive_client_id: this.clientId });
    }
  }

  /**
   * 檢查 Token 是否已過期
   */
  isTokenExpired() {
    if (!this.tokenExpiry) return false;
    return Date.now() >= Number(this.tokenExpiry);
  }

  /**
   * 檢查是否具備自動登入條件 (已設定 Client ID 且曾授權連結過)
   */
  async canAutoConnect() {
    await this.loadConfig();
    return Boolean(this.clientId && (this.autoConnect || this.cachedToken));
  }

  /**
   * 取得 Redirect URL (Chrome & Firefox 統一由 identity.getRedirectURL 提供)
   */
  getRedirectUri() {
    if (this.identity && typeof this.identity.getRedirectURL === 'function') {
      return this.identity.getRedirectURL();
    }
    return '';
  }

  /**
   * 檢查當前是否已具備授權狀態
   */
  async isAuthenticated() {
    if (!this.cachedToken) {
      await this.loadConfig();
    }
    return !!this.cachedToken && !this.isTokenExpired();
  }

  /**
   * 執行 OAuth 登入流程 (Implicit Flow 免後端模式)
   * interactive = true 時彈出帳號選擇視窗；interactive = false 時使用 prompt=none 背景靜默續期
   */
  async authorize(interactive = true) {
    if (!this.clientId) {
      await this.loadConfig();
    }
    if (!this.clientId) {
      throw new Error('Google OAuth Client ID is required.');
    }
    if (!this.identity || typeof this.identity.launchWebAuthFlow !== 'function') {
      throw new Error('chrome.identity.launchWebAuthFlow is not available.');
    }

    const redirectUri = this.getRedirectUri();
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', this.clientId);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', `${GDRIVE_APP_DATA_SCOPE} https://www.googleapis.com/auth/userinfo.email`);

    if (interactive) {
      authUrl.searchParams.set('prompt', 'select_account');
    } else {
      authUrl.searchParams.set('prompt', 'none');
      if (this.cachedUser && this.cachedUser.email && this.cachedUser.email !== 'Connected') {
        authUrl.searchParams.set('login_hint', this.cachedUser.email);
      }
    }

    return new Promise((resolve, reject) => {
      this.identity.launchWebAuthFlow(
        {
          url: authUrl.toString(),
          interactive
        },
        async (responseUrl) => {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!responseUrl) {
            return reject(new Error('Authentication was cancelled or failed.'));
          }

          try {
            // 解析回傳 URL hash: #access_token=...&expires_in=...
            const urlObj = new URL(responseUrl);
            const params = new URLSearchParams(urlObj.hash.startsWith('#') ? urlObj.hash.slice(1) : urlObj.hash);
            const token = params.get('access_token');
            const expiresIn = params.get('expires_in');
            const error = params.get('error');

            if (error) {
              return reject(new Error(`OAuth Error: ${error}`));
            }
            if (!token) {
              return reject(new Error('No access_token found in auth response.'));
            }

            this.cachedToken = token;
            this.autoConnect = true;
            this.tokenExpiry = expiresIn
              ? Date.now() + Math.max(0, Number(expiresIn) - 60) * 1000
              : null;

            // 取得使用者資訊
            const user = await this.fetchUserInfo(token);
            if (user && user.email === 'Connected' && this.cachedUser && this.cachedUser.email) {
              // 保留既有 email
            } else {
              this.cachedUser = user;
            }

            if (this.storage) {
              await this.storage.set({
                gdrive_token: token,
                gdrive_user: this.cachedUser,
                gdrive_auto_connect: true,
                gdrive_token_expiry: this.tokenExpiry
              });
            }

            resolve({ token, user: this.cachedUser });
          } catch (err) {
            reject(err);
          }
        }
      );
    });
  }

  /**
   * 確保目前已具備有效授權：
   * 1. 若有未過期 Token 直接返回 true
   * 2. 若已綁定過帳號 (autoConnect) 先嘗試背景靜默續期 (interactive: false)
   * 3. 若靜默續期失敗且 allowInteractiveFallback 為 true，則自動彈出登入視窗 (interactive: true)
   */
  async ensureAuthenticated({ allowInteractiveFallback = true } = {}) {
    await this.loadConfig();

    if (this.cachedToken && !this.isTokenExpired()) {
      return true;
    }

    if (!this.clientId || (!this.autoConnect && !this.cachedToken)) {
      return false;
    }

    if (this._authPromise) {
      return this._authPromise;
    }

    this._authPromise = (async () => {
      try {
        await this.authorize(false);
        return true;
      } catch (silentErr) {
        if (allowInteractiveFallback) {
          try {
            await this.authorize(true);
            return true;
          } catch (interactiveErr) {
            return false;
          }
        }
        return false;
      } finally {
        this._authPromise = null;
      }
    })();

    return this._authPromise;
  }

  async fetchUserInfo(token) {
    try {
      const res = await this._fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const info = await res.json();
        return { email: info.email, id: info.id };
      }
    } catch {
      // 容錯，若無法取得則回傳預設物件
    }
    return { email: 'Connected' };
  }

  async getUserInfo() {
    if (!this.cachedUser) {
      await this.loadConfig();
    }
    return this.cachedUser;
  }

  async _clearExpiredToken() {
    this.cachedToken = null;
    this.tokenExpiry = null;
    if (this.storage) {
      await this.storage.set({
        gdrive_token: null,
        gdrive_token_expiry: null
      });
    }
  }

  /**
   * 登出與斷開連線 (主動登出時會關閉 autoConnect)
   */
  async disconnect() {
    this.cachedToken = null;
    this.cachedUser = null;
    this.autoConnect = false;
    this.tokenExpiry = null;
    if (this.storage) {
      await this.storage.set({
        gdrive_token: null,
        gdrive_user: null,
        gdrive_auto_connect: false,
        gdrive_token_expiry: null
      });
    }
  }

  /**
   * 封裝具備 401 自動重新驗證與重試的 Fetch
   */
  async _fetchWithAuth(url, options = {}, { allowInteractiveFallback = true } = {}) {
    if (!this.cachedToken || this.isTokenExpired()) {
      await this.ensureAuthenticated({ allowInteractiveFallback });
    }
    if (!this.cachedToken) {
      throw new Error('Not authenticated with Google Drive.');
    }

    if (!this.clientId) {
      await this.loadConfig();
    }

    const executeRequest = () =>
      this._fetch(url, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${this.cachedToken}`
        }
      });

    let res = await executeRequest();

    if (res.status === 401) {
      await this._clearExpiredToken();
      if (this.clientId && this.autoConnect) {
        const refreshed = await this.ensureAuthenticated({ allowInteractiveFallback });
        if (refreshed && this.cachedToken) {
          res = await executeRequest();
        }
      }
    }

    if (res.status === 401) {
      await this._clearExpiredToken();
      throw new Error('Google Drive authorization expired. Please log in again.');
    }

    return res;
  }

  /**
   * 在 Google Drive 的 appDataFolder 搜尋指定檔案
   * @param {string} filename 
   * @returns {Promise<{ id: string, name: string, modifiedTime: string }|null>}
   */
  async findFile(filename = DEFAULT_SYNC_FILENAME) {
    const q = `name = '${filename}' and 'appDataFolder' in parents and trashed = false`;
    const url = `${GDRIVE_API_BASE}/files?spaces=appDataFolder&q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)`;

    const res = await this._fetchWithAuth(url);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Drive API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    if (data.files && data.files.length > 0) {
      return data.files[0];
    }
    return null;
  }

  /**
   * 下載 appDataFolder 檔案 JSON 內容
   * @param {string} fileId 
   * @returns {Promise<any>}
   */
  async downloadJson(fileId) {
    const url = `${GDRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await this._fetchWithAuth(url);

    if (!res.ok) {
      throw new Error(`Failed to download file from Google Drive (${res.status})`);
    }

    return await res.json();
  }

  /**
   * 上傳或更新 JSON 資料至 appDataFolder
   * @param {Object} data 
   * @param {string} [filename] 
   * @returns {Promise<{ id: string, name: string, modifiedTime: string }>}
   */
  async uploadJson(data, filename = DEFAULT_SYNC_FILENAME) {
    const existingFile = await this.findFile(filename);
    const jsonContent = JSON.stringify(data, null, 2);

    if (existingFile && existingFile.id) {
      // 檔案已存在：使用 PATCH /upload/drive/v3/files/{fileId}?uploadType=media 更新內容
      const updateUrl = `${GDRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existingFile.id)}?uploadType=media&fields=id,name,modifiedTime`;
      const res = await this._fetchWithAuth(updateUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: jsonContent
      });

      if (!res.ok) {
        throw new Error(`Failed to update cloud file: ${res.statusText}`);
      }

      return await res.json();
    } else {
      // 檔案不存在：建立新檔案至 appDataFolder (Multipart Upload)
      const metadata = {
        name: filename,
        parents: ['appDataFolder']
      };

      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelim = `\r\n--${boundary}--`;

      const multipartBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        jsonContent +
        closeDelim;

      const uploadUrl = `${GDRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,modifiedTime`;
      const res = await this._fetchWithAuth(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Failed to create file on Google Drive: ${errText}`);
      }

      return await res.json();
    }
  }
}
