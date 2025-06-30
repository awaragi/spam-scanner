import { collectFoldersToCreate } from '../src/lib/utils/mailboxes-utils.js';

describe('mailboxes-utils', () => {
  describe('collectFoldersToCreate', () => {
    it('should create hierarchical folder structure with dot separator', () => {
      const folders = ['inbox.work.projects', 'inbox.personal'];
      const separator = '.';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      expect(Array.from(result).sort()).toEqual([
        'inbox',
        'inbox.personal',
        'inbox.work',
        'inbox.work.projects'
      ]);
    });

    it('should create hierarchical folder structure with slash separator', () => {
      const folders = ['inbox/work/projects', 'inbox/personal'];
      const separator = '/';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      expect(Array.from(result).sort()).toEqual([
        'inbox',
        'inbox/personal',
        'inbox/work',
        'inbox/work/projects'
      ]);
    });

    it('should handle mixed separators in input folders', () => {
      const folders = ['inbox.work/projects', 'inbox\\personal.archive'];
      const separator = '.';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      expect(Array.from(result).sort()).toEqual([
        'inbox',
        'inbox.personal',
        'inbox.personal.archive',
        'inbox.work',
        'inbox.work.projects'
      ]);
    });

    it('should handle backslash separators in input', () => {
      const folders = ['inbox\\work\\projects'];
      const separator = '\\';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      expect(Array.from(result).sort()).toEqual([
        'inbox',
        'inbox\\work',
        'inbox\\work\\projects'
      ]);
    });

    it('should handle single level folders', () => {
      const folders = ['inbox', 'sent', 'drafts'];
      const separator = '.';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      expect(Array.from(result).sort()).toEqual([
        'drafts',
        'inbox',
        'sent'
      ]);
    });

    it('should handle empty folders array', () => {
      const folders = [];
      const separator = '.';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it('should handle duplicate folder paths', () => {
      const folders = ['inbox.work', 'inbox.work', 'inbox.work.projects'];
      const separator = '.';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      expect(Array.from(result).sort()).toEqual([
        'inbox',
        'inbox.work',
        'inbox.work.projects'
      ]);
    });

    it('should handle folders with different separators but same output separator', () => {
      const folders = ['inbox/work', 'inbox.personal', 'inbox\\archive'];
      const separator = '-';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      expect(Array.from(result).sort()).toEqual([
        'inbox',
        'inbox-archive',
        'inbox-personal',
        'inbox-work'
      ]);
    });

    it('should handle deeply nested folder structures', () => {
      const folders = ['inbox.work.projects.2024.q1.important'];
      const separator = '.';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      expect(Array.from(result).sort()).toEqual([
        'inbox',
        'inbox.work',
        'inbox.work.projects',
        'inbox.work.projects.2024',
        'inbox.work.projects.2024.q1',
        'inbox.work.projects.2024.q1.important'
      ]);
    });

    it('should handle empty string parts gracefully', () => {
      const folders = ['inbox..work', 'inbox.'];
      const separator = '.';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      // Empty strings from split should create empty path segments
      const resultArray = Array.from(result).sort();
      expect(resultArray).toContain('inbox');
      expect(resultArray).toContain('inbox.work');
    });

    it('should preserve case sensitivity', () => {
      const folders = ['Inbox.Work.Projects', 'inbox.work.projects'];
      const separator = '.';
      
      const result = collectFoldersToCreate(folders, separator);
      
      expect(result).toBeInstanceOf(Set);
      const resultArray = Array.from(result);
      expect(resultArray).toContain('Inbox');
      expect(resultArray).toContain('inbox');
      expect(resultArray).toContain('Inbox.Work');
      expect(resultArray).toContain('inbox.work');
    });
  });
});
