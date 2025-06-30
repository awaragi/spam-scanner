import {describe, it, expect} from 'vitest';
import {spawnAsync} from '../src/lib/utils/spawn-async.js';

describe('spawnAsync', () => {
    it('should execute command and return output', async () => {
        const result = await spawnAsync('echo', ['test']);
        expect(result.stdout.trim()).toBe('test');
        expect(result.code).toBe(0);
    });

    it('should handle command errors', async () => {
        await expect(spawnAsync('nonexistentcommand')).rejects.toThrow();
    });

    it('should capture stderr output', async () => {
        const result = await spawnAsync('node', ['-e', 'console.error("test error")']);
        expect(result.stderr.trim()).toBe('test error');
        expect(result.code).toBe(0);
    });

    it('should reject on spawn error', async () => {
        await expect(spawnAsync('')).rejects.toThrow();
    });

    it('should handle stdin input', async () => {
        const input = 'test input\n';
        const result = await spawnAsync('cat', [], input);
        expect(result.stdout).toBe(input);
        expect(result.code).toBe(0);
    });
});