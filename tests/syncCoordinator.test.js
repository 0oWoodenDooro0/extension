// tests/syncCoordinator.test.js - Unit tests for Google Drive & Sync Coordinator
import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryGoogleDriveAdapter, GoogleDriveAdapter, DEFAULT_SYNC_FILENAME } from '../sidebar/googleDriveAdapter.js';
import {
  SyncCoordinator,
  mergeUnifiedData,
  threeWayMergeUnifiedData,
  twoWayMergeUnifiedData,
  isUnifiedDataEqual,
  bindClientLifecycle,
  SYNC_STATUS
} from '../sidebar/syncCoordinator.js';
import { CollectionStore, MemoryStorageAdapter as CollectionMemoryAdapter } from '../sidebar/store.js';
import { SearchEngineStore, MemoryStorageAdapter as SearchMemoryAdapter } from '../searchEngineStore.js';

test('Google Drive Sync & Coordinator Test Suite', async (t) => {
  await t.test('mergeUnifiedData - Fallback 2-Way Merging when base is null', () => {
    const localData = {
      items: [
        { id: 'item-1', title: 'Local newer item', url: 'https://a.com', updatedAt: 200 },
        { id: 'item-2', title: 'Local only item', url: 'https://b.com', updatedAt: 100 }
      ],
      tags: ['Tech', 'Dev'],
      searchEngines: [
        { id: 'eng-1', title: 'Engine 1', urlTemplate: 'https://eng.com?q={query}', updatedAt: 100 }
      ]
    };

    const cloudData = {
      items: [
        { id: 'item-1', title: 'Cloud older item', url: 'https://a.com', updatedAt: 150 },
        { id: 'item-3', title: 'Cloud only item', url: 'https://c.com', updatedAt: 300 }
      ],
      tags: ['Tech', 'News'],
      searchEngines: [
        { id: 'eng-2', title: 'Engine 2', urlTemplate: 'https://eng2.com?q={query}', updatedAt: 200 }
      ]
    };

    const merged = mergeUnifiedData(localData, cloudData);

    // Items
    assert.equal(merged.items.length, 3);
    const item1 = merged.items.find(i => i.id === 'item-1');
    assert.equal(item1.title, 'Local newer item'); // Kept newer local
    const item3 = merged.items.find(i => i.id === 'item-3');
    assert.equal(item3.title, 'Cloud only item'); // Preserved cloud item

    // Tags
    assert.deepEqual(merged.tags.sort(), ['Dev', 'News', 'Tech']);

    // Search Engines
    assert.equal(merged.searchEngines.length, 2);
  });

  await t.test('threeWayMergeUnifiedData - Local deletion propagates and is NOT resurrected', () => {
    const baseData = {
      items: [
        { id: 'item-1', title: 'Item 1', url: 'https://1.com', updatedAt: 100 },
        { id: 'item-2', title: 'Item 2 to delete', url: 'https://2.com', updatedAt: 100 }
      ],
      tags: ['KeepTag', 'DeleteTag'],
      searchEngines: [
        { id: 'eng-1', title: 'Engine 1', urlTemplate: 'https://1.com?q={query}', updatedAt: 100 },
        { id: 'eng-2', title: 'Engine 2 to delete', urlTemplate: 'https://2.com?q={query}', updatedAt: 100 }
      ]
    };

    // Local deleted item-2, DeleteTag, and eng-2
    const localData = {
      items: [
        { id: 'item-1', title: 'Item 1', url: 'https://1.com', updatedAt: 100 }
      ],
      tags: ['KeepTag'],
      searchEngines: [
        { id: 'eng-1', title: 'Engine 1', urlTemplate: 'https://1.com?q={query}', updatedAt: 100 }
      ]
    };

    // Cloud still has baseData untouched
    const cloudData = JSON.parse(JSON.stringify(baseData));

    const merged = mergeUnifiedData(localData, cloudData, baseData);

    // item-2 should be cleanly deleted, NOT resurrected!
    assert.equal(merged.items.length, 1);
    assert.equal(merged.items[0].id, 'item-1');

    // DeleteTag should be removed
    assert.deepEqual(merged.tags, ['KeepTag']);

    // eng-2 should be removed
    assert.equal(merged.searchEngines.length, 1);
    assert.equal(merged.searchEngines[0].id, 'eng-1');
  });

  await t.test('threeWayMergeUnifiedData - Cloud deletion propagates to local', () => {
    const baseData = {
      items: [
        { id: 'item-1', title: 'Item 1', url: 'https://1.com', updatedAt: 100 },
        { id: 'item-2', title: 'Item 2 deleted on cloud', url: 'https://2.com', updatedAt: 100 }
      ],
      tags: ['TagA', 'TagB'],
      searchEngines: [
        { id: 'eng-1', title: 'Engine 1', urlTemplate: 'https://1.com?q={query}', updatedAt: 100 }
      ]
    };

    // Local untouched
    const localData = JSON.parse(JSON.stringify(baseData));

    // Cloud has item-2 and TagB deleted
    const cloudData = {
      items: [
        { id: 'item-1', title: 'Item 1', url: 'https://1.com', updatedAt: 100 }
      ],
      tags: ['TagA'],
      searchEngines: [
        { id: 'eng-1', title: 'Engine 1', urlTemplate: 'https://1.com?q={query}', updatedAt: 100 }
      ]
    };

    const merged = mergeUnifiedData(localData, cloudData, baseData);

    assert.equal(merged.items.length, 1);
    assert.equal(merged.items[0].id, 'item-1');
    assert.deepEqual(merged.tags, ['TagA']);
  });

  await t.test('threeWayMergeUnifiedData - Edit beats deletion conflict resolution', () => {
    const baseData = {
      items: [
        { id: 'item-1', title: 'Original Item 1', url: 'https://1.com', updatedAt: 100 },
        { id: 'item-2', title: 'Original Item 2', url: 'https://2.com', updatedAt: 100 }
      ],
      tags: ['Tag1'],
      searchEngines: []
    };

    // Scenario A: Local deleted item-1, but Cloud edited item-1 to updatedAt 200
    // Scenario B: Cloud deleted item-2, but Local edited item-2 to updatedAt 200
    const localData = {
      items: [
        { id: 'item-2', title: 'Local Edited Item 2', url: 'https://2.com', updatedAt: 200 }
      ],
      tags: ['Tag1'],
      searchEngines: []
    };

    const cloudData = {
      items: [
        { id: 'item-1', title: 'Cloud Edited Item 1', url: 'https://1.com', updatedAt: 200 }
      ],
      tags: ['Tag1'],
      searchEngines: []
    };

    const merged = threeWayMergeUnifiedData(localData, cloudData, baseData);

    assert.equal(merged.items.length, 2);
    const item1 = merged.items.find(i => i.id === 'item-1');
    const item2 = merged.items.find(i => i.id === 'item-2');

    assert.equal(item1.title, 'Cloud Edited Item 1'); // Cloud edit preserved despite local deletion
    assert.equal(item2.title, 'Local Edited Item 2'); // Local edit preserved despite cloud deletion
  });

  await t.test('MemoryGoogleDriveAdapter - upload and download operations', async () => {
    const gdrive = new MemoryGoogleDriveAdapter();
    assert.equal(await gdrive.isAuthenticated(), false);

    // Authenticate
    gdrive.setMockAuth({ token: 'mock-token', email: 'test@gmail.com' });
    assert.equal(await gdrive.isAuthenticated(), true);

    const userInfo = await gdrive.getUserInfo();
    assert.equal(userInfo.email, 'test@gmail.com');

    // Initially no file
    let file = await gdrive.findFile();
    assert.equal(file, null);

    // Upload
    const payload = { items: [{ id: '1' }], tags: ['a'], searchEngines: [] };
    const uploadRes = await gdrive.uploadJson(payload);
    assert.ok(uploadRes.id);

    // Find file again
    file = await gdrive.findFile();
    assert.ok(file);
    assert.equal(file.name, DEFAULT_SYNC_FILENAME);

    // Download file
    const downloaded = await gdrive.downloadJson(file.id);
    assert.deepEqual(downloaded, payload);
  });

  await t.test('SyncCoordinator - Initial upload when cloud is empty', async () => {
    const collAdapter = new CollectionMemoryAdapter({
      items: [{ id: 'item-1', title: 'First Item', url: 'https://test.com', addDate: 100 }],
      tags: ['Tag1']
    });
    const seAdapter = new SearchMemoryAdapter({ searchEngines: [] });

    const collectionStore = new CollectionStore(collAdapter);
    const searchEngineStore = new SearchEngineStore(seAdapter);
    await collectionStore.load();
    await searchEngineStore.load();

    const gdrive = new MemoryGoogleDriveAdapter();
    gdrive.setMockAuth({ token: 'mock-1', email: 'user@gmail.com' });

    const coordinator = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore,
      searchEngineStore
    });

    const res = await coordinator.sync();
    assert.equal(res.success, true);
    assert.equal(res.action, 'uploaded_initial');
    assert.equal(res.stats.itemsCount, 1);

    // Verify it is on cloud
    const cloudFile = await gdrive.findFile();
    assert.ok(cloudFile);
    const cloudContent = await gdrive.downloadJson(cloudFile.id);
    assert.equal(cloudContent.items.length, 1);
    assert.equal(cloudContent.items[0].title, 'First Item');

    // Verify base is saved
    assert.ok(coordinator.getBaseData());
    assert.equal(coordinator.getBaseData().items.length, 1);
  });

  await t.test('SyncCoordinator - Multi-device sync and deletion propagation', async () => {
    const gdrive = new MemoryGoogleDriveAdapter();
    gdrive.setMockAuth({ token: 'mock-shared' });

    // 1. Device A sets up 2 items and a tag, then syncs
    const collAdapterA = new CollectionMemoryAdapter({
      items: [
        { id: 'item-A', title: 'Item A', url: 'https://a.com', updatedAt: 100 },
        { id: 'item-B', title: 'Item B to be deleted', url: 'https://b.com', updatedAt: 100 }
      ],
      tags: ['TagA', 'TagB']
    });
    const collStoreA = new CollectionStore(collAdapterA);
    const seStoreA = new SearchEngineStore(new SearchMemoryAdapter());
    await collStoreA.load();
    await seStoreA.load();

    const coordA = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: collStoreA,
      searchEngineStore: seStoreA
    });
    const resA1 = await coordA.sync();
    assert.equal(resA1.success, true);

    // 2. Device B syncs initially (starts empty)
    const collAdapterB = new CollectionMemoryAdapter();
    const collStoreB = new CollectionStore(collAdapterB);
    const seStoreB = new SearchEngineStore(new SearchMemoryAdapter());
    await collStoreB.load();
    await seStoreB.load();

    const coordB = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: collStoreB,
      searchEngineStore: seStoreB
    });
    const resB1 = await coordB.sync();
    assert.equal(resB1.success, true);
    assert.equal(collStoreB.getItems().length, 2);
    assert.deepEqual(collStoreB.getTags().sort(), ['TagA', 'TagB']);

    // 3. User deletes 'Item B' and 'TagB' on Device A
    await collStoreA.deleteItem('item-B');
    await collStoreA.deleteTag('TagB');
    assert.equal(collStoreA.getItems().length, 1);

    // 4. Device A syncs -> Cloud should now have only Item A and TagA
    const resA2 = await coordA.sync();
    assert.equal(resA2.success, true);

    const cloudFile = await gdrive.findFile();
    const cloudData = await gdrive.downloadJson(cloudFile.id);
    assert.equal(cloudData.items.length, 1);
    assert.equal(cloudData.items[0].id, 'item-A');
    assert.deepEqual(cloudData.tags, ['TagA']);

    // 5. Device B syncs -> Device B should delete Item B and TagB (NO RESURRECTION!)
    const resB2 = await coordB.sync();
    assert.equal(resB2.success, true);
    assert.equal(collStoreB.getItems().length, 1);
    assert.equal(collStoreB.getItems()[0].id, 'item-A');
    assert.deepEqual(collStoreB.getTags(), ['TagA']);

    // 6. Device A syncs once more -> Still only Item A (Stable state)
    const resA3 = await coordA.sync();
    assert.equal(resA3.success, true);
    assert.equal(collStoreA.getItems().length, 1);
  });

  await t.test('SyncCoordinator - Handles unauthenticated state cleanly', async () => {
    const gdrive = new MemoryGoogleDriveAdapter(); // no mock auth
    const collStore = new CollectionStore(new CollectionMemoryAdapter());
    const seStore = new SearchEngineStore(new SearchMemoryAdapter());

    const coordinator = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: collStore,
      searchEngineStore: seStore
    });

    const res = await coordinator.sync();
    assert.equal(res.success, false);
    assert.match(res.error, /not authenticated/i);
    assert.equal(coordinator.status, SYNC_STATUS.ERROR);
  });

  await t.test('SyncCoordinator - pullFromCloud and pushToCloud update base snapshot', async () => {
    const gdrive = new MemoryGoogleDriveAdapter();
    gdrive.setMockAuth({ token: 'mock-token' });

    const collAdapter = new CollectionMemoryAdapter({
      items: [{ id: 'item-orig', title: 'Original', url: 'https://orig.com', addDate: 100 }],
      tags: ['OrigTag']
    });
    const collStore = new CollectionStore(collAdapter);
    const seStore = new SearchEngineStore(new SearchMemoryAdapter());
    await collStore.load();
    await seStore.load();

    const coordinator = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: collStore,
      searchEngineStore: seStore
    });

    // Push
    const pushRes = await coordinator.pushToCloud();
    assert.equal(pushRes.success, true);
    assert.equal(coordinator.getBaseData().items[0].id, 'item-orig');

    // Simulate cloud changing
    const file = await gdrive.findFile();
    await gdrive.uploadJson({
      items: [{ id: 'item-cloud', title: 'From Cloud', url: 'https://cloud.com', addDate: 200 }],
      tags: ['CloudTag'],
      searchEngines: []
    });

    // Pull
    const pullRes = await coordinator.pullFromCloud();
    assert.equal(pullRes.success, true);
    assert.equal(collStore.getItems()[0].id, 'item-cloud');
    assert.equal(coordinator.getBaseData().items[0].id, 'item-cloud');
  });

  await t.test('Auto-Login & Sync on Startup - Silent token renewal and fallback to interactive login', async () => {
    const gdrive = new MemoryGoogleDriveAdapter();
    const collStore = new CollectionStore(new CollectionMemoryAdapter());
    const seStore = new SearchEngineStore(new SearchMemoryAdapter());
    const storage = new CollectionMemoryAdapter();

    const coordinator = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: collStore,
      searchEngineStore: seStore,
      storage
    });
    await coordinator.init();

    // When auto-connect is not enabled, autoLoginAndSync should skip cleanly
    const skipRes = await coordinator.autoLoginAndSync({ allowInteractiveFallback: true });
    assert.equal(skipRes.skipped, true);

    // Enable auto-connect flag
    await storage.set({ gdrive_auto_connect: true });

    // Silent auth succeeds
    gdrive.setMockAuth({ token: 'silent-tok', email: 'silent@test.com' });
    const autoRes = await coordinator.autoLoginAndSync({ allowInteractiveFallback: false });
    assert.equal(autoRes.success, true);
    assert.equal(autoRes.action, 'uploaded_initial');
  });

  await t.test('Flush Pending Sync on Extension/Browser Close', async () => {
    const gdrive = new MemoryGoogleDriveAdapter();
    gdrive.setMockAuth({ token: 'mock-token' });

    const collStore = new CollectionStore(new CollectionMemoryAdapter());
    const seStore = new SearchEngineStore(new SearchMemoryAdapter());
    await collStore.load();
    await seStore.load();

    const coordinator = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: collStore,
      searchEngineStore: seStore
    });
    await coordinator.init();

    // Initial sync
    await coordinator.sync();

    // User adds a new item locally
    await collStore.saveItem({
      title: 'Saved Before Closing Browser',
      url: 'https://close-test.com',
      tags: ['AutoSave']
    });

    // Mark dirty (as done when storage changes)
    await coordinator.markDirty();
    assert.equal(coordinator.isDirty, true);

    // User closes the extension/browser -> flushPendingSync executes
    const flushRes = await coordinator.flushPendingSync();
    assert.equal(flushRes.success, true);
    assert.equal(coordinator.isDirty, false);

    // Verify the item was saved to Google Drive immediately on close
    const cloudFile = await gdrive.findFile();
    const cloudData = await gdrive.downloadJson(cloudFile.id);
    assert.equal(cloudData.items.length, 1);
    assert.equal(cloudData.items[0].title, 'Saved Before Closing Browser');

    // Calling flushPendingSync again when no changes occurred should skip cleanly
    const secondFlush = await coordinator.flushPendingSync();
    assert.equal(secondFlush.success, true);
    assert.equal(secondFlush.skipped, true);
  });

  await t.test('Option A: Multi-context safety - newly added items are never dropped by background flush', async () => {
    const gdrive = new MemoryGoogleDriveAdapter();
    gdrive.setMockAuth({ token: 'mock-token', email: 'user@gmail.com' });

    // Shared storage simulating chrome.storage.local
    const sharedStorage = new CollectionMemoryAdapter();
    await sharedStorage.set({ gdrive_auto_connect: true });

    // Initial item in cloud
    const initialBackup = {
      version: 1,
      items: [{ id: 'item-cloud-1', title: 'Existing Cloud Item', url: 'https://cloud-1.com', tags: ['work'], updatedAt: 1000 }],
      tags: ['work'],
      searchEngines: []
    };
    await gdrive.uploadJson(initialBackup);

    // Context 1: Background Service Worker Store & Coordinator
    const bgCollStore = new CollectionStore(sharedStorage);
    const bgSeStore = new SearchEngineStore(new SearchMemoryAdapter());
    const bgCoordinator = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: bgCollStore,
      searchEngineStore: bgSeStore,
      storage: sharedStorage
    });
    await bgCoordinator.init();

    // Context 2: Sidebar UI Store
    const uiCollStore = new CollectionStore(sharedStorage);
    const uiSeStore = new SearchEngineStore(new SearchMemoryAdapter());
    await uiCollStore.load();

    // Initial sync brings the cloud item into local storage
    await bgCoordinator.sync();
    await uiCollStore.load();
    assert.equal(uiCollStore.items.length, 1);
    assert.equal(uiCollStore.items[0].id, 'item-cloud-1');

    // Sidebar UI adds a brand new item (saved directly to shared storage)
    await uiCollStore.saveItem({
      id: 'item-local-new',
      title: 'Newly Added Local Item',
      url: 'https://local-new.com',
      tags: ['personal']
    });

    // Option A: Background marks dirty when storage changes, but does NOT run 3s debounce timer
    await bgCoordinator.markDirty();
    assert.equal(bgCoordinator.isDirty, true);
    assert.equal(bgCoordinator._autoSyncTimer, null); // No debounced timer running

    // Simulate stale in-memory cache in background
    bgCollStore.items = [];
    assert.equal(bgCollStore.items.length, 0);

    // User closes the extension -> Background flushPendingSync is called
    const flushResult = await bgCoordinator.flushPendingSync();
    assert.equal(flushResult.success, true);
    assert.equal(bgCoordinator.isDirty, false);

    // Verify: createUnifiedBackup loaded fresh data from storage, so the newly added item was NOT deleted!
    const finalCloudFile = await gdrive.findFile();
    const finalCloudData = await gdrive.downloadJson(finalCloudFile.id);

    const titles = finalCloudData.items.map(i => i.title);
    assert.ok(titles.includes('Existing Cloud Item'), 'Existing cloud item must remain');
    assert.ok(titles.includes('Newly Added Local Item'), 'Newly added local item must NOT be dropped');
    assert.equal(finalCloudData.items.length, 2);
  });

  // --- REAL GOOGLE DRIVE ADAPTER SUITE (TESTING DEEP SEAM) ---
  await t.test('GoogleDriveAdapter (Real implementation with injected seams)', async (sub) => {
    await sub.test('OAuth flow URL assembly and token extraction with storage persistence', async () => {
      let launchedUrl = null;
      let launchedInteractive = null;

      const mockIdentity = {
        getRedirectURL: () => 'https://extension-id.chromiumapp.org/',
        launchWebAuthFlow: ({ url, interactive }, callback) => {
          launchedUrl = url;
          launchedInteractive = interactive;
          callback('https://extension-id.chromiumapp.org/#access_token=real_test_token&expires_in=3600');
        }
      };

      const mockStorage = new CollectionMemoryAdapter();
      const mockFetch = async (url, options) => {
        if (url.includes('/userinfo')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ email: 'real-user@gmail.com', id: 'user-123' })
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      const adapter = new GoogleDriveAdapter({
        clientId: 'my-client-id.apps.googleusercontent.com',
        storage: mockStorage,
        identity: mockIdentity,
        fetchImpl: mockFetch
      });

      assert.equal(adapter.getClientId(), 'my-client-id.apps.googleusercontent.com');
      assert.equal(adapter.getRedirectUri(), 'https://extension-id.chromiumapp.org/');

      const authRes = await adapter.authorize(true);
      assert.equal(authRes.token, 'real_test_token');
      assert.equal(authRes.user.email, 'real-user@gmail.com');
      assert.equal(launchedInteractive, true);

      const parsedUrl = new URL(launchedUrl);
      assert.equal(parsedUrl.searchParams.get('client_id'), 'my-client-id.apps.googleusercontent.com');
      assert.equal(parsedUrl.searchParams.get('redirect_uri'), 'https://extension-id.chromiumapp.org/');
      assert.equal(parsedUrl.searchParams.get('prompt'), 'select_account');

      // Check persisted values in storage
      const stored = await mockStorage.get([
        'gdrive_token',
        'gdrive_user',
        'gdrive_auto_connect',
        'gdrive_token_expiry'
      ]);
      assert.equal(stored.gdrive_token, 'real_test_token');
      assert.equal(stored.gdrive_user.email, 'real-user@gmail.com');
      assert.equal(stored.gdrive_auto_connect, true);
      assert.ok(stored.gdrive_token_expiry > Date.now());

      // Check isAuthenticated and canAutoConnect
      assert.equal(await adapter.isAuthenticated(), true);
      assert.equal(await adapter.canAutoConnect(), true);
    });

    await sub.test('OAuth error handling: access_denied and cancellation', async () => {
      const mockIdentityError = {
        getRedirectURL: () => 'https://extension-id.chromiumapp.org/',
        launchWebAuthFlow: ({ url, interactive }, callback) => {
          callback('https://extension-id.chromiumapp.org/#error=access_denied');
        }
      };

      const adapter = new GoogleDriveAdapter({
        clientId: 'test-id',
        identity: mockIdentityError
      });

      await assert.rejects(
        () => adapter.authorize(true),
        /OAuth Error: access_denied/
      );

      const mockIdentityCancel = {
        getRedirectURL: () => 'https://extension-id.chromiumapp.org/',
        launchWebAuthFlow: ({ url, interactive }, callback) => {
          callback(null);
        }
      };

      const adapterCancel = new GoogleDriveAdapter({
        clientId: 'test-id',
        identity: mockIdentityCancel
      });

      await assert.rejects(
        () => adapterCancel.authorize(true),
        /cancelled or failed/
      );
    });

    await sub.test('401 retry and token expiration handling in _fetchWithAuth', async () => {
      let authCallCount = 0;
      let fetchCallCount = 0;

      const mockIdentity = {
        getRedirectURL: () => 'https://extension-id.chromiumapp.org/',
        launchWebAuthFlow: ({ url, interactive }, callback) => {
          authCallCount++;
          callback(`https://extension-id.chromiumapp.org/#access_token=token_v${authCallCount}&expires_in=3600`);
        }
      };

      const mockStorage = new CollectionMemoryAdapter();
      // Set expired token initially
      await mockStorage.set({
        gdrive_client_id: 'test-client-id',
        gdrive_token: 'stale_token',
        gdrive_auto_connect: true,
        gdrive_token_expiry: Date.now() - 1000 // expired
      });

      const mockFetch = async (url, options = {}) => {
        fetchCallCount++;
        const authHeader = options.headers?.Authorization;

        if (url.includes('/userinfo')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ email: 'refreshed@gmail.com' })
          };
        }

        // Check if token was stale
        if (authHeader === 'Bearer stale_token') {
          return { ok: false, status: 401, text: async () => 'Unauthorized' };
        }

        if (authHeader === 'Bearer token_v1') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [{ id: 'file-1', name: 'collection_data.json', modifiedTime: '2026-10-17T00:00:00Z' }] })
          };
        }

        return { ok: false, status: 500, text: async () => 'Internal Error' };
      };

      const adapter = new GoogleDriveAdapter({
        storage: mockStorage,
        identity: mockIdentity,
        fetchImpl: mockFetch
      });

      const file = await adapter.findFile();
      assert.ok(file);
      assert.equal(file.id, 'file-1');
      assert.equal(authCallCount, 1);
    });

    await sub.test('findFile, downloadJson, and uploadJson (both POST and PATCH)', async () => {
      let createdFiles = [];
      let updatedFiles = [];
      let existingFiles = [];

      const mockStorage = new CollectionMemoryAdapter();
      await mockStorage.set({
        gdrive_client_id: 'test-client-id',
        gdrive_token: 'valid_token',
        gdrive_auto_connect: true,
        gdrive_token_expiry: Date.now() + 100000
      });

      const mockFetch = async (url, options = {}) => {
        // findFile: GET /files?spaces=appDataFolder...
        if (url.includes('/files?spaces=appDataFolder')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: existingFiles })
          };
        }
        // downloadJson: GET /files/file-123?alt=media
        if (url.includes('/files/file-123?alt=media')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ items: [{ id: 'cloud-item-1' }], tags: ['cloud'], searchEngines: [] })
          };
        }
        // uploadJson (multipart POST when no existing file)
        if (options.method === 'POST' && url.includes('uploadType=multipart')) {
          const newFile = { id: 'file-created-999', name: 'collection_data.json', modifiedTime: '2026-10-17T12:00:00Z' };
          createdFiles.push({ url, body: options.body, headers: options.headers });
          existingFiles = [newFile];
          return {
            ok: true,
            status: 200,
            json: async () => newFile
          };
        }
        // uploadJson (PATCH media when file exists)
        if (options.method === 'PATCH' && url.includes('uploadType=media')) {
          const updated = { id: 'file-created-999', name: 'collection_data.json', modifiedTime: '2026-10-17T12:05:00Z' };
          updatedFiles.push({ url, body: options.body });
          return {
            ok: true,
            status: 200,
            json: async () => updated
          };
        }
        return { ok: false, status: 404, text: async () => 'Not found' };
      };

      const adapter = new GoogleDriveAdapter({
        storage: mockStorage,
        fetchImpl: mockFetch
      });

      // 1. Initial upload (POST multipart)
      const upload1 = await adapter.uploadJson({ items: [{ id: '1' }], tags: [], searchEngines: [] });
      assert.equal(upload1.id, 'file-created-999');
      assert.equal(createdFiles.length, 1);
      assert.ok(createdFiles[0].headers['Content-Type'].includes('multipart/related'));

      // 2. Download
      const downloaded = await adapter.downloadJson('file-123');
      assert.equal(downloaded.items[0].id, 'cloud-item-1');

      // 3. Second upload (PATCH media since file now exists)
      const upload2 = await adapter.uploadJson({ items: [{ id: '1' }, { id: '2' }], tags: [], searchEngines: [] });
      assert.equal(upload2.id, 'file-created-999');
      assert.equal(updatedFiles.length, 1);

      // 4. Disconnect resets storage and memory
      await adapter.disconnect();
      assert.equal(await adapter.isAuthenticated(), false);
      const storageAfterDisc = await mockStorage.get(['gdrive_token', 'gdrive_auto_connect']);
      assert.equal(storageAfterDisc.gdrive_token, null);
      assert.equal(storageAfterDisc.gdrive_auto_connect, false);
    });
  });

  // --- SYNC COORDINATOR DEEP SEAM & ACCOUNT INTERFACE SUITE ---
  await t.test('SyncCoordinator - Unified Account and Settings Management', async (sub) => {
    await sub.test('getAccountSummary, saveClientConfig, connectAccount, and disconnectAccount', async () => {
      const storage = new CollectionMemoryAdapter();
      const gdrive = new MemoryGoogleDriveAdapter();
      const collStore = new CollectionStore(storage);
      const seStore = new SearchEngineStore(new SearchMemoryAdapter());
      await collStore.load();
      await seStore.load();

      const coordinator = new SyncCoordinator({
        cloudAdapter: gdrive,
        collectionStore: collStore,
        searchEngineStore: seStore,
        storage
      });
      await coordinator.init();

      // 1. Initial account summary: not authenticated
      let summary = await coordinator.getAccountSummary();
      assert.equal(summary.isAuthenticated, false);
      assert.equal(summary.canAutoConnect, false);
      assert.equal(summary.status, SYNC_STATUS.IDLE);

      // 2. Save client config
      await coordinator.saveClientConfig('custom-client-id-123');
      const storedClientId = await storage.get(['gdrive_client_id']);
      assert.equal(storedClientId.gdrive_client_id, 'custom-client-id-123');

      // 3. Connect account (authorizes + performs first sync)
      collStore.items = [{ id: 'initial-item', title: 'Local Test', url: 'https://test.com', addDate: 100 }];
      const connectResult = await coordinator.connectAccount();
      assert.ok(connectResult.authResult);
      assert.equal(connectResult.syncResult.success, true);

      summary = await coordinator.getAccountSummary();
      assert.equal(summary.isAuthenticated, true);
      assert.equal(summary.status, SYNC_STATUS.SUCCESS);

      // 4. Disconnect account (clears auth, resets base and status)
      await coordinator.disconnectAccount();
      summary = await coordinator.getAccountSummary();
      assert.equal(summary.isAuthenticated, false);
      assert.equal(summary.status, SYNC_STATUS.IDLE);
      assert.equal(coordinator.getBaseData(), null);
    });
  });

  // --- DIRTY TRACKING ENCAPSULATION SUITE ---
  await t.test('SyncCoordinator.init({ mode: "background" }) - Encapsulates storage change listening & dirty tracking', async () => {
    const storage = new CollectionMemoryAdapter();
    const gdrive = new MemoryGoogleDriveAdapter();
    gdrive.setMockAuth({ token: 'mock-bg' });

    const collStore = new CollectionStore(storage);
    const seStore = new SearchEngineStore(new SearchMemoryAdapter());

    const bgCoordinator = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: collStore,
      searchEngineStore: seStore,
      storage
    });

    // Initialize in background mode: it binds storage.onChanged internally
    await bgCoordinator.init({ mode: 'background' });
    assert.equal(bgCoordinator.isDirty, false);

    // Trigger storage change with collection item
    await storage.set({ items: [{ id: 'item-1', title: 'Item 1', url: 'https://1.com' }] });
    assert.equal(bgCoordinator.isDirty, true);
    assert.equal(bgCoordinator._autoSyncTimer, null); // Background does not start 3s timer

    // Reset dirty flag
    await storage.set({ sync_dirty: false });
    assert.equal(bgCoordinator.isDirty, false);

    // Changes during remote sync (sync_in_progress) should NOT mark dirty
    await storage.set({ sync_in_progress: true, items: [{ id: 'item-2', title: 'Item 2', url: 'https://2.com' }] });
    assert.equal(bgCoordinator.isDirty, false);
  });

  // --- CLIENT LIFECYCLE HELPER SUITE ---
  await t.test('bindClientLifecycle - Connects lifecycle port and flushes sync on pagehide/visibilitychange', async () => {
    let connectedPortName = null;
    let sentMessages = [];
    let flushedCount = 0;

    const mockPort = {
      name: 'sidebar-lifecycle',
      onDisconnect: { addListener: () => {} }
    };

    const mockRuntime = {
      connect: ({ name }) => {
        connectedPortName = name;
        return mockPort;
      },
      sendMessage: (msg, cb) => {
        sentMessages.push(msg);
        if (typeof cb === 'function') cb();
      }
    };

    const pageListeners = {};
    const mockWindow = {
      addEventListener: (evt, fn) => { pageListeners[evt] = fn; },
      removeEventListener: (evt, fn) => { delete pageListeners[evt]; }
    };
    const docListeners = {};
    const mockDocument = {
      visibilityState: 'visible',
      addEventListener: (evt, fn) => { docListeners[evt] = fn; },
      removeEventListener: (evt, fn) => { delete docListeners[evt]; }
    };

    const mockCoordinator = {
      flushPendingSync: async () => { flushedCount++; return { success: true }; }
    };

    const unbind = bindClientLifecycle({
      portName: 'sidebar-lifecycle',
      coordinator: mockCoordinator,
      runtime: mockRuntime,
      windowObj: mockWindow,
      documentObj: mockDocument
    });

    assert.equal(connectedPortName, 'sidebar-lifecycle');
    assert.ok(pageListeners['pagehide']);
    assert.ok(docListeners['visibilitychange']);

    // Trigger pagehide
    pageListeners['pagehide']();
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].action, 'flushSync');

    // Trigger visibilitychange when hidden
    mockDocument.visibilityState = 'hidden';
    docListeners['visibilitychange']();
    assert.equal(sentMessages.length, 2);

    // Trigger visibilitychange when visible (should do nothing)
    mockDocument.visibilityState = 'visible';
    docListeners['visibilitychange']();
    assert.equal(sentMessages.length, 2);

    // Test fallback when sendMessage reports error
    mockRuntime.sendMessage = (msg, cb) => {
      mockRuntime.lastError = { message: 'Port closed' };
      cb();
    };
    pageListeners['pagehide']();
    assert.equal(flushedCount, 1);

    // Unbind cleans up listeners
    unbind();
    assert.equal(pageListeners['pagehide'], undefined);
    assert.equal(docListeners['visibilitychange'], undefined);
  });
});
