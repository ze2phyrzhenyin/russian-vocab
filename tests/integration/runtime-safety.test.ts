import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  findUser: vi.fn(), findUserOrThrow: vi.fn(), updateUser: vi.fn(), findStudySession: vi.fn(), signUp: vi.fn(),
  runtime: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), readFile: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: fake.findUser, findUniqueOrThrow: fake.findUserOrThrow, update: fake.updateUser }, studySession: { findUnique: fake.findStudySession } } }));
vi.mock('@/lib/auth', () => ({ auth: { api: { signUpEmail: fake.signUp } } }));
vi.mock('@/lib/config', () => ({ readRuntimeConfig: fake.runtime }));
vi.mock('node:fs/promises', () => ({ mkdir: fake.mkdir, writeFile: fake.writeFile, readFile: fake.readFile }));

import { readJson } from '../../src/server/http';
import { seedDemo } from '../../scripts/seed_demo';

beforeEach(() => {
  vi.resetAllMocks();
  fake.runtime.mockReturnValue({ demoMode: true, baseURL: 'http://localhost:4187' });
  fake.findUser.mockResolvedValue(null);
});

describe('demo seed account provenance', () => {
  it.each([
    { email: 'admin@ruslearn.test', demo: false, role: 'user' },
    { email: 'new@ruslearn.test', demo: false, role: 'user' },
    { email: 'admin@ruslearn.test', demo: true, role: 'user' },
    { email: 'demo@ruslearn.test', demo: true, role: 'admin' },
  ])('does not claim or change an existing $email with demo=$demo / role=$role', async account => {
    fake.findUser.mockImplementation(async ({ where }: { where: { email: string } }) => where.email === account.email ? { id: 'pre-existing-user', ...account } : null);
    await expect(seedDemo()).rejects.toThrow(/Refusing pre-existing/);
    expect(fake.signUp).not.toHaveBeenCalled();
    expect(fake.updateUser).not.toHaveBeenCalled();
    expect(fake.writeFile).not.toHaveBeenCalled();
  });

  it('keeps matching seed-owned accounts unchanged and writes the configured private URL', async () => {
    fake.findUser.mockImplementation(async ({ where }: { where: { email: string } }) => ({ id: where.email, email: where.email, demo: true, role: where.email.startsWith('admin@') ? 'admin' : 'user' }));
    fake.findUserOrThrow.mockResolvedValue({ id: 'demo-user' });
    fake.findStudySession.mockResolvedValue({ id: 'seed-demo-initial-v1' });
    fake.readFile.mockResolvedValue('- admin@ruslearn.test / existing-test-placeholder');
    await seedDemo();
    expect(fake.signUp).not.toHaveBeenCalled();
    expect(fake.updateUser).not.toHaveBeenCalled();
    expect(fake.writeFile).toHaveBeenCalledWith('.local/demo-access.md', expect.stringContaining('地址：http://localhost:4187'), { mode: 0o600 });
  });

  it('refuses any seed work outside explicit demo mode', async () => {
    fake.runtime.mockReturnValue({ demoMode: false, baseURL: 'http://localhost:4187' });
    await expect(seedDemo()).rejects.toThrow(/outside explicit DEMO_MODE/);
    expect(fake.findUser).not.toHaveBeenCalled();
  });
});

describe('bounded JSON body reader', () => {
  function streamRequest(chunks: Uint8Array[], headers: HeadersInit = {}) {
    let reads = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { if (reads < chunks.length) controller.enqueue(chunks[reads++]); else controller.close(); },
      cancel,
    }, { highWaterMark: 0 });
    const request = new Request('http://localhost/api/test', { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' });
    return { request, cancel, reads: () => reads };
  }

  const headerCases: Record<string, string>[] = [{}, { 'Content-Length': '1' }];
  it.each(headerCases)('cancels a chunked oversized body without reading remaining chunks: %j', async headers => {
    const source = streamRequest([new Uint8Array(4), new Uint8Array(8), new Uint8Array(50)], headers);
    await expect(readJson(source.request, 8)).rejects.toMatchObject({ status: 413 });
    expect(source.cancel).toHaveBeenCalledTimes(1);
    expect(source.reads()).toBe(2);
  });

  it('decodes UTF-8 split across chunks and measures encoded bytes', async () => {
    const encoded = new TextEncoder().encode(JSON.stringify({ russian: 'ёж', chinese: '书' }));
    const source = streamRequest([...encoded].map(byte => Uint8Array.of(byte)));
    await expect(readJson(source.request, encoded.byteLength)).resolves.toEqual({ russian: 'ёж', chinese: '书' });
    const smaller = streamRequest([encoded]);
    await expect(readJson(smaller.request, encoded.byteLength - 1)).rejects.toMatchObject({ status: 413 });
  });

  it('cancels an explicitly oversized body before reading bytes', async () => {
    const source = streamRequest([new Uint8Array(20)], { 'Content-Length': '20' });
    await expect(readJson(source.request, 8)).rejects.toMatchObject({ status: 413 });
    expect(source.cancel).toHaveBeenCalledTimes(1);
    expect(source.reads()).toBe(0);
  });

  it('rejects malformed or absent JSON without returning partial data', async () => {
    await expect(readJson(new Request('http://localhost', { method: 'POST', body: '{invalid' }))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(new Request('http://localhost', { method: 'POST' }))).rejects.toMatchObject({ status: 400 });
  });
});
