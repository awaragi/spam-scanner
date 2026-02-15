import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { updateMap, seedMap } from '../src/lib/utils/rspamd-maps.js';

const testDir = './test-maps';
const testMapPath = path.join(testDir, 'test.map');

describe('Rspamd Maps Utility', () => {
  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('updateMap', () => {
    it('should create a new map file with normalized emails', async () => {
      const emails = ['Test@Example.Com', 'another@test.org', '  spaced@domain.com  '];
      const result = await updateMap(testMapPath, emails);

      expect(result.added).toHaveLength(3);
      expect(result.skipped).toHaveLength(0);
      expect(result.total).toBe(3);

      // Verify file content
      const content = await fs.readFile(testMapPath, 'utf-8');
      const lines = content.split('\n').filter(l => l);
      expect(lines).toEqual([
        'another@test.org',
        'spaced@domain.com',
        'test@example.com'
      ]);
    });

    it('should append new emails to existing map', async () => {
      // Seed initial data
      await fs.writeFile(testMapPath, 'existing@domain.com\nother@test.org\n');

      const emails = ['new@domain.com', 'existing@domain.com'];
      const result = await updateMap(testMapPath, emails);

      expect(result.added).toContain('new@domain.com');
      expect(result.skipped).toContain('existing@domain.com');
      expect(result.total).toBe(3);

      const content = await fs.readFile(testMapPath, 'utf-8');
      const lines = content.split('\n').filter(l => l);
      expect(lines).toContain('new@domain.com');
      expect(lines).toContain('existing@domain.com');
    });

    it('should deduplicate emails across input', async () => {
      const emails = ['test@domain.com', 'TEST@DOMAIN.COM', 'test@domain.com'];
      const result = await updateMap(testMapPath, emails);

      expect(result.total).toBe(1);
      const content = await fs.readFile(testMapPath, 'utf-8');
      const lines = content.split('\n').filter(l => l);
      expect(lines).toHaveLength(1);
    });

    it('should handle empty input gracefully', async () => {
      const emails = [];
      const result = await updateMap(testMapPath, emails);

      expect(result.added).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should skip invalid email addresses', async () => {
      const emails = ['valid@domain.com', 'invalid-email', '', '  ', 'another@valid.org'];
      const result = await updateMap(testMapPath, emails);

      expect(result.added).toHaveLength(2);
      const content = await fs.readFile(testMapPath, 'utf-8');
      const lines = content.split('\n').filter(l => l);
      expect(lines).not.toContain('invalid-email');
    });

    it('should return skipped count for duplicates', async () => {
      const emails = ['dup@domain.com', 'dup@domain.com'];
      const result = await updateMap(testMapPath, emails);

      expect(result.added).toHaveLength(1);
      expect(result.skipped).toHaveLength(1);
    });

    it('should preserve sort order', async () => {
      const emails = ['z@domain.com', 'a@domain.com', 'm@domain.com'];
      await updateMap(testMapPath, emails);

      const content = await fs.readFile(testMapPath, 'utf-8');
      const lines = content.split('\n').filter(l => l);
      expect(lines).toEqual([
        'a@domain.com',
        'm@domain.com',
        'z@domain.com'
      ]);
    });
  });

  describe('seedMap', () => {
    it('should create a new seeded map file', async () => {
      const emails = ['first@domain.com', 'second@domain.com', 'THIRD@DOMAIN.COM'];
      const result = await seedMap(testMapPath, emails);

      expect(result.total).toBe(3);

      const content = await fs.readFile(testMapPath, 'utf-8');
      const lines = content.split('\n').filter(l => l);
      expect(lines).toHaveLength(3);
    });

    it('should overwrite existing map when seeding', async () => {
      // Create initial file with different content
      await fs.writeFile(testMapPath, 'old@domain.com\n');

      const emails = ['new@domain.com', 'another@domain.com'];
      const result = await seedMap(testMapPath, emails);

      expect(result.total).toBe(2);

      const content = await fs.readFile(testMapPath, 'utf-8');
      expect(content).not.toContain('old@domain.com');
      expect(content).toContain('new@domain.com');
    });

    it('should deduplicate during seeding', async () => {
      const emails = ['test@domain.com', 'test@domain.com', 'TEST@DOMAIN.COM'];
      const result = await seedMap(testMapPath, emails);

      expect(result.total).toBe(1);
    });

    it('should handle empty array gracefully', async () => {
      const result = await seedMap(testMapPath, []);

      expect(result.total).toBe(0);

      const exists = await fs.stat(testMapPath).catch(() => null);
      expect(exists).not.toBeNull();
    });
  });

  describe('Email normalization', () => {
    it('should lowercase emails', async () => {
      const emails = ['UPPERCASE@DOMAIN.COM'];
      const result = await updateMap(testMapPath, emails);

      const content = await fs.readFile(testMapPath, 'utf-8');
      expect(content.toLowerCase()).toBe(content);
    });

    it('should trim whitespace', async () => {
      const emails = ['   test@domain.com   ', '\ntest2@domain.com\n'];
      const result = await updateMap(testMapPath, emails);

      expect(result.total).toBe(2);
      const content = await fs.readFile(testMapPath, 'utf-8');
      expect(content).not.toContain('   ');
      expect(content).not.toContain('\n\n');
    });

    it('should reject emails without @', async () => {
      const emails = ['nodomainemail', 'valid@domain.com'];
      const result = await updateMap(testMapPath, emails);

      expect(result.added).toHaveLength(1);
      const content = await fs.readFile(testMapPath, 'utf-8');
      expect(content).toContain('valid@domain.com');
      expect(content).not.toContain('nodomainemail');
    });

    it('should handle emails with special characters', async () => {
      const emails = [
        'test+tag@domain.com',
        'test.name@domain.co.uk',
        'user_123@sub-domain.com'
      ];
      const result = await updateMap(testMapPath, emails);

      expect(result.added).toHaveLength(3);
      const content = await fs.readFile(testMapPath, 'utf-8');
      expect(content).toContain('test+tag@domain.com');
      expect(content).toContain('test.name@domain.co.uk');
      expect(content).toContain('user_123@sub-domain.com');
    });
  });

  describe('Edge cases', () => {
    it('should handle non-existent map file gracefully', async () => {
      const nonExistentPath = path.join(testDir, 'nonexistent.map');
      const emails = ['test@domain.com'];
      const result = await updateMap(nonExistentPath, emails);

      expect(result.added).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should create parent directories if needed', async () => {
      const nestedPath = path.join(testDir, 'nested', 'deep', 'test.map');
      const emails = ['test@domain.com'];
      const result = await seedMap(nestedPath, emails);

      expect(result.total).toBe(1);

      const exists = await fs.stat(nestedPath).catch(() => null);
      expect(exists).not.toBeNull();
    });

    it('should handle large number of emails', async () => {
      const emails = [];
      for (let i = 0; i < 1000; i++) {
        emails.push(`user${i}@domain.com`);
      }

      const result = await updateMap(testMapPath, emails);

      expect(result.total).toBe(1000);

      const content = await fs.readFile(testMapPath, 'utf-8');
      const lines = content.split('\n').filter(l => l);
      expect(lines).toHaveLength(1000);
    });
  });
});
