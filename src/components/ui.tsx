"use client";
import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { Bookmark, Check, Play, Star, X, LoaderCircle } from "lucide-react";
import type { Anime } from "@/lib/types";
import { useApp } from "./app-context";
/** Preset emoji avatars were removed — profiles use a uploaded photo or a letter mark. */
export function Brand({compact=false}:{compact?:boolean}) {return <Link href="/" className={`brand ${compact?"compact":""}`} aria-label="Anima — главная"><svg viewBox="0 0 34 36" fill="none" aria-hidden="true"><path d="M18 2 30 8 20 17 33 22 26 34 16 22 9 35 0 26 12 17 1 11 8 0 18 12Z" fill="currentColor"/></svg>{!compact&&<span>anima<span className="brand-dot">.</span></span>}</Link>}
export function Avatar({value="",size=40,className="",label=""}:{value?:string;size?:number;className?:string;label?:string}) {
 const custom=value.startsWith("data:image");
 const letter=(label||"").trim().charAt(0).toUpperCase()||"✦";
 return <span className={`avatar ${custom?"avatar-custom":"avatar-letter"} ${className}`} style={{width:size,height:size,fontSize:Math.round(size*.4)}} title={label||undefined} aria-label={label?`Аватар: ${label}`:"Аватар"}>{custom?<img src={value} alt={label?`Аватар ${label}`:"Аватар пользователя"}/>:letter}</span>;
}
export function Modal({children,onClose,className="",label}:{children:ReactNode;onClose:()=>void;className?:string;label:string}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement; const overflow=document.body.style.overflow;document.body.style.overflow="hidden";ref.current?.focus();const handler=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();if(e.key==="Tab"){const nodes=ref.current?.querySelectorAll<HTMLElement>('button,a,input,select,textarea,[tabindex="0"]');if(!nodes?.length)return; const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};window.addEventListener("keydown",handler);return()=>{document.body.style.overflow=overflow;window.removeEventListener("keydown",handler);previous?.focus();};},[onClose]);
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}><button className="icon-button modal-close" onClick={onClose} aria-label="Закрыть"><X size={20}/></button>{children}</div></div>;
}
export function AnimeCard({anime,index}:{anime:Anime;index?:number}) {
 const {saved,toggleSave}=useApp();
 return <article className="anime-card"><Link className="poster" href={`/anime/${anime.id}`}><img src={anime.image} alt={anime.title} loading="lazy" onError={e=>{const image=e.currentTarget;if(!image.dataset.fallback){image.dataset.fallback="true";image.src="/images/poster-placeholder.svg";}}}/><span className="score"><Star size={11} fill="currentColor"/>{anime.score?anime.score.toFixed(1):"NEW"}</span>{anime.badge&&<span className="card-badge">{anime.badge}</span>}<span className="poster-shade"/><span className="poster-play"><Play size={23} fill="currentColor"/></span><span className="episode-label">{anime.status==="ONGOING"&&<i/>}{anime.episodes===1?"Полнометражный фильм":`${anime.aired || anime.episodes || "?"} ${anime.status==="ONGOING"?"серий":"из "+(anime.episodes||"?")+" серий"}`}</span></Link><button className={`card-save ${saved.has(anime.id)?"is-saved":""}`} aria-label={saved.has(anime.id)?"Убрать из избранного":"Добавить в избранное"} onClick={()=>toggleSave(anime)}>{saved.has(anime.id)?<Check size={16}/>:<Bookmark size={16}/>}</button><div className="card-copy"><Link href={`/anime/${anime.id}`} title={anime.title}>{anime.title}</Link><p>{anime.year||"Скоро"}<span>·</span>{anime.genres[0]||"Аниме"}{typeof index==="number"&&<small>#{String(index+1).padStart(2,"0")}</small>}</p></div></article>;
}
export function Loading({text="Загружаем историю…"}:{text?:string}) {return <div className="loading-state"><LoaderCircle size={26} className="spin"/><p>{text}</p></div>;}
export function EmptyState({icon, title, children, action}:{icon:ReactNode;title:string;children:ReactNode;action?:ReactNode}) {return <div className="empty-state"><span className="empty-icon">{icon}</span><h2>{title}</h2><p>{children}</p>{action}</div>;}
