import {BaseProcessor, createProcessor} from '../src/lib/processors/base-processor.js';
import {LabelProcessor} from '../src/lib/processors/label-processor.js';
import {FolderProcessor} from '../src/lib/processors/folder-processor.js';
import {ColorProcessor} from '../src/lib/processors/color-processor.js';

describe('base-processor', () => {
  describe('BaseProcessor', () => {
    it('should throw error when process() is called on abstract class', async () => {
      const processor = new BaseProcessor();
      
      await expect(processor.process({}, {})).rejects.toThrow('must be implemented by subclass');
    });
  });

  describe('createProcessor factory', () => {
    it('should create LabelProcessor for label mode', async () => {
      const processor = await createProcessor('label');
      
      expect(processor).toBeInstanceOf(LabelProcessor);
      expect(processor).toBeInstanceOf(BaseProcessor);
    });

    it('should create FolderProcessor for folder mode', async () => {
      const processor = await createProcessor('folder');
      
      expect(processor).toBeInstanceOf(FolderProcessor);
      expect(processor).toBeInstanceOf(BaseProcessor);
    });

    it('should create ColorProcessor for color mode', async () => {
      const processor = await createProcessor('color');
      
      expect(processor).toBeInstanceOf(ColorProcessor);
      expect(processor).toBeInstanceOf(BaseProcessor);
    });

    it('should default to label mode when no mode specified', async () => {
      const processor = await createProcessor();
      
      expect(processor).toBeInstanceOf(LabelProcessor);
    });

    it('should throw error for invalid mode', async () => {
      await expect(createProcessor('invalid')).rejects.toThrow('Unknown processing mode');
    });

    it('should throw error message mentioning valid modes', async () => {
      await expect(createProcessor('invalid')).rejects.toThrow("Expected 'label', 'folder', or 'color'");
    });
  });
});
