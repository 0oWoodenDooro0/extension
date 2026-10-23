import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractImageFromHtml, resolveUrl } from '../background.js';

describe('Cover Image Extraction & URL Resolution', () => {
  describe('resolveUrl', () => {
    it('resolves absolute, root-relative, path-relative, and protocol-relative URLs against base URL', () => {
      assert.strictEqual(
        resolveUrl('https://example.com/img.jpg', 'https://example.com/page'),
        'https://example.com/img.jpg'
      );
      assert.strictEqual(
        resolveUrl('/assets/cover.png', 'https://example.com/articles/news'),
        'https://example.com/assets/cover.png'
      );
      assert.strictEqual(
        resolveUrl('cover.jpg', 'https://example.com/articles/news/'),
        'https://example.com/articles/news/cover.jpg'
      );
      assert.strictEqual(
        resolveUrl('//cdn.example.com/image.jpg', 'https://example.com'),
        'https://cdn.example.com/image.jpg'
      );
    });
  });

  describe('extractImageFromHtml priority chain', () => {
    it('prioritizes og:image regardless of attribute order or property/name attribute', () => {
      const htmlPropertyFirst = `
        <html><head>
          <meta property="og:image" content="/og-first.jpg">
          <meta name="twitter:image" content="/twitter.jpg">
        </head></html>
      `;
      assert.strictEqual(
        extractImageFromHtml(htmlPropertyFirst, 'https://example.com/post'),
        'https://example.com/og-first.jpg'
      );

      const htmlContentFirst = `
        <html><head>
          <meta content="https://example.com/og-reverse.png" name="og:image" />
        </head></html>
      `;
      assert.strictEqual(
        extractImageFromHtml(htmlContentFirst, 'https://example.com'),
        'https://example.com/og-reverse.png'
      );
    });

    it('falls back to twitter:image when og:image is absent', () => {
      const html = `
        <html><head>
          <meta name="twitter:image" content="/images/twitter-card.webp">
          <link rel="image_src" href="/images/link-src.jpg">
        </head></html>
      `;
      assert.strictEqual(
        extractImageFromHtml(html, 'https://example.com/blog/1'),
        'https://example.com/images/twitter-card.webp'
      );
    });

    it('falls back to link[rel="image_src"] then link[rel="apple-touch-icon"]', () => {
      const htmlWithImageSrc = `
        <html><head>
          <link href="/thumb.jpg" rel="image_src">
          <link rel="apple-touch-icon" href="/apple-icon.png">
        </head></html>
      `;
      assert.strictEqual(
        extractImageFromHtml(htmlWithImageSrc, 'https://example.com'),
        'https://example.com/thumb.jpg'
      );

      const htmlWithAppleIcon = `
        <html><head>
          <link rel="apple-touch-icon" href="/apple-icon.png">
        </head></html>
      `;
      assert.strictEqual(
        extractImageFromHtml(htmlWithAppleIcon, 'https://example.com'),
        'https://example.com/apple-icon.png'
      );
    });

    it('falls back to the first qualifying <img> while skipping data:, .svg, pixel, and 1x1 tracking images', () => {
      const html = `
        <html><body>
          <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
          <img src="/icons/logo.svg">
          <img src="https://tracker.example.com/pixel.gif">
          <img src="/ads/spacer-1x1.png">
          <img src="/content/hero-photo.jpg">
          <img src="/content/second-photo.jpg">
        </body></html>
      `;
      assert.strictEqual(
        extractImageFromHtml(html, 'https://example.com/article'),
        'https://example.com/content/hero-photo.jpg'
      );
    });

    it('returns null when no qualifying image exists or input is invalid', () => {
      const htmlOnlyExcluded = `
        <html><body>
          <img src="data:image/png;base64,AAA">
          <img src="/icon.svg">
        </body></html>
      `;
      assert.strictEqual(extractImageFromHtml(htmlOnlyExcluded, 'https://example.com'), null);
      assert.strictEqual(extractImageFromHtml('', 'https://example.com'), null);
      assert.strictEqual(extractImageFromHtml(null, 'https://example.com'), null);
    });
  });
});
