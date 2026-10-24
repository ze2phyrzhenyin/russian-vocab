import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '@/generated/prisma/client';
const globalDb = globalThis as unknown as {slovoDb?:PrismaClient};
export const db = globalDb.slovoDb ?? new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,max:5})});
if(process.env.NODE_ENV!=='production')globalDb.slovoDb=db;
