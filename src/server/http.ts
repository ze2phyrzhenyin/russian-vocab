import {auth} from '@/lib/auth';
import {db} from '@/lib/db';
import {readRuntimeConfig} from '@/lib/config';
export class HttpError extends Error { constructor(public status:number,message:string){super(message)} }
export async function requireUser(request:Request){
  const session=await auth.api.getSession({headers:request.headers});
  if(!session)throw new HttpError(401,'请先登录。');
  const user=await db.user.findUnique({where:{id:session.user.id}});
  if(!user)throw new HttpError(401,'登录已失效，请重新登录。');
  return user;
}
export function requireMutationOrigin(request:Request){
  if(['GET','HEAD','OPTIONS'].includes(request.method))return;
  const origin=request.headers.get('origin');
  if(origin!==new URL(readRuntimeConfig().baseURL).origin)throw new HttpError(403,'请求来源不被允许。');
  // DELETE routes carry their resource identity in the path and consume no body.
  if(request.method!=='DELETE'&&!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'请发送 JSON 数据。');
}
export async function readJson(request:Request,maxBytes=256_000){
  const length=Number(request.headers.get('content-length')||0);
  if(length>maxBytes){await request.body?.cancel().catch(()=>{});throw new HttpError(413,'数据过大，请分批保存。');}
  const reader=request.body?.getReader();
  const chunks:Uint8Array[]=[];let size=0;
  if(reader){
    try{
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        size+=value.byteLength;
        if(size>maxBytes){await reader.cancel().catch(()=>{});throw new HttpError(413,'数据过大，请分批保存。');}
        chunks.push(value);
      }
    }finally{reader.releaseLock();}
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder().decode(bytes);
  try{return JSON.parse(text) as unknown}catch{throw new HttpError(400,'JSON 格式不正确。')}
}
