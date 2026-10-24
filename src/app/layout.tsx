import type {Metadata,Viewport} from 'next';
import './globals.css';
export const metadata:Metadata={title:'俄语拾词 · Slovo',description:'按册、按课，记住每一个俄语词。',manifest:'/manifest.webmanifest',icons:{icon:'/icon.svg'},appleWebApp:{capable:true,statusBarStyle:'default',title:'俄语拾词'}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#f6f3ec'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
