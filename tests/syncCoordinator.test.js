// tests/syncCoordinator.test.js - Unit tests for Google Drive & Sync Coordinator
import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryGoogleDriveAdapter, DEFAULT_SYNC_FILENAME } from '../sidebar/googleDriveAdapter.js';
import { SyncCoordinator, mergeUnifiedData, threeWayMergeUnifiedData, SYNC_STATUS } from '../sidebar/syncCoordinator.js';
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
    const bgSeStore = new SearchEngineStore(sharedStorage);
    const bgCoordinator = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: bgCollStore,
      searchEngineStore: bgSeStore,
      storage: sharedStorage
    });
    await bgCoordinator.init();

    // Context 2: Sidebar UI Store
    const uiCollStore = new CollectionStore(sharedStorage);
    const uiSeStore = new SearchEngineStore(sharedStorage);
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
});
