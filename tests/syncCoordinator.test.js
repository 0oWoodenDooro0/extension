// tests/syncCoordinator.test.js - Unit tests for Google Drive & Sync Coordinator
import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryGoogleDriveAdapter, DEFAULT_SYNC_FILENAME } from '../sidebar/googleDriveAdapter.js';
import { SyncCoordinator, mergeUnifiedData, SYNC_STATUS } from '../sidebar/syncCoordinator.js';
import { CollectionStore, MemoryStorageAdapter as CollectionMemoryAdapter } from '../sidebar/store.js';
import { SearchEngineStore, MemoryStorageAdapter as SearchMemoryAdapter } from '../searchEngineStore.js';

test('Google Drive Sync & Coordinator Test Suite', async (t) => {
  await t.test('mergeUnifiedData - Merging datasets correctly', () => {
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
  });

  await t.test('SyncCoordinator - Multi-device two-way sync scenario', async () => {
    // Device A starts with Item A
    const collAdapterA = new CollectionMemoryAdapter({
      items: [{ id: 'item-A', title: 'Item on Device A', url: 'https://a.com', updatedAt: 100 }],
      tags: ['TagA']
    });
    const collStoreA = new CollectionStore(collAdapterA);
    const seStoreA = new SearchEngineStore(new SearchMemoryAdapter());
    await collStoreA.load();
    await seStoreA.load();

    // Shared Cloud
    const gdrive = new MemoryGoogleDriveAdapter();
    gdrive.setMockAuth({ token: 'mock-shared' });

    // Device A syncs first
    const coordA = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: collStoreA,
      searchEngineStore: seStoreA
    });
    const resA = await coordA.sync();
    assert.equal(resA.success, true);

    // Device B has Item B
    const collAdapterB = new CollectionMemoryAdapter({
      items: [{ id: 'item-B', title: 'Item on Device B', url: 'https://b.com', updatedAt: 200 }],
      tags: ['TagB']
    });
    const collStoreB = new CollectionStore(collAdapterB);
    const seStoreB = new SearchEngineStore(new SearchMemoryAdapter());
    await collStoreB.load();
    await seStoreB.load();

    // Device B syncs
    const coordB = new SyncCoordinator({
      cloudAdapter: gdrive,
      collectionStore: collStoreB,
      searchEngineStore: seStoreB
    });
    const resB = await coordB.sync();
    assert.equal(resB.success, true);
    assert.equal(resB.action, 'merged_sync');

    // Now Device B should have both Item A and Item B
    assert.equal(collStoreB.getItems().length, 2);
    assert.deepEqual(collStoreB.getTags().sort(), ['TagA', 'TagB']);

    // Now Device A syncs again
    const resA2 = await coordA.sync();
    assert.equal(resA2.success, true);
    // Device A should now also have both Item A and Item B
    assert.equal(collStoreA.getItems().length, 2);
    assert.deepEqual(collStoreA.getTags().sort(), ['TagA', 'TagB']);
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
});
