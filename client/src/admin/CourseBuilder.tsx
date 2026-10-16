import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import { api } from "./api";
import { CoursePreview } from "./CoursePreview";
import { CourseAnalyticsSettings } from "./CourseAnalyticsSettings";
import { TestBlock } from "./TestBlock";
import "./course-builder.css";

const RichEditor = lazy(() => import("../editor/BlockLessonEditor").then(m => ({ default: m.BlockLessonEditor })));
type Attachment = { id:string; file_name:string; size_bytes:number };
type Test = { id:string; max_attempts:number|null; show_correct_answers:boolean; pass_score:number };
type Lesson = { id:string;title:string;position:number;text_content:string|null;content_blocks?:PartialBlock[]|null;content_revision?:number;video_provider:string|null;video_ref:string|null;attachments:Attachment[];test:Test|null };
type Module = { id:string;title:string;position:number;test:Test|null;lessons:Lesson[] };
type Course = { id:string;title:string;description:string|null;status:string;visibility:string };
type Tree = { course:Course;modules:Module[] };
type Panel = "text"|"video"|"files"|"test"|"settings";

export function CourseBuilder({courseId,onBack}:{courseId:string;onBack:()=>void}) {
  const [tree,setTree]=useState<Tree|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [activeLesson,setActiveLesson]=useState<string|null>(null);
  const [activeModule,setActiveModule]=useState<string|null>(null);
  const [panel,setPanel]=useState<Panel>("text");
  const [preview,setPreview]=useState(false);
  const [moduleDraft,setModuleDraft]=useState("");
  const [lessonDraft,setLessonDraft]=useState<Record<string,string>>({});
  const [openModules,setOpenModules]=useState<Record<string,boolean>>({});
  const [dragged,setDragged]=useState<{kind:"module"|"lesson";id:string;moduleId?:string}|null>(null);
  const [showAnalytics,setShowAnalytics]=useState(false);

  async function reload(preferLesson?:string) {
    const result=await api.get<Tree>(`/admin/courses/${courseId}/tree`);
    setTree(result);
    const first=result.modules.flatMap(m=>m.lessons)[0]?.id??null;
    setActiveLesson(old => {
      const wanted=preferLesson??old;
      return result.modules.some(m=>m.lessons.some(l=>l.id===wanted))?wanted:first;
    });
    setActiveModule(old => result.modules.some(m=>m.id===old)?old:(result.modules[0]?.id??null));
  }
  useEffect(()=>{ let current=true; api.get<Tree>(`/admin/courses/${courseId}/tree`).then(d=>{
    if(!current)return;setTree(d);setActiveModule(d.modules[0]?.id??null);
    setActiveLesson(d.modules.flatMap(m=>m.lessons)[0]?.id??null);
  }).catch(e=>{if(current)setError(String(e))});return()=>{current=false}; },[courseId]);
  const selection=useMemo(()=>{
    for(const m of tree?.modules??[]) {
      const l=m.lessons.find(l=>l.id===activeLesson);
      if(l)return {module:m,lesson:l};
    }
    return null;
  },[tree,activeLesson]);
  async function act(fn:()=>Promise<unknown>,message="Не удалось выполнить действие") {
    if(busy)return;
    setBusy(true);setError("");
    try{await fn();await reload();}
    catch(e){setError(e instanceof Error?e.message:message)}
    finally{setBusy(false)}
  }
  async function addModule(e:React.FormEvent){e.preventDefault();const title=moduleDraft.trim();if(!title)return;
    await act(async()=>{await api.post(`/admin/courses/${courseId}/modules`,{title});setModuleDraft("")});
  }
  async function addLesson(e:React.FormEvent,moduleId:string){e.preventDefault();const title=lessonDraft[moduleId]?.trim();if(!title)return;
    await act(async()=>{const r=await api.post<{lesson:Lesson}>(`/admin/modules/${moduleId}/lessons`,{title});
      setLessonDraft(d=>({...d,[moduleId]:""}));setActiveLesson(r.lesson.id);setActiveModule(moduleId);setPanel("text");
      await reload(r.lesson.id);
    });
  }
  async function moveModule(moduleId:string,direction:-1|1) {
    if(!tree)return;const ids=tree.modules.map(m=>m.id);const i=ids.indexOf(moduleId),j=i+direction;
    if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];
    await act(()=>api.post("/admin/modules/reorder",{courseId,orderedIds:ids}));
  }
  async function moveLesson(moduleId:string,id:string,direction:-1|1) {
    const m=tree?.modules.find(m=>m.id===moduleId);if(!m)return;
    const ids=m.lessons.map(l=>l.id),i=ids.indexOf(id),j=i+direction;
    if(j<0||j>=ids.length)return;[ids[i],ids[j]]=[ids[j],ids[i]];
    await act(()=>api.post("/admin/lessons/reorder",{moduleId,orderedIds:ids}));
  }
  async function dropOn(kind:"module"|"lesson",targetId:string,moduleId?:string) {
    if(!dragged||dragged.kind!==kind||dragged.id===targetId||busy||!tree)return;
    if(kind==="lesson"&&dragged.moduleId!==moduleId)return;
    const ids=kind==="module"?tree.modules.map(m=>m.id):tree.modules.find(m=>m.id===moduleId)?.lessons.map(l=>l.id)??[];
    const from=ids.indexOf(dragged.id),to=ids.indexOf(targetId);
    if(from<0||to<0)return;ids.splice(to,0,ids.splice(from,1)[0]);setDragged(null);
    await act(()=>api.post(kind==="module"?"/admin/modules/reorder":"/admin/lessons/reorder",
      kind==="module"?{courseId,orderedIds:ids}:{moduleId,orderedIds:ids}));
  }
  if(preview)return <CoursePreview courseId={courseId} onBack={()=>setPreview(false)}/>;
  if(!tree)return <section className="lms-builder-loading" role="status">{error||"Загружаем редактор…"}</section>;
  const current=selection?.lesson;
  return <section className="lms-builder">
    <header className="lms-builder-header">
      <div><button className="lms-builder-back" type="button" onClick={onBack}>← К списку курсов</button>
        <h2>{tree.course.title}</h2><p>Создание и оформление учебных материалов</p></div>
      <div className="lms-builder-header-actions">
        <span className={`lms-builder-state ${tree.course.status==="published"?"is-published":""}`}>{tree.course.status==="published"?"● Опубликован":tree.course.status==="draft"?"● Черновик":"● Архив"}</span>
        <button type="button" onClick={()=>setPreview(true)}>◉ Предпросмотр курса</button>
        <button type="button" onClick={()=>setShowAnalytics(v=>!v)}>{showAnalytics?"Скрыть аналитику":"⚙ Настройки курса"}</button>
      </div>
    </header>
    {error&&<div role="alert" className="lms-builder-error">{error}<button type="button" onClick={()=>setError("")}>Закрыть</button></div>}
    {showAnalytics&&<div className="lms-builder-course-settings">
      <label>Статус <select value={tree.course.status} disabled={busy} onChange={e=>act(()=>api.patch(`/admin/courses/${courseId}`,{status:e.target.value}))}>
        <option value="draft">Черновик</option><option value="published">Опубликован</option><option value="archived">Архив</option>
      </select></label>
      <label>Доступ <select value={tree.course.visibility} disabled={busy} onChange={e=>act(()=>api.patch(`/admin/courses/${courseId}`,{visibility:e.target.value}))}>
        <option value="assigned_only">По назначению</option><option value="open_catalog">Открытый каталог</option>
      </select></label>
      <CourseAnalyticsSettings courseId={courseId}/>
    </div>}
    <div className="lms-builder-columns">
      <aside className="lms-builder-navigation" aria-label="Модули и уроки">
        <div className="lms-builder-column-title"><h3>Модули и уроки</h3></div>
        {tree.modules.map((m,i)=><div key={m.id} className="lms-builder-module"
          onDragOver={e=>{if(dragged?.kind==="module")e.preventDefault()}}
          onDrop={e=>{if(dragged?.kind==="module"){e.preventDefault();void dropOn("module",m.id)}}}>
          <div className="lms-builder-module-heading">
            <span draggable aria-label="Перетащить модуль" title="Перетащить модуль" onDragStart={e=>{e.dataTransfer.effectAllowed="move";setDragged({kind:"module",id:m.id})}} onDragEnd={()=>setDragged(null)}>⠿</span>
            <button type="button" className="lms-builder-module-name" aria-expanded={openModules[m.id]!==false}
              onClick={()=>{setActiveModule(m.id);setOpenModules(o=>({...o,[m.id]:o[m.id]===false}))}}>
              {openModules[m.id]===false?"▸":"▾"} {i+1}. {m.title} <small>{m.lessons.length}</small>
            </button>
            <div className="lms-builder-compact">
              <button type="button" aria-label="Модуль выше" disabled={busy||i===0} onClick={()=>void moveModule(m.id,-1)}>↑</button>
              <button type="button" aria-label="Модуль ниже" disabled={busy||i===tree.modules.length-1} onClick={()=>void moveModule(m.id,1)}>↓</button>
              <button type="button" aria-label="Удалить модуль" className="danger" onClick={()=>{if(confirm("Удалить модуль и все его уроки?"))void act(()=>api.delete(`/admin/modules/${m.id}`))}}>×</button>
            </div>
          </div>
          {openModules[m.id]!==false&&<div className="lms-builder-module-body">
            {m.lessons.map((l,j)=><div className={`lms-builder-lesson-row ${l.id===activeLesson?"selected":""}`} key={l.id}
              onDragOver={e=>{if(dragged?.kind==="lesson"&&dragged.moduleId===m.id)e.preventDefault()}}
              onDrop={e=>{if(dragged?.kind==="lesson"){e.preventDefault();e.stopPropagation();void dropOn("lesson",l.id,m.id)}}}>
              <span draggable title="Перетащить урок" onDragStart={e=>{e.dataTransfer.effectAllowed="move";setDragged({kind:"lesson",id:l.id,moduleId:m.id})}} onDragEnd={()=>setDragged(null)}>⠿</span>
              <button type="button" aria-current={l.id===activeLesson?"true":undefined} onClick={()=>{setActiveLesson(l.id);setActiveModule(m.id);setPanel("text")}}>
                <span>▤</span> {i+1}.{j+1} {l.title}</button>
              <div className="lms-builder-compact">
                <button aria-label="Урок выше" disabled={busy||j===0} onClick={()=>void moveLesson(m.id,l.id,-1)}>↑</button>
                <button aria-label="Урок ниже" disabled={busy||j===m.lessons.length-1} onClick={()=>void moveLesson(m.id,l.id,1)}>↓</button>
              </div>
            </div>)}
            <form onSubmit={e=>void addLesson(e,m.id)} className="lms-builder-add-form">
              <input aria-label={`Название нового урока в модуле ${m.title}`} placeholder="Название нового урока" required value={lessonDraft[m.id]??""} onChange={e=>setLessonDraft(v=>({...v,[m.id]:e.target.value}))}/>
              <button type="submit" disabled={busy||!(lessonDraft[m.id]??"").trim()}>+ Урок</button>
            </form>
            <div className="lms-builder-module-test"><TestBlock test={m.test} scope="module" parentId={m.id} onReload={()=>void reload()}/></div>
          </div>}
        </div>)}
        <form onSubmit={e=>void addModule(e)} className="lms-builder-add-form lms-builder-add-module">
          <input placeholder="Новый модуль" aria-label="Название нового модуля" value={moduleDraft} required onChange={e=>setModuleDraft(e.target.value)}/>
          <button type="submit" disabled={busy||!moduleDraft.trim()}>+ Добавить модуль</button>
        </form>
      </aside>
      <main className="lms-builder-main">
        {selection&&current?<><div className="lms-builder-lesson-head">
          <div><small>Урок в модуле «{selection.module.title}»</small><h3>{current.title}</h3></div>
          <button type="button" className="danger" onClick={()=>{if(confirm("Удалить урок без возможности восстановления?"))void act(()=>api.delete(`/admin/lessons/${current.id}`))}}>Удалить урок</button>
        </div>
        <div className="lms-builder-block-list" aria-label="Состав урока">
          <button className={panel==="text"?"active":""} onClick={()=>setPanel("text")}><span className="icon">▤</span><span><b>Текст и оформление</b><small>BlockNote, таблицы, изображения и учебные блоки</small></span><span>✎</span></button>
          <button className={panel==="video"?"active":""} onClick={()=>setPanel("video")}><span className="icon">▶</span><span><b>Видео</b><small>{current.video_ref||"Не добавлено"}</small></span><span>⚙</span></button>
          <button className={panel==="test"?"active":""} onClick={()=>setPanel("test")}><span className="icon">☑</span><span><b>Тест</b><small>{current.test?`Проходной балл ${current.test.pass_score}%`:"Не добавлен"}</small></span><span>⚙</span></button>
          <button className={panel==="files"?"active":""} onClick={()=>setPanel("files")}><span className="icon">📎</span><span><b>Дополнительные материалы</b><small>{current.attachments.length} файлов</small></span><span>⚙</span></button>
        </div>
        <div className="lms-builder-content">
          {panel==="text"?<><div className="lms-builder-content-title"><strong>Редактор текста</strong><small>Добавляйте блоки через /, вставляйте фотографии и эмодзи</small></div>
          <Suspense fallback={<p>Загружаем BlockNote…</p>}><RichEditor key={current.id} lessonId={current.id} contentBlocks={current.content_blocks??null} textContent={current.text_content} contentRevision={current.content_revision??0}/></Suspense></>:
          panel==="video"?<div className="lms-builder-empty">Управление видео находится в панели справа →</div>:
          panel==="files"?<div className="lms-builder-files">{current.attachments.map(a=><p key={a.id}>📎 {a.file_name} · {Math.ceil(a.size_bytes/1024)} КБ</p>)}{current.attachments.length===0&&"Материалов пока нет. Добавьте их справа."}</div>:
          panel==="test"?<TestBlock test={current.test} scope="lesson" parentId={current.id} onReload={()=>void reload()}/>:
          <p>Выберите раздел содержимого.</p>}
        </div></>:<div className="lms-builder-empty">Выберите урок слева или создайте новый.</div>}
      </main>
      <aside className="lms-builder-inspector" aria-label="Настройки выбранного раздела">
        {current?<LessonInspector key={current.id} lesson={current} panel={panel} onPanel={setPanel} onReload={()=>void reload()} />:
          <p>Выберите урок для редактирования настроек.</p>}
      </aside>
    </div>
  </section>;
}

function LessonInspector({lesson,panel,onPanel,onReload}:{lesson:Lesson;panel:Panel;onPanel:(panel:Panel)=>void;onReload:()=>void}) {
  const [title,setTitle]=useState(lesson.title);
  const [provider,setProvider]=useState(lesson.video_provider??"");
  const [video,setVideo]=useState(lesson.video_ref??"");
  const [uploading,setUploading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{setTitle(lesson.title);setProvider(lesson.video_provider??"");setVideo(lesson.video_ref??"")},[lesson.id,lesson.title,lesson.video_provider,lesson.video_ref]);
  async function save(){setSaving(true);setError("");try{
    await api.patch(`/admin/lessons/${lesson.id}`,{title,videoProvider:provider||null,videoRef:video||null});onReload();
  }catch(e){setError(String(e))}finally{setSaving(false)}}
  async function upload(e:React.ChangeEvent<HTMLInputElement>){
    const file=e.currentTarget.files?.[0];if(!file)return;setUploading(true);setError("");
    try{const form=new FormData();form.append("file",file);const res=await fetch(`/api/admin/lessons/${lesson.id}/attachments`,{method:"POST",body:form,cache:"no-store"});
      const result=await res.json();if(!res.ok)throw new Error(result.error||"Ошибка загрузки");onReload();
    }catch(e){setError(String(e))}finally{e.currentTarget.value="";setUploading(false)}
  }
  async function removeFile(id:string){if(!confirm("Удалить файл?"))return;try{await api.delete(`/admin/attachments/${id}`);onReload()}catch(e){setError(String(e))}}
  return <><div className="lms-builder-inspector-tabs"><button className={panel==="settings"?"active":""} onClick={()=>onPanel("settings")}>Параметры урока</button><button className={panel!=="settings"?"active":""} onClick={()=>{if(panel==="settings")onPanel("text")}}>Настройки блока</button></div>
    {error&&<p role="alert" className="lms-form-error">{error}</p>}
    <div className="lms-builder-inspector-fields">
      <h3>{panel==="video"?"Видео":panel==="files"?"Вложения":panel==="test"?"Тест":panel==="text"?"Текст": "Параметры урока"}</h3>
      <label>Название урока<input value={title} onChange={e=>setTitle(e.target.value)} /></label>
      {panel==="video"&&<><label>Источник видео<select value={provider} onChange={e=>setProvider(e.target.value)}>
        <option value="">Без видео</option><option value="vimeo">Vimeo</option><option value="cloudflare_stream">Cloudflare Stream</option><option value="self_hosted">Свой хостинг</option>
      </select></label><label>Ссылка или идентификатор<input value={video} onChange={e=>setVideo(e.target.value)} placeholder="Идентификатор видео"/></label></>}
      {panel==="files"&&<><label>Добавить файл<input type="file" disabled={uploading} onChange={e=>void upload(e)}/></label>{lesson.attachments.map(a=><div className="lms-builder-file" key={a.id}><span>{a.file_name}</span><button type="button" className="danger" onClick={()=>void removeFile(a.id)}>Удалить</button></div>)}</>}
      {panel==="text"&&<p className="lms-builder-help">Выделите текст, чтобы открыть панель форматирования. Введите / для вставки блока. Автосохранение текста работает отдельно от параметров урока.</p>}
      {panel==="test"&&<p className="lms-builder-help">Добавляйте вопросы и меняйте проходной балл в центральной панели.</p>}
      <button type="button" className="lms-builder-primary" disabled={saving||!title.trim()} onClick={()=>void save()}>{saving?"Сохраняем…":"Сохранить параметры"}</button>
    </div>
  </>;
}
