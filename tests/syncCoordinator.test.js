import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GoogleDriveAdapter,
  MemoryGoogleDriveAdapter,
  DEFAULT_SYNC_FILENAME
} from '../sidebar/googleDriveAdapter.js';
import {
  SyncCoordinator,
  mergeUnifiedData,
  threeWayMergeUnifiedData,
  SYNC_STATUS
} from '../sidebar/syncCoordinator.js';
import { CollectionStore, MemoryStorageAdapter as CollectionMemoryAdapter } from '../sidebar/store.js';
import { SearchEngineStore, MemoryStorageAdapter as SearchMemoryAdapter } from '../searchEngineStore.js';
import { initializeBackgroundSync } from '../background.js';

describe('Cloud Synchronization, 3-Way Merge & GoogleDriveAdapter', () => {
  describe('Unified Backup Merge Algorithms (ADR-0002)', () => {
    it('falls back to 2-Way Union Merge when Base Snapshot is null, keeping newer edits and unioning all Collection Items, Tags, and Search Engines', () => {
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

      const merged = mergeUnifiedData(localData, cloudData, null);

      assert.equal(merged.items.length, 3);
      assert.equal(merged.items.find(i => i.id === 'item-1').title, 'Local newer item');
      assert.equal(merged.items.find(i => i.id === 'item-3').title, 'Cloud only item');
      assert.deepEqual(merged.tags.sort(), ['Dev', 'News', 'Tech']);
      assert.equal(merged.searchEngines.length, 2);
    });

    it('propagates local deletions and cloud deletions without resurrecting deleted Collection Items, Tags, or Search Engines when Base Snapshot is present', () => {
      const baseData = {
        items: [
          { id: 'item-keep', title: 'Keep', url: 'https://keep.com', updatedAt: 100 },
          { id: 'item-del-local', title: 'Deleted Locally', url: 'https://del-local.com', updatedAt: 100 },
          { id: 'item-del-cloud', title: 'Deleted on Cloud', url: 'https://del-cloud.com', updatedAt: 100 }
        ],
        tags: ['KeepTag', 'DelLocalTag', 'DelCloudTag'],
        searchEngines: [
          { id: 'eng-keep', title: 'Engine Keep', urlTemplate: 'https://1.com?q={query}', updatedAt: 100 },
          { id: 'eng-del-local', title: 'Engine Del Local', urlTemplate: 'https://2.com?q={query}', updatedAt: 100 }
        ]
      };

      const localData = {
        items: [
          { id: 'item-keep', title: 'Keep', url: 'https://keep.com', updatedAt: 100 },
          { id: 'item-del-cloud', title: 'Deleted on Cloud', url: 'https://del-cloud.com', updatedAt: 100 }
        ],
        tags: ['KeepTag', 'DelCloudTag'],
        searchEngines: [
          { id: 'eng-keep', title: 'Engine Keep', urlTemplate: 'https://1.com?q={query}', updatedAt: 100 }
        ]
      };

      const cloudData = {
        items: [
          { id: 'item-keep', title: 'Keep', url: 'https://keep.com', updatedAt: 100 },
          { id: 'item-del-local', title: 'Deleted Locally', url: 'https://del-local.com', updatedAt: 100 }
        ],
        tags: ['KeepTag', 'DelLocalTag'],
        searchEngines: [
          { id: 'eng-keep', title: 'Engine Keep', urlTemplate: 'https://1.com?q={query}', updatedAt: 100 },
          { id: 'eng-del-local', title: 'Engine Del Local', urlTemplate: 'https://2.com?q={query}', updatedAt: 100 }
        ]
      };

      const merged = mergeUnifiedData(localData, cloudData, baseData);

      assert.deepEqual(merged.items.map(i => i.id), ['item-keep']);
      assert.deepEqual(merged.tags, ['KeepTag']);
      assert.deepEqual(merged.searchEngines.map(e => e.id), ['eng-keep']);
    });

    it('resolves edit-vs-delete conflicts in favor of the edited Collection Item (Edit Beats Deletion)', () => {
      const baseData = {
        items: [
          { id: 'item-1', title: 'Original Item 1', url: 'https://1.com', updatedAt: 100 },
          { id: 'item-2', title: 'Original Item 2', url: 'https://2.com', updatedAt: 100 }
        ],
        tags: ['Tag1'],
        searchEngines: []
      };

      // Local deleted item-1 but edited item-2; Cloud edited item-1 but deleted item-2
      const localData = {
        items: [{ id: 'item-2', title: 'Local Edited Item 2', url: 'https://2.com', updatedAt: 200 }],
        tags: ['Tag1'],
        searchEngines: []
      };
      const cloudData = {
        items: [{ id: 'item-1', title: 'Cloud Edited Item 1', url: 'https://1.com', updatedAt: 200 }],
        tags: ['Tag1'],
        searchEngines: []
      };

      const merged = threeWayMergeUnifiedData(localData, cloudData, baseData);

      assert.equal(merged.items.length, 2);
      assert.equal(merged.items.find(i => i.id === 'item-1').title, 'Cloud Edited Item 1');
      assert.equal(merged.items.find(i => i.id === 'item-2').title, 'Local Edited Item 2');
    });
  });

  describe('GoogleDriveAdapter (Real OAuth, 401 Retry & Multipart/PATCH REST Protocol)', () => {
    it('parses OAuth access_token and expiry from launchWebAuthFlow redirect URL and persists credentials', async () => {
      const storage = new CollectionMemoryAdapter();
      const mockIdentity = {
        getRedirectURL: () => 'https://ext-id.chromiumapp.org/',
        launchWebAuthFlow: ({ url, interactive }, callback) => {
          assert.equal(interactive, true);
          assert.match(url, /client_id=test-client-id/);
          callback('https://ext-id.chromiumapp.org/#access_token=oauth-tok-999&expires_in=3600');
        }
      };

      const origFetch = global.fetch;
      global.fetch = async (url) => {
        if (url.includes('userinfo')) {
          return { ok: true, status: 200, json: async () => ({ email: 'owner@example.com', id: 'u1' }) };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      };

      try {
        const adapter = new GoogleDriveAdapter({
          clientId: 'test-client-id',
          storage,
          identity: mockIdentity
        });

        const authRes = await adapter.authorize(true);
        assert.equal(authRes.token, 'oauth-tok-999');
        assert.equal(authRes.user.email, 'owner@example.com');
        assert.equal(await adapter.isAuthenticated(), true);

        const stored = await storage.get(['gdrive_token', 'gdrive_auto_connect', 'gdrive_user']);
        assert.equal(stored.gdrive_token, 'oauth-tok-999');
        assert.equal(stored.gdrive_auto_connect, true);
        assert.equal(stored.gdrive_user.email, 'owner@example.com');
      } finally {
        global.fetch = origFetch;
      }
    });

    it('automatically refreshes token and retries request once when Google Drive API returns 401', async () => {
      const storage = new CollectionMemoryAdapter();
      await storage.set({
        gdrive_client_id: 'client-123',
        gdrive_token: 'expired-token',
        gdrive_auto_connect: true
      });

      const mockIdentity = {
        getRedirectURL: () => 'https://ext-id.chromiumapp.org/',
        launchWebAuthFlow: ({ interactive }, callback) => {
          assert.equal(interactive, false, 'Should attempt silent token renewal first');
          callback('https://ext-id.chromiumapp.org/#access_token=refreshed-token&expires_in=3600');
        }
      };

      const authHeadersUsed = [];
      const origFetch = global.fetch;
      global.fetch = async (url, options = {}) => {
        if (url.includes('userinfo')) {
          return { ok: true, status: 200, json: async () => ({ email: 'user@example.com' }) };
        }
        authHeadersUsed.push(options.headers?.Authorization);
        if (options.headers?.Authorization === 'Bearer expired-token') {
          return { ok: false, status: 401, text: async () => 'Unauthorized' };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ files: [{ id: 'file-1', name: DEFAULT_SYNC_FILENAME, modifiedTime: '2026-10-23T00:00:00Z' }] })
        };
      };

      try {
        const adapter = new GoogleDriveAdapter({ storage, identity: mockIdentity });
        const file = await adapter.findFile();

        assert.equal(file.id, 'file-1');
        assert.deepEqual(authHeadersUsed, ['Bearer expired-token', 'Bearer refreshed-token']);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('uses POST multipart upload when creating a new cloud file and PATCH media upload when updating an existing file', async () => {
      const storage = new CollectionMemoryAdapter();
      await storage.set({
        gdrive_client_id: 'client-123',
        gdrive_token: 'valid-token',
        gdrive_auto_connect: true
      });

      let existingCloudFile = null;
      const recordedRequests = [];
      const origFetch = global.fetch;
      global.fetch = async (url, options = {}) => {
        const method = options.method || 'GET';
        recordedRequests.push({ url, method, headers: options.headers, body: options.body });

        if (method === 'GET' && url.includes('/files?spaces=appDataFolder')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: existingCloudFile ? [existingCloudFile] : [] })
          };
        }
        if (method === 'POST' && url.includes('uploadType=multipart')) {
          existingCloudFile = { id: 'drive-file-100', name: DEFAULT_SYNC_FILENAME, modifiedTime: 't1' };
          return { ok: true, status: 200, json: async () => existingCloudFile };
        }
        if (method === 'PATCH' && url.includes('/files/drive-file-100?uploadType=media')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'drive-file-100', name: DEFAULT_SYNC_FILENAME, modifiedTime: 't2' })
          };
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      };

      try {
        const adapter = new GoogleDriveAdapter({ storage });

        // 1st upload: no file on cloud -> POST multipart
        const createRes = await adapter.uploadJson({ items: [], tags: ['A'], searchEngines: [] });
        assert.equal(createRes.id, 'drive-file-100');
        assert.equal(recordedRequests[1].method, 'POST');
        assert.match(recordedRequests[1].body, /appDataFolder/);

        // 2nd upload: file exists -> PATCH media
        const updateRes = await adapter.uploadJson({ items: [], tags: ['A', 'B'], searchEngines: [] });
        assert.equal(updateRes.modifiedTime, 't2');
        assert.equal(recordedRequests[3].method, 'PATCH');
      } finally {
        global.fetch = origFetch;
      }
    });
  });

  describe('SyncCoordinator Lifecycle & Multi-Device Consistency', () => {
    it('propagates multi-device deletions cleanly via Base Snapshot without resurrecting deleted items', async () => {
      const gdrive = new MemoryGoogleDriveAdapter();
      gdrive.setMockAuth({ token: 'mock-shared' });

      // Device A creates 2 items and 2 tags, then performs initial upload
      const collStoreA = new CollectionStore(new CollectionMemoryAdapter({
        items: [
          { id: 'item-A', title: 'Item A', url: 'https://a.com', updatedAt: 100 },
          { id: 'item-B', title: 'Item B', url: 'https://b.com', updatedAt: 100 }
        ],
        tags: ['TagA', 'TagB']
      }));
      const seStoreA = new SearchEngineStore(new SearchMemoryAdapter());
      await collStoreA.load();
      await seStoreA.load();

      const coordA = new SyncCoordinator({ cloudAdapter: gdrive, collectionStore: collStoreA, searchEngineStore: seStoreA });
      const initialRes = await coordA.sync();
      assert.equal(initialRes.action, 'uploaded_initial');

      // Device B syncs from empty state and receives both items
      const collStoreB = new CollectionStore(new CollectionMemoryAdapter());
      const seStoreB = new SearchEngineStore(new SearchMemoryAdapter());
      await collStoreB.load();
      await seStoreB.load();

      const coordB = new SyncCoordinator({ cloudAdapter: gdrive, collectionStore: collStoreB, searchEngineStore: seStoreB });
      await coordB.sync();
      assert.equal(collStoreB.getItems().length, 2);

      // Device A deletes item-B and TagB and syncs
      await collStoreA.deleteItem('item-B');
      await collStoreA.deleteTag('TagB');
      await coordA.sync();

      // Device B syncs -> item-B and TagB are deleted on Device B as well
      await coordB.sync();
      assert.deepEqual(collStoreB.getItems().map(i => i.id), ['item-A']);
      assert.deepEqual(collStoreB.getTags(), ['TagA']);
    });

    it('queues concurrent sync() calls via Single-Flight lock so changes made mid-sync are synced immediately afterward', async () => {
      const gdrive = new MemoryGoogleDriveAdapter();
      gdrive.setMockAuth({ token: 'mock-token' });

      const collStore = new CollectionStore(new CollectionMemoryAdapter({
        items: [{ id: 'item-1', title: 'First', url: 'https://1.com', updatedAt: 100 }],
        tags: []
      }));
      const seStore = new SearchEngineStore(new SearchMemoryAdapter());
      await collStore.load();
      await seStore.load();

      const coordinator = new SyncCoordinator({
        cloudAdapter: gdrive,
        collectionStore: collStore,
        searchEngineStore: seStore
      });

      let uploadCalls = 0;
      const origUpload = gdrive.uploadJson.bind(gdrive);
      gdrive.uploadJson = async (data, filename) => {
        uploadCalls++;
        if (uploadCalls === 1) {
          // Simulate a user saving a second item while the first upload is in-flight
          await collStore.saveItem({ id: 'item-2', title: 'Added Mid-Sync', url: 'https://2.com' });
          // Trigger a second sync while the first is still running
          coordinator.sync();
        }
        return await origUpload(data, filename);
      };

      const finalResult = await coordinator.sync();
      assert.equal(finalResult.success, true);
      assert.equal(uploadCalls, 2, 'Second sync should have been queued and executed after the first completed');

      const cloudFile = await gdrive.findFile();
      const cloudData = await gdrive.downloadJson(cloudFile.id);
      assert.equal(cloudData.items.length, 2);
    });

    it('updates Base Snapshot on force pushToCloud and force pullFromCloud, and reports ERROR when unauthenticated', async () => {
      const unauthDrive = new MemoryGoogleDriveAdapter();
      const unauthCoord = new SyncCoordinator({
        cloudAdapter: unauthDrive,
        collectionStore: new CollectionStore(new CollectionMemoryAdapter()),
        searchEngineStore: new SearchEngineStore(new SearchMemoryAdapter())
      });

      const unauthRes = await unauthCoord.sync();
      assert.equal(unauthRes.success, false);
      assert.equal(unauthCoord.status, SYNC_STATUS.ERROR);

      // Authenticated push & pull
      const gdrive = new MemoryGoogleDriveAdapter();
      gdrive.setMockAuth({ token: 'mock-token' });

      const collStore = new CollectionStore(new CollectionMemoryAdapter({
        items: [{ id: 'item-orig', title: 'Original', url: 'https://orig.com', addDate: 100 }],
        tags: ['OrigTag']
      }));
      const seStore = new SearchEngineStore(new SearchMemoryAdapter());
      await collStore.load();
      await seStore.load();

      const coordinator = new SyncCoordinator({
        cloudAdapter: gdrive,
        collectionStore: collStore,
        searchEngineStore: seStore
      });

      await coordinator.pushToCloud();
      assert.equal(coordinator.getBaseData().items[0].id, 'item-orig');

      await gdrive.uploadJson({
        items: [{ id: 'item-cloud', title: 'From Cloud', url: 'https://cloud.com', addDate: 200 }],
        tags: ['CloudTag'],
        searchEngines: []
      });

      await coordinator.pullFromCloud();
      assert.equal(collStore.getItems()[0].id, 'item-cloud');
      assert.equal(coordinator.getBaseData().items[0].id, 'item-cloud');
    });

    it('enforces ADR-0001 via initializeBackgroundSync: marks dirty on external storage changes without starting a debounce timer, ignores sync_in_progress, and preserves items added in other contexts on flush', async () => {
      const gdrive = new MemoryGoogleDriveAdapter();
      gdrive.setMockAuth({ token: 'mock-token', email: 'user@gmail.com' });

      const sharedStorage = new CollectionMemoryAdapter();
      await sharedStorage.set({ gdrive_auto_connect: true });

      await gdrive.uploadJson({
        version: 1,
        items: [{ id: 'item-cloud-1', title: 'Existing Cloud Item', url: 'https://cloud-1.com', tags: ['work'], updatedAt: 1000 }],
        tags: ['work'],
        searchEngines: []
      });

      // Context 1: Background Service Worker initialized via initializeBackgroundSync
      const bgCollStore = new CollectionStore(sharedStorage);
      const bgSeStore = new SearchEngineStore(new SearchMemoryAdapter());
      const bgCoordinator = new SyncCoordinator({
        cloudAdapter: gdrive,
        collectionStore: bgCollStore,
        searchEngineStore: bgSeStore,
        storage: sharedStorage
      });
      await initializeBackgroundSync(bgCoordinator, sharedStorage);

      // Initial sync brings cloud item into shared storage and clears dirty flag
      await bgCoordinator.sync();
      assert.equal(bgCoordinator.isDirty, false);

      // Verify sync_in_progress changes do NOT mark coordinator dirty
      await sharedStorage.set({
        sync_in_progress: true,
        items: [{ id: 'item-cloud-1', title: 'Existing Cloud Item', url: 'https://cloud-1.com', tags: ['work'], updatedAt: 1000 }]
      });
      assert.equal(bgCoordinator.isDirty, false);
      await sharedStorage.set({ sync_in_progress: false });

      // Context 2: Sidebar UI Store saves a brand-new Collection Item to sharedStorage
      const uiCollStore = new CollectionStore(sharedStorage);
      await uiCollStore.load();
      await uiCollStore.saveItem({
        id: 'item-local-new',
        title: 'Newly Added Local Item',
        url: 'https://local-new.com',
        tags: ['personal']
      });

      // initializeBackgroundSync's onChanged listener automatically marked bgCoordinator dirty WITHOUT starting a timer
      assert.equal(bgCoordinator.isDirty, true);
      assert.equal(bgCoordinator._autoSyncTimer, null);

      // Simulate stale in-memory cache in background Service Worker
      bgCollStore.items = [];

      // Closing Sidebar triggers flushPendingSync -> reloads fresh state from sharedStorage and merges cleanly
      const flushResult = await bgCoordinator.flushPendingSync();
      assert.equal(flushResult.success, true);
      assert.equal(bgCoordinator.isDirty, false);

      const finalCloudFile = await gdrive.findFile();
      const finalCloudData = await gdrive.downloadJson(finalCloudFile.id);
      assert.deepEqual(
        finalCloudData.items.map(i => i.id).sort(),
        ['item-cloud-1', 'item-local-new']
      );

      // Subsequent flush when nothing is dirty skips network sync cleanly
      const secondFlush = await bgCoordinator.flushPendingSync();
      assert.equal(secondFlush.skipped, true);
      assert.equal(secondFlush.reason, 'already_in_sync');
    });
  });
});
