import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

interface ShadowArchiveEntry {
  path: string;
  payload: string;
  nonce: string;
  sha256: string;
  bytes: number;
}

interface ShadowArchiveManifest {
  version: 1;
  entries: ShadowArchiveEntry[];
}

export class ShadowStoreKeyError extends Error {
  readonly code = 'SHADOW_KEY_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ShadowStoreKeyError';
  }
}

export class ShadowArchiveCorruptError extends Error {
  readonly code = 'SHADOW_ARCHIVE_CORRUPT';

  constructor(message: string) {
    super(message);
    this.name = 'ShadowArchiveCorruptError';
  }
}

/**
 * Encrypts plugin-owned Git object files without changing Git's object format.
 * Git receives a disposable plaintext runtime directory only while an
 * operation is running; the durable archive contains authenticated ciphertext.
 */
export class EncryptedShadowStore {
  private readonly currentKey: Buffer;
  private readonly previousKey?: Buffer;
  private queue: Promise<void> = Promise.resolve();
  private runtimeDepth = 0;
  private usedPreviousKey = false;

  constructor(
    private readonly runtimeDir: string,
    private readonly archiveDir: string,
    key: string,
    previousKey?: string,
  ) {
    this.currentKey = createHash('sha256').update(key).digest();
    this.previousKey = previousKey ? createHash('sha256').update(previousKey).digest() : undefined;
  }

  async withRuntime<T>(operation: () => Promise<T>): Promise<T> {
    if (this.runtimeDepth > 0) {
      this.runtimeDepth += 1;
      try {
        return await operation();
      } finally {
        this.runtimeDepth -= 1;
      }
    }
    let release!: () => void;
    const prior = this.queue;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await prior;
    this.runtimeDepth = 1;
    let materialized = false;
    try {
      await this.materialize();
      materialized = true;
      return await operation();
    } finally {
      try {
        if (materialized) await this.persist();
      } finally {
        this.runtimeDepth = 0;
        await fs.rm(this.runtimeDir, { recursive: true, force: true });
        release();
      }
    }
  }

  /** Explicitly migrate an existing plaintext runtime directory. */
  async migratePlaintext(): Promise<{ migrated: boolean; entries: number; bytes: number }> {
    const files = await listFiles(this.runtimeDir);
    if (files.length === 0) return { migrated: false, entries: 0, bytes: 0 };
    if (await exists(path.join(this.archiveDir, 'manifest.v1.json'))) {
      throw new ShadowStoreKeyError('Encrypted shadow archive already exists; refusing to mix plaintext objects.');
    }
    await fs.mkdir(this.archiveDir, { recursive: true });
    await this.persist(files);
    const manifest = await this.readManifest();
    await fs.rm(this.runtimeDir, { recursive: true, force: true });
    return { migrated: true, entries: manifest.entries.length, bytes: manifest.entries.reduce((sum, item) => sum + item.bytes, 0) };
  }

  private async materialize(): Promise<void> {
    const manifest = await this.readManifestOptional();
    const plaintext = await listFiles(this.runtimeDir);
    if (!manifest) {
      if (plaintext.length > 0) {
        throw new ShadowStoreKeyError('Plaintext shadow objects exist; run explicit shadow migration before enabling encryption.');
      }
      await fs.mkdir(this.runtimeDir, { recursive: true });
      return;
    }
    await fs.rm(this.runtimeDir, { recursive: true, force: true });
    await fs.mkdir(this.runtimeDir, { recursive: true });
    for (const entry of manifest.entries) {
      const relative = safeRelative(entry.path);
      const encrypted = await fs.readFile(path.join(this.archiveDir, entry.payload)).catch(() => {
        throw new ShadowArchiveCorruptError(`Encrypted shadow payload '${entry.path}' is missing.`);
      });
      if (encrypted.length < 16) throw new ShadowArchiveCorruptError(`Encrypted shadow payload '${entry.path}' is truncated.`);
      const plaintextBytes = this.decrypt(encrypted, entry.nonce, entry.path);
      const digest = createHash('sha256').update(plaintextBytes).digest('hex');
      if (digest !== entry.sha256 || plaintextBytes.length !== entry.bytes) {
        throw new ShadowArchiveCorruptError(`Encrypted shadow payload '${entry.path}' failed integrity validation.`);
      }
      const target = path.join(this.runtimeDir, ...relative.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, plaintextBytes);
    }
  }

  private async persist(existingFiles?: string[]): Promise<void> {
    const files = existingFiles ?? await listFiles(this.runtimeDir);
    const staging = path.join(this.archiveDir, `.staging-${randomUUID()}`);
    const payloadDir = path.join(staging, 'payload');
    await fs.mkdir(payloadDir, { recursive: true });
    const entries: ShadowArchiveEntry[] = [];
    try {
      for (const file of files) {
        const relative = safeRelative(path.relative(this.runtimeDir, file).replace(/\\/g, '/'));
        const plaintext = await fs.readFile(file);
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.currentKey, nonce);
        cipher.setAAD(Buffer.from(`dsh-tm-shadow:v1:${relative}`, 'utf8'));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
        const payload = `payload/${randomUUID()}.bin`;
        await fs.mkdir(path.join(payloadDir, 'payload'), { recursive: true });
        await fs.writeFile(path.join(staging, payload), ciphertext);
        entries.push({
          path: relative,
          payload,
          nonce: nonce.toString('base64url'),
          sha256: createHash('sha256').update(plaintext).digest('hex'),
          bytes: plaintext.length,
        });
      }
      const manifest: ShadowArchiveManifest = { version: 1, entries };
      await fs.mkdir(this.archiveDir, { recursive: true });
      for (const entry of entries) {
        const target = path.join(this.archiveDir, entry.payload);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(path.join(staging, entry.payload), target);
      }
      const temporaryManifest = path.join(this.archiveDir, `.manifest-${randomUUID()}.tmp`);
      await fs.writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryManifest, path.join(this.archiveDir, 'manifest.v1.json'));
      const referenced = new Set(entries.map(entry => entry.payload.replace(/\\/g, '/')));
      for (const payloadFile of await listFiles(path.join(this.archiveDir, 'payload'))) {
        const relative = path.relative(this.archiveDir, payloadFile).replace(/\\/g, '/');
        if (!referenced.has(relative)) await fs.rm(payloadFile, { force: true });
      }
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
    this.usedPreviousKey = false;
  }

  private async readManifest(): Promise<ShadowArchiveManifest> {
    const manifest = await this.readManifestOptional();
    if (!manifest) throw new ShadowArchiveCorruptError('Encrypted shadow archive manifest is missing.');
    return manifest;
  }

  private async readManifestOptional(): Promise<ShadowArchiveManifest | undefined> {
    const raw = await fs.readFile(path.join(this.archiveDir, 'manifest.v1.json'), 'utf8').catch((error: any) => {
      if (error?.code === 'ENOENT') return undefined;
      throw new ShadowArchiveCorruptError(`Encrypted shadow archive cannot be read: ${error?.message ?? 'unknown error'}`);
    });
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as ShadowArchiveManifest;
      if (value.version !== 1 || !Array.isArray(value.entries)) throw new Error('unsupported manifest');
      for (const entry of value.entries) {
        safeRelative(entry.path);
        if (!entry.payload || !entry.nonce || !/^[0-9a-f]{64}$/.test(entry.sha256) || !Number.isInteger(entry.bytes) || entry.bytes < 0) throw new Error('invalid entry');
      }
      return value;
    } catch (error: any) {
      throw new ShadowArchiveCorruptError(`Encrypted shadow archive manifest is invalid: ${error?.message ?? 'unknown error'}`);
    }
  }

  private decrypt(encrypted: Buffer, nonceText: string, relative: string): Buffer {
    const keys = this.previousKey ? [this.currentKey, this.previousKey] : [this.currentKey];
    for (let index = 0; index < keys.length; index += 1) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', keys[index], Buffer.from(nonceText, 'base64url'));
        decipher.setAAD(Buffer.from(`dsh-tm-shadow:v1:${relative}`, 'utf8'));
        decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
        const result = Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - 16)), decipher.final()]);
        if (index === 1) this.usedPreviousKey = true;
        return result;
      } catch {
        // Try the explicitly configured previous key once, then fail closed.
      }
    }
    throw new ShadowStoreKeyError(`Encrypted shadow payload '${relative}' failed authentication.`);
  }
}

function safeRelative(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized.split('/').some(part => !part || part === '..')) {
    throw new ShadowArchiveCorruptError(`Unsafe encrypted shadow path '${value}'.`);
  }
  return normalized;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[])) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(absolute);
      else if (entry.isSymbolicLink()) throw new ShadowArchiveCorruptError(`Shadow object runtime contains unsupported symlink '${absolute}'.`);
    }
  }
  await visit(root);
  return output.sort();
}
