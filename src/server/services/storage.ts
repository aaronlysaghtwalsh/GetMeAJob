import fs from 'node:fs/promises';
import path from 'node:path';
import { decrypt, encrypt } from '../security/crypto';

/**
 * Encrypted file storage. Files are written as AES-256-GCM envelopes under
 * <storageDir>/<userId>/<key>. Keys are generated server-side; user input never forms a path.
 */
export class FileStorage {
  constructor(
    private dir: string,
    private key: Buffer,
  ) {}

  private pathFor(userId: string, storageKey: string): string {
    if (!/^[A-Za-z0-9_]+$/.test(userId) || !/^[A-Za-z0-9_.-]+$/.test(storageKey)) throw new Error('Invalid storage path');
    return path.join(this.dir, userId, storageKey);
  }

  async put(userId: string, storageKey: string, data: Buffer): Promise<void> {
    const file = this.pathFor(userId, storageKey);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, encrypt(data, this.key), { mode: 0o600 });
  }

  async get(userId: string, storageKey: string): Promise<Buffer> {
    return decrypt(await fs.readFile(this.pathFor(userId, storageKey)), this.key);
  }

  async delete(userId: string, storageKey: string): Promise<void> {
    await fs.rm(this.pathFor(userId, storageKey), { force: true });
  }

  async deleteUser(userId: string): Promise<void> {
    if (!/^[A-Za-z0-9_]+$/.test(userId)) throw new Error('Invalid user id');
    await fs.rm(path.join(this.dir, userId), { recursive: true, force: true });
  }
}
