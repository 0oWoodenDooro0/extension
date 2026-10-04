// googleDriveAdapter.js - Google Drive REST API v3 專用適配模組 (Deep Module)
// 封裝 OAuth2 授權、應用程式隱藏資料夾 (appDataFolder) 檔案讀取、上傳、元資料查詢與刪除

const GDRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GDRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
export const GDRIVE_APP_DATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const DEFAULT_SYNC_FILENAME = 'collection_data.json';

/**
 * 記憶體/模擬 Google Drive 適配器 (適用於測試環境與無瀏覽器環境)
 */
export class MemoryGoogleDriveAdapter {
  constructor(initialFiles = {}) {
    this.token = null;
    this.userInfo = null;
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

  setMockAuth({ token = 'mock_token_123', email = 'test@example.com' } = {}) {
    this.token = token;
    this.userInfo = { email };
  }

  async isAuthenticated() {
    return !!this.token;
  }

  async getUserInfo() {
    if (!this.token) throw new Error('Not authenticated');
    return this.userInfo || { email: 'user@example.com' };
  }

  async disconnect() {
    this.token = null;
    this.userInfo = null;
  }

  async findFile(filename = DEFAULT_SYNC_FILENAME) {
    if (!this.token) throw new Error('Not authenticated');
    const file = this.files.get(filename);
    if (!file) return null;
    return {
      id: file.id,
      name: file.name,
      modifiedTime: file.modifiedTime
    };
  }

  async downloadJson(fileId) {
    if (!this.token) throw new Error('Not authenticated');
    for (const file of this.files.values()) {
      if (file.id === fileId) {
        return JSON.parse(file.content);
      }
    }
    throw new Error(`File not found: ${fileId}`);
  }

  async uploadJson(data, filename = DEFAULT_SYNC_FILENAME) {
    if (!this.token) throw new Error('Not authenticated');
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
 * 真實環境 Google Drive 適配器 (使用標準 fetch + chrome.identity.launchWebAuthFlow / PKCE)
 */
export class GoogleDriveAdapter {
  /**
   * @param {Object} options
   * @param {string} [options.clientId] - Google OAuth2 Client ID
   * @param {Object} [options.storage] - Storage adapter for caching auth tokens
   * @param {Object} [options.identity] - Chrome identity seam
   */
  constructor({ clientId = '', storage = null, identity = null } = {}) {
    this.clientId = clientId;
    this.storage = storage;
    this.identity = identity || (typeof chrome !== 'undefined' ? chrome.identity : null);
    this.cachedToken = null;
    this.cachedUser = null;
  }

  setClientId(clientId) {
    this.clientId = (clientId || '').trim();
  }

  getClientId() {
    return this.clientId;
  }

  /**
   * 載入儲存的 Token 與 ClientId
   */
  async loadConfig() {
    if (this.storage) {
      const data = await this.storage.get(['gdrive_client_id', 'gdrive_token', 'gdrive_user']);
      if (data.gdrive_client_id) this.clientId = data.gdrive_client_id;
      if (data.gdrive_token) this.cachedToken = data.gdrive_token;
      if (data.gdrive_user) this.cachedUser = data.gdrive_user;
    }
    return {
      clientId: this.clientId,
      isAuthenticated: !!this.cachedToken,
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
   * 取得 Redirect URL (Chrome & Firefox 統一由 identity.getRedirectURL 提供)
   */
  getRedirectUri() {
    if (this.identity && typeof this.identity.getRedirectURL === 'function') {
      return this.identity.getRedirectURL();
    }
    return '';
  }

  /**
   * 檢查當前是否已具有授權狀態
   */
  async isAuthenticated() {
    if (!this.cachedToken) {
      await this.loadConfig();
    }
    return !!this.cachedToken;
  }

  /**
   * 執行 OAuth 登入流程 (Implicit Flow 快速免後端模式)
   * 彈出 Google 帳號授權視窗，支援在任意設備登入 Google 帳號
   */
  async authorize(interactive = true) {
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
    authUrl.searchParams.set('prompt', 'select_account');

    return new Promise((resolve, reject) => {
      this.identity.launchWebAuthFlow(
        {
          url: authUrl.toString(),
          interactive
        },
        async (responseUrl) => {
          if (chrome.runtime && chrome.runtime.lastError) {
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
            const error = params.get('error');

            if (error) {
              return reject(new Error(`OAuth Error: ${error}`));
            }
            if (!token) {
              return reject(new Error('No access_token found in auth response.'));
            }

            this.cachedToken = token;

            // 取得使用者資訊
            const user = await this.fetchUserInfo(token);
            this.cachedUser = user;

            if (this.storage) {
              await this.storage.set({
                gdrive_token: token,
                gdrive_user: user
              });
            }

            resolve({ token, user });
          } catch (err) {
            reject(err);
          }
        }
      );
    });
  }

  async fetchUserInfo(token) {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const info = await res.json();
        return { email: info.email, id: info.id };
      }
    } catch {
      // 容錯，若無法取得則回傳空物件
    }
    return { email: 'Connected' };
  }

  async getUserInfo() {
    if (!this.cachedUser) {
      await this.loadConfig();
    }
    return this.cachedUser;
  }

  /**
   * 登出與斷開連線
   */
  async disconnect() {
    this.cachedToken = null;
    this.cachedUser = null;
    if (this.storage) {
      await this.storage.set({
        gdrive_token: null,
        gdrive_user: null
      });
    }
  }

  /**
   * 在 Google Drive 的 appDataFolder 搜尋指定檔案
   * @param {string} filename 
   * @returns {Promise<{ id: string, name: string, modifiedTime: string }|null>}
   */
  async findFile(filename = DEFAULT_SYNC_FILENAME) {
    if (!this.cachedToken) await this.loadConfig();
    if (!this.cachedToken) throw new Error('Not authenticated with Google Drive.');

    const q = `name = '${filename}' and 'appDataFolder' in parents and trashed = false`;
    const url = `${GDRIVE_API_BASE}/files?spaces=appDataFolder&q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.cachedToken}`
      }
    });

    if (res.status === 401) {
      // Token 過期
      await this.disconnect();
      throw new Error('Google Drive authorization expired. Please log in again.');
    }

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
    if (!this.cachedToken) await this.loadConfig();
    if (!this.cachedToken) throw new Error('Not authenticated with Google Drive.');

    const url = `${GDRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.cachedToken}`
      }
    });

    if (res.status === 401) {
      await this.disconnect();
      throw new Error('Google Drive authorization expired. Please log in again.');
    }

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
    if (!this.cachedToken) await this.loadConfig();
    if (!this.cachedToken) throw new Error('Not authenticated with Google Drive.');

    const existingFile = await this.findFile(filename);
    const jsonContent = JSON.stringify(data, null, 2);

    if (existingFile && existingFile.id) {
      // 檔案已存在：使用 PATCH /upload/drive/v3/files/{fileId}?uploadType=media 更新內容
      const updateUrl = `${GDRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existingFile.id)}?uploadType=media&fields=id,name,modifiedTime`;
      const res = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.cachedToken}`,
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
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cachedToken}`,
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
