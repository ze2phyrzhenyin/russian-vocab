import {ZodError} from 'zod';
import {handleApi} from '@/server/api';
import {HttpError} from '@/server/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handler(request:Request,context:{params:Promise<{path:string[]}>}){
  try{return await handleApi(request,(await context.params).path)}catch(error){
    if(error instanceof HttpError)return Response.json({error:error.message},{status:error.status});
    if(error instanceof ZodError)return Response.json({error:'提交内容不正确。',details:error.issues.map(i=>({path:i.path,message:i.message}))},{status:400});
    console.error('API operation failed',error instanceof Error?error.name:'UnknownError');
    return Response.json({error:'暂时无法完成操作，请稍后重试。'},{status:500});
  }
}
export {handler as GET,handler as POST,handler as PATCH,handler as DELETE};
