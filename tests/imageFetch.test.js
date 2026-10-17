import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractOgImageFromHtml,
  extractImageFromHtml,
  resolveImageUrl,
  resolveUrl,
  isIgnoredImage,
  getImageForUrl,
  extractImageFromDom
} from '../background.js';
import { BrowserTabAdapter, MemoryTabAdapter } from '../tabAdapter.js';

describe('Image Fetch & Extraction Pipeline (Deep Module)', () => {
  describe('resolveImageUrl / resolveUrl', () => {
    it('returns full absolute URL unchanged', () => {
      const result = resolveImageUrl('https://example.com/img.jpg', 'https://example.com/page');
      assert.strictEqual(result, 'https://example.com/img.jpg');
    });

    it('resolves root-relative paths with base URL', () => {
      const result = resolveImageUrl('/assets/cover.png', 'https://example.com/articles/news');
      assert.strictEqual(result, 'https://example.com/assets/cover.png');
    });

    it('resolves relative paths with base URL', () => {
      const result = resolveImageUrl('cover.jpg', 'https://example.com/articles/news/');
      assert.strictEqual(result, 'https://example.com/articles/news/cover.jpg');
    });

    it('resolves protocol-relative URLs with base URL scheme', () => {
      const result = resolveImageUrl('//cdn.example.com/image.jpg', 'https://example.com');
      assert.strictEqual(result, 'https://cdn.example.com/image.jpg');
    });
  });

  describe('isIgnoredImage', () => {
    it('identifies tracking pixels, SVGs, and data URIs', () => {
      assert.strictEqual(isIgnoredImage('data:image/png;base64,123'), true);
      assert.strictEqual(isIgnoredImage('https://example.com/icon.svg'), true);
      assert.strictEqual(isIgnoredImage('https://example.com/logo.SVG?v=1'), true);
      assert.strictEqual(isIgnoredImage('https://example.com/tracking_pixel.gif'), true);
      assert.strictEqual(isIgnoredImage('https://example.com/1x1.png'), true);
      assert.strictEqual(isIgnoredImage('https://example.com/covers/hero.jpg'), false);
      assert.strictEqual(isIgnoredImage('https://example.com/photo.webp'), false);
      assert.strictEqual(isIgnoredImage(null), true);
      assert.strictEqual(isIgnoredImage(''), true);
    });
  });

  describe('extractImageFromHtml (5-Stage Extraction)', () => {
    it('stage 1: extracts og:image with property or name attribute', () => {
      const html1 = `<meta property="og:image" content="https://example.com/og1.jpg">`;
      assert.strictEqual(extractImageFromHtml(html1, 'https://example.com'), 'https://example.com/og1.jpg');

      const html2 = `<meta name="og:image" content="https://example.com/og2.jpg">`;
      assert.strictEqual(extractImageFromHtml(html2, 'https://example.com'), 'https://example.com/og2.jpg');

      const html3 = `<meta content="/relative/og3.jpg" property="og:image">`;
      assert.strictEqual(extractImageFromHtml(html3, 'https://example.com/dir/'), 'https://example.com/relative/og3.jpg');
    });

    it('stage 2: extracts twitter:image with name or property attribute', () => {
      const html1 = `<meta name="twitter:image" content="https://example.com/tw1.jpg">`;
      assert.strictEqual(extractImageFromHtml(html1, 'https://example.com'), 'https://example.com/tw1.jpg');

      const html2 = `<meta property="twitter:image" content="https://example.com/tw2.jpg">`;
      assert.strictEqual(extractImageFromHtml(html2, 'https://example.com'), 'https://example.com/tw2.jpg');
    });

    it('stage 3: extracts link rel="image_src"', () => {
      const html = `<link rel="image_src" href="/images/src.jpg">`;
      assert.strictEqual(extractImageFromHtml(html, 'https://example.com'), 'https://example.com/images/src.jpg');
    });

    it('stage 4: extracts link rel="apple-touch-icon"', () => {
      const html = `<link rel="apple-touch-icon" href="/touch-icon.png">`;
      assert.strictEqual(extractImageFromHtml(html, 'https://example.com'), 'https://example.com/touch-icon.png');
    });

    it('stage 5: extracts first non-ignored <img> tag', () => {
      const html = `
        <div>
          <img src="spacer.gif" class="pixel">
          <img src="/assets/logo.svg">
          <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
          <img src="1x1.png">
          <img src="/media/actual-cover.jpg">
          <img src="/media/second.jpg">
        </div>
      `;
      assert.strictEqual(extractImageFromHtml(html, 'https://example.com'), 'https://example.com/media/actual-cover.jpg');
    });

    it('enforces precedence order: og:image > twitter:image > image_src > apple-touch-icon > img', () => {
      const html = `
        <meta property="twitter:image" content="https://example.com/tw.jpg">
        <link rel="image_src" href="https://example.com/link.jpg">
        <link rel="apple-touch-icon" href="https://example.com/apple.jpg">
        <img src="https://example.com/body.jpg">
        <meta name="og:image" content="https://example.com/og.jpg">
      `;
      assert.strictEqual(extractImageFromHtml(html, 'https://example.com'), 'https://example.com/og.jpg');
    });

    it('returns null when no image can be found or input is empty', () => {
      assert.strictEqual(extractImageFromHtml('', 'https://example.com'), null);
      assert.strictEqual(extractImageFromHtml(null, 'https://example.com'), null);
      assert.strictEqual(extractImageFromHtml('<html><body><p>Hello</p></body></html>', 'https://example.com'), null);
    });
  });

  describe('extractImageFromDom (Consistent DOM Extraction)', () => {
    it('extracts images from DOM matching the exact same 5-stage rules', () => {
      const mockDoc = {
        baseURI: 'https://example.com/post/1',
        querySelector: (selector) => {
          if (selector.includes('og:image')) return { content: '/covers/og.jpg' };
          return null;
        },
        querySelectorAll: () => []
      };

      const result = extractImageFromDom(mockDoc);
      assert.strictEqual(result, 'https://example.com/covers/og.jpg');
    });

    it('filters ignored images when extracting from img elements in DOM', () => {
      const mockDoc = {
        baseURI: 'https://example.com/articles/',
        querySelector: () => null,
        querySelectorAll: (selector) => {
          if (selector.includes('img')) {
            return [
              { src: 'https://example.com/1x1.gif' },
              { src: 'https://example.com/tracker_pixel.png' },
              { src: 'https://example.com/logo.svg' },
              { src: 'photos/hero.png' }
            ];
          }
          return [];
        }
      };

      const result = extractImageFromDom(mockDoc);
      assert.strictEqual(result, 'https://example.com/articles/photos/hero.png');
    });
  });

  describe('getImageForUrl (Deep Module Seam)', () => {
    it('prioritizes open tab DOM over network fetch and does not call fetch', async () => {
      let fetchCalled = false;
      const fakeFetch = async () => {
        fetchCalled = true;
        return { ok: true, text: async () => '<html></html>' };
      };

      const memoryAdapter = new MemoryTabAdapter({
        tabs: [
          { id: 201, url: 'https://news.ycombinator.com/item?id=1', domResult: 'https://news.ycombinator.com/hn.png' }
        ]
      });
      const tabAdapter = new BrowserTabAdapter(memoryAdapter);

      const imageUrl = await getImageForUrl('https://news.ycombinator.com/item?id=1', {
        tabAdapter,
        fetchImpl: fakeFetch
      });

      assert.strictEqual(imageUrl, 'https://news.ycombinator.com/hn.png');
      assert.strictEqual(fetchCalled, false, 'Should not trigger network fetch when tab DOM succeeds');
    });

    it('falls back to network fetch when tab has no image or script execution fails', async () => {
      const fakeFetch = async () => {
        return {
          ok: true,
          text: async () => `<meta property="og:image" content="https://fallback.com/from-fetch.jpg">`
        };
      };

      const memoryAdapter = new MemoryTabAdapter({
        tabs: [
          { id: 202, url: 'https://fallback.com/page', domResult: null }
        ]
      });
      const tabAdapter = new BrowserTabAdapter(memoryAdapter);

      const imageUrl = await getImageForUrl('https://fallback.com/page', {
        tabAdapter,
        fetchImpl: fakeFetch
      });

      assert.strictEqual(imageUrl, 'https://fallback.com/from-fetch.jpg');
    });

    it('falls back to network fetch when no tab is open with the URL', async () => {
      const fakeFetch = async () => {
        return {
          ok: true,
          text: async () => `<link rel="image_src" href="https://notab.com/pic.jpg">`
        };
      };

      const memoryAdapter = new MemoryTabAdapter({ tabs: [] });
      const tabAdapter = new BrowserTabAdapter(memoryAdapter);

      const imageUrl = await getImageForUrl('https://notab.com/article', {
        tabAdapter,
        fetchImpl: fakeFetch
      });

      assert.strictEqual(imageUrl, 'https://notab.com/pic.jpg');
    });

    it('returns null gracefully when both tab DOM and fetch fail', async () => {
      const failingFetch = async () => {
        throw new Error('Network error');
      };

      const memoryAdapter = new MemoryTabAdapter({ tabs: [] });
      const tabAdapter = new BrowserTabAdapter(memoryAdapter);

      const imageUrl = await getImageForUrl('https://broken.com', {
        tabAdapter,
        fetchImpl: failingFetch
      });

      assert.strictEqual(imageUrl, null);
    });
  });
});
