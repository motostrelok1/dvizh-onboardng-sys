import { lazy, Suspense, useEffect, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import { api } from "../admin/api";
import { enqueueEvent } from "../events";
const RichLessonView = lazy(() => import("../editor/RichLessonView").then(m => ({ default: m.RichLessonView })));
type Lesson = { id: string; title: string; textContent: string|null; contentBlocks?: PartialBlock[]|null; videoProvider: string|null; videoRef: string|null };
type Attachment = { id: string; file_name: string; size_bytes: number };
const errors: Record<string,string> = {deadline_passed:"Срок доступа к курсу истёк.",not_assigned:"Этот курс вам не назначен.",not_enrolled:"Сначала запишитесь на курс.",not_found:"Блок не найден."};
export function LessonScreen({lessonId}:{lessonId:string;onBack:()=>void}){
  const [data,setData]=useState<{lesson:Lesson;attachments:Attachment[]}|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{let live=true;setData(null);setError(null);
    api.get<{lesson:Lesson;attachments:Attachment[]}>(`/lessons/${lessonId}`).then(d=>{if(live)setData(d)}).catch(e=>{if(live)setError(e.message)});
    return()=>{live=false};
  },[lessonId]);
  useEffect(()=>{if(!data||data.lesson.id!==lessonId)return;
    const start=performance.now();enqueueEvent({eventType:"lesson_view_start",entityId:lessonId});
    return()=>enqueueEvent({eventType:"lesson_view_end",entityId:lessonId,payload:{durationMs:Math.min(2147483647,Math.max(0,Math.round(performance.now()-start)))}});},[data,lessonId]);
  return <article className="dv-learning-content-card">
    {error&&<p role="alert">{errors[error]??"Не удалось открыть блок."}</p>}
    {!data&&!error&&<p role="status">Загрузка блока…</p>}
    {data&&<><h1 className="dv-learning-lesson-title">{data.lesson.title}</h1>
      <VideoPlayer provider={data.lesson.videoProvider} videoRef={data.lesson.videoRef}/>
      {(data.lesson.contentBlocks?.length||data.lesson.textContent)&&<Suspense fallback={<p>Загрузка материала…</p>}>
        <RichLessonView key={data.lesson.id} contentBlocks={data.lesson.contentBlocks} textContent={data.lesson.textContent}/>
      </Suspense>}
      {data.attachments.length>0&&<section className="dv-learning-attachments"><h3>♧ Дополнительные материалы</h3><div className="dv-learning-files">
        {data.attachments.map(a=><a key={a.id} className="dv-learning-file" href={`/api/attachments/${a.id}/download`} download>
          <span className="dv-learning-file-icon">▧</span><span className="dv-learning-file-name">{a.file_name}<small>{Math.ceil(a.size_bytes/1024)} КБ</small></span><span className="dv-learning-download">↓</span>
        </a>)}
      </div></section>}
    </>}
  </article>;
}
function VideoPlayer({provider,videoRef}:{provider:string|null;videoRef:string|null}){
  if(!provider||!videoRef)return null;
  if(provider==="vimeo")return <div className="dv-learning-video"><iframe title="Видео блока" src={`https://player.vimeo.com/video/${videoRef}`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen /></div>;
  if(provider==="self_hosted")return <video controls className="dv-learning-video-native"><source src={videoRef}/></video>;
  return <p>Видео ({provider}): {videoRef} — воспроизведение для этого провайдера пока не поддерживается.</p>;
}
