"use client";
import { createContext, useContext } from "react";
import type { Anime, Profile } from "@/lib/types";
export type AppState = { user:Profile|null; loadingUser:boolean; setUser:(user:Profile|null)=>void; openAuth:()=>void; notify:(message:string)=>void; saved:Set<number>; toggleSave:(anime:Anime)=>void };
export const AppContext=createContext<AppState>({user:null,loadingUser:true,setUser:()=>{},openAuth:()=>{},notify:()=>{},saved:new Set(),toggleSave:()=>{}});
export const useApp=()=>useContext(AppContext);
