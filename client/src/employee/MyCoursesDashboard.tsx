import { useMemo, useState } from "react";
import "./my-courses-dashboard.css";
export type AssignedCourse = { assignment_id:string;course_id:string;title:string;description:string|null;status:string;deadline:string|null;is_required:boolean };
export type CatalogCourse = {course_id:string;title:string;description:string|null};
type Filter = "all"|"active"|"completed";
const labels:Record<string,string>={assigned:"Не начат",in_progress:"В процессе",completed:"Завершён",overdue:"Срок истёк",closed:"Закрыт"};
export function MyCoursesDashboard({assigned,catalog,onOpen,onEnroll,notifications,onLogout,error,busy}:{
 assigned:AssignedCourse[];catalog:CatalogCourse[];onOpen:(id:string)=>void;onEnroll:(id:string)=>void;
 notifications:React.ReactNode;onLogout:()=>void;error:string|null;busy:boolean;
}){
 const [filter,setFilter]=useState<Filter>("all");
 const [search,setSearch]=useState("");
 const completed=assigned.filter(c=>c.status==="completed").length;
 const inProgress=assigned.filter(c=>c.status==="in_progress").length;
 const visible=useMemo(()=>assigned.filter(c=>(filter==="all"||(filter==="completed"?c.status==="completed":c.status!=="completed"))
   &&(c.title+" "+(c.description??"")).toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),[assigned,filter,search]);
 const soonest=assigned.filter(c=>c.deadline&&c.status!=="completed"&&c.status!=="closed")
  .sort((a,b)=>new Date(a.deadline!).getTime()-new Date(b.deadline!).getTime())[0];
 return <div className="dv-home">
   <header className="dv-home-header"><div className="dv-home-brand"><span className="dv-home-mark">◢</span><b>DVIZH</b><small>LMS</small></div>
     <nav aria-label="Главная навигация"><span className="dv-home-current">▣ Мои курсы</span></nav>
     <div className="dv-home-user">{notifications}<button onClick={onLogout}>↪ Выйти</button></div>
   </header>
   <div className="dv-home-container">
    <div className="dv-home-title"><h1>Мои курсы</h1><p>Здесь собраны ваши учебные материалы и программы</p></div>
    {error&&<div className="dv-home-error" role="alert">{error}</div>}
    <div className="dv-home-layout">
     <main className="dv-home-main">
       <div className="dv-home-filters" role="group" aria-label="Фильтр курсов">
         <button className={filter==="all"?"selected":""} aria-pressed={filter==="all"} onClick={()=>setFilter("all")}>▦ Все курсы <span>{assigned.length}</span></button>
         <button className={filter==="active"?"selected":""} aria-pressed={filter==="active"} onClick={()=>setFilter("active")}>◷ Активные <span>{assigned.length-completed}</span></button>
         <button className={filter==="completed"?"selected":""} aria-pressed={filter==="completed"} onClick={()=>setFilter("completed")}>✓ Завершённые <span>{completed}</span></button>
       </div>
       <label className="dv-home-search"><span>⌕</span><input type="search" aria-label="Поиск по курсам" placeholder="Поиск по курсам…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
       <div className="dv-home-courses">
        {visible.map(c=><article key={c.assignment_id} className="dv-home-course">
          <div className="dv-home-course-icon" aria-hidden="true">▤</div>
          <div className="dv-home-course-body"><div className="dv-home-course-title"><h2>{c.title}</h2><span className={`dv-home-status status-${c.status}`}>{labels[c.status]??c.status}</span></div>
            {c.deadline&&<p className="dv-home-date">▦ Срок: {new Date(c.deadline).toLocaleDateString("ru-RU")}</p>}
            {c.description&&<p className="dv-home-description">{c.description}</p>}
            <p className="dv-home-meta">{c.is_required?"Обязательный курс":"Учебный курс"}</p>
          </div>
          <button className="dv-home-open" disabled={c.status==="overdue"||c.status==="closed"} onClick={()=>onOpen(c.course_id)}>{c.status==="assigned"?"Начать":"Открыть"} →</button>
         </article>)}
        {visible.length===0&&<div className="dv-home-empty">{assigned.length?"По выбранному фильтру курсов нет.":"Пока нет назначенных курсов."}</div>}
       </div>
       {catalog.length>0&&<section className="dv-home-catalog"><h2>Открытый каталог</h2>{catalog.map(c=><article key={c.course_id}><div><strong>{c.title}</strong>{c.description&&<p>{c.description}</p>}</div><button disabled={busy} onClick={()=>onEnroll(c.course_id)}>Записаться →</button></article>)}</section>}
     </main>
     <aside className="dv-home-aside">
       <div className="dv-home-promo"><span>ВАШЕ РАЗВИТИЕ</span><h2>Новые знания открывают новые возможности</h2><div aria-hidden="true">✦ ▥ ▰</div></div>
       <section className="dv-home-widget"><h2>▥ Обучение</h2><p className="dv-home-widget-sub">Статус ваших назначенных курсов</p><div className="dv-home-figures"><div><b>{assigned.length}</b><small>Назначено</small></div><div><b>{inProgress}</b><small>В процессе</small></div><div><b>{completed}</b><small>Завершено</small></div></div></section>
       <section className="dv-home-widget"><h2>▦ Сроки</h2>{soonest?<div className="dv-home-deadline"><strong>{soonest.title}</strong><span>{new Date(soonest.deadline!).toLocaleDateString("ru-RU")}</span></div>:<p className="dv-home-widget-sub">Ближайших сроков нет</p>}</section>
       <section className="dv-home-widget dv-home-tips"><h2>💡 Советы по обучению</h2><p>Уделяйте обучению 15–30 минут в день. Изучайте блоки последовательно и закрепляйте знания тестами.</p></section>
     </aside>
    </div>
   </div>
  </div>;
}
