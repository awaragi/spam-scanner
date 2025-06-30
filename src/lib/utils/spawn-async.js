const { spawn } = require('child_process');

/**
 * Runs a command using spawn and returns a Promise.
 * @param {string} command - The command to run.
 @param {string[]} args - Arguments for the command.
 * @param {Buffer|string|null} input - Input to send to stdin (optional).
 * @param {object} options - Options for spawn (optional).
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 * @throws {Error} When command is not found (ENOENT) or other spawn errors occur
 */
export function spawnAsync(command, args = [], input = null, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, options);

        let stdout = '';
        let stderr = '';

        if (child.stdout) {
            child.stdout.on('data', data => { stdout += data.toString(); });
        }

        if (child.stderr) {
            child.stderr.on('data', data => { stderr += data.toString(); });
        }

        // Handle stdin input if provided
        if (input && child.stdin) {
            child.stdin.write(input);
            child.stdin.end();
        }

        child.on('error', err => {
            reject(err);
        });

        child.on('close', code => {
            resolve({ stdout, stderr, code });
        });
    });
}