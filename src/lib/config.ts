export function readRuntimeConfig(env:NodeJS.ProcessEnv=process.env){
  if(!['development','test','production'].includes(env.APP_ENV??''))throw new Error('APP_ENV must explicitly be development, test or production.');
  const demoMode=env.DEMO_MODE==='true';
  const production=env.APP_ENV==='production';
  if(production&&demoMode)throw new Error('Production cannot enable DEMO_MODE.');
  if(!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length<32 || env.BETTER_AUTH_SECRET.startsWith('replace-'))throw new Error('BETTER_AUTH_SECRET must be a generated secret of at least 32 characters.');
  if(!env.DATABASE_URL)throw new Error('DATABASE_URL is required.');
  const demoDatabase=/^\/(?:slovo_demo(?:_[a-z0-9]+)?|ruslearn_demo(?:_[a-z0-9]+)?|ruslearn_dev)$/.test(new URL(env.DATABASE_URL).pathname);
  if(demoMode&&!demoDatabase)throw new Error('Demo mode requires a dedicated slovo/ruslearn demo database.');
  if(production&&demoDatabase)throw new Error('Production cannot use a demo database containing fixed test accounts.');
  const baseURL=env.BETTER_AUTH_URL||'http://localhost:4186';
  const url=new URL(baseURL);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('BETTER_AUTH_URL must be an HTTP(S) origin.');
  if(production&&url.protocol!=='https:')throw new Error('Production requires an HTTPS origin.');
  return {demoMode,production,baseURL};
}
