import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractOgImageFromHtml, resolveImageUrl } from '../background.js';

describe('Image Fetch & og:image Extraction', () => {
  describe('resolveImageUrl', () => {
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

  describe('extractOgImageFromHtml', () => {
    it('extracts og:image when property comes before content', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta property="og:title" content="Test Page">
          <meta property="og:image" content="https://example.com/image1.jpg">
        </head>
        <body></body>
        </html>
      `;
      const extracted = extractOgImageFromHtml(html, 'https://example.com');
      assert.strictEqual(extracted, 'https://example.com/image1.jpg');
    });

    it('extracts og:image when content comes before property', () => {
      const html = `
        <html>
        <head>
          <meta content="https://example.com/image2.png" property="og:image" />
        </head>
        </html>
      `;
      const extracted = extractOgImageFromHtml(html, 'https://example.com');
      assert.strictEqual(extracted, 'https://example.com/image2.png');
    });

    it('extracts og:image with name attribute instead of property', () => {
      const html = `
        <html>
        <head>
          <meta name="og:image" content="https://example.com/image3.jpg" />
        </head>
        </html>
      `;
      const extracted = extractOgImageFromHtml(html, 'https://example.com');
      assert.strictEqual(extracted, 'https://example.com/image3.jpg');
    });

    it('resolves relative og:image URLs to absolute URLs', () => {
      const html = `<meta property="og:image" content="/covers/main.jpg">`;
      const extracted = extractOgImageFromHtml(html, 'https://mysite.org/posts/100');
      assert.strictEqual(extracted, 'https://mysite.org/covers/main.jpg');
    });

    it('returns null when no og:image tag is present', () => {
      const html = `<html><head><title>No image</title></head></html>`;
      assert.strictEqual(extractOgImageFromHtml(html, 'https://example.com'), null);
    });

    it('returns null for empty or invalid inputs', () => {
      assert.strictEqual(extractOgImageFromHtml('', 'https://example.com'), null);
      assert.strictEqual(extractOgImageFromHtml(null, 'https://example.com'), null);
    });
  });
});
