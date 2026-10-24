import {betterAuth} from 'better-auth';
import {prismaAdapter} from 'better-auth/adapters/prisma';
import {db} from './db';
import {readRuntimeConfig} from './config';
const config=readRuntimeConfig();
export const auth=betterAuth({
  database:prismaAdapter(db,{provider:'postgresql'}),
  secret:process.env.BETTER_AUTH_SECRET,
  baseURL:config.baseURL,
  // Browser cookies ignore ports; local and SSH-forwarded demos must not overwrite one another.
  advanced:{cookiePrefix:`slovo-${new URL(config.baseURL).port||'app'}`},
  trustedOrigins:[config.baseURL],
  emailAndPassword:{enabled:true,minPasswordLength:10,requireEmailVerification:false},
  user:{additionalFields:{role:{type:'string',defaultValue:'user',input:false},timeZone:{type:'string',defaultValue:'Asia/Shanghai',input:false}}},
  session:{expiresIn:60*60*24*7,updateAge:60*60*24},
  rateLimit:{enabled:true,window:60,max:100},
});
