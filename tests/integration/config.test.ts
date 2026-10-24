import { describe, expect, it } from 'vitest';
import { readRuntimeConfig } from '../../src/lib/config';

const localDemo: NodeJS.ProcessEnv = { NODE_ENV: 'test', APP_ENV: 'development', DEMO_MODE: 'true', DATABASE_URL: 'postgresql://slovo:test-only@localhost:55486/slovo_demo', BETTER_AUTH_SECRET: 'test-only-'.repeat(8), BETTER_AUTH_URL: 'http://localhost:4186' };

describe('runtime demo environment boundaries', () => {
  it('allows explicitly isolated local demo and non-demo production configuration', () => {
    expect(readRuntimeConfig(localDemo).demoMode).toBe(true);
    expect(readRuntimeConfig({ ...localDemo, APP_ENV: 'production', DEMO_MODE: 'false', DATABASE_URL: 'postgresql://slovo:test-only@localhost:55486/production' }).demoMode).toBe(false);
  });
  it('fails closed when production tries to enable fixed demo accounts', () => {
    expect(() => readRuntimeConfig({ ...localDemo, APP_ENV: 'production' })).toThrow(/cannot enable DEMO_MODE/);
  });
  it('refuses demo seeds for unrelated databases', () => {
    expect(() => readRuntimeConfig({ ...localDemo, DATABASE_URL: 'postgresql://slovo:test-only@localhost:55486/customer_database' })).toThrow(/dedicated/);
  });
  it('requires an explicit environment and cannot repurpose seeded demo data as production',()=>{
    expect(()=>readRuntimeConfig({...localDemo,APP_ENV:undefined})).toThrow(/APP_ENV/);
    expect(()=>readRuntimeConfig({...localDemo,APP_ENV:'prodution'})).toThrow(/APP_ENV/);
    expect(()=>readRuntimeConfig({...localDemo,APP_ENV:'production',DEMO_MODE:'false'})).toThrow(/demo database/);
    expect(()=>readRuntimeConfig({...localDemo,DATABASE_URL:'postgresql://slovo:local@localhost/notruslearn_dev_production'})).toThrow(/dedicated/);
    expect(()=>readRuntimeConfig({...localDemo,BETTER_AUTH_URL:'javascript:alert(1)'})).toThrow(/HTTP/);
  });
  it('rejects absent, placeholder and short authentication secrets', () => {
    for (const secret of ['', 'short', 'replace-with-a-secret-that-is-still-a-placeholder']) {
      expect(() => readRuntimeConfig({ ...localDemo, BETTER_AUTH_SECRET: secret })).toThrow(/secret/);
    }
    expect(() => readRuntimeConfig({ ...localDemo, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });
});
