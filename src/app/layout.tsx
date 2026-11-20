import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
export const metadata: Metadata = {
  title:"Anima — твоё место в мире аниме",
  description:"Больше 28 000 аниме, любимые истории в коллекции, свой профиль и комнаты совместного просмотра до 50 друзей. Открой свою вселенную в Anima.",
  applicationName:"Anima",
  icons:{icon:"/icon.svg"},
};
export const viewport:Viewport={width:"device-width",initialScale:1,themeColor:"#111313"};
export default function RootLayout({children}:{children:ReactNode}) {return <html lang="ru"><body>{children}</body></html>;}
