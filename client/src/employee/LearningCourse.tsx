import { useEffect, useMemo, useState } from "react";
import { api } from "../admin/api";
import { LessonScreen } from "./LessonScreen";
import { TestScreen } from "./TestScreen";
import "./course-learning.css";
type Test = { id: string; pass_score: number };
type Lesson = { id: string; title: string; test: Test | null };
type Module = { id: string; title: string; test: Test | null; lessons: Lesson[] };
type Data = { course: { title: string; description: string | null }; assignment: { deadline: string | null }; modules: Module[] };
const errors:Record<string,string> = {deadline_passed:"Срок доступа к курсу истёк.",not_assigned:"Курс вам не назначен.",not_enrolled:"Сначала запишитесь на курс.",not_found:"Курс не найден."};
export function LearningCourse({ courseId, onBack }: { courseId: string; onBack: () => void }) {
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState<string|null>(null);
  const [current,setCurrent]=useState<string|null>(null),[test,setTest]=useState<string|null>(null);
  useEffect(()=>{let alive=true;setData(null);setCurrent(null);setTest(null);setError(null);
    api.get<Data>(`/me/courses/${courseId}`).then(v=>{if(alive)setData(v)}).catch(e=>{if(alive)setError(e.message)});
    return()=>{alive=false};
  },[courseId]);
  const blocks=useMemo(()=>data?.modules.flatMap(m=>m.lessons)??[],[data]);
  const idx=blocks.findIndex(l=>l.id===current);
  function choose(id:string){setTest(null);setCurrent(id);window.scrollTo({top:0,behavior:"smooth"})}
  if(error)return <div className="dv-learning-shell"><p role="alert">{errors[error]??"Не удалось открыть курс."}</p><button onClick={onBack}>К моим курсам</button></div>;
  if(!data)return <div className="dv-learning-shell" role="status">Загрузка курса…</div>;
  return <div className="dv-learning-shell">
    <header className="dv-learning-top"><b>DVIZH</b><span>Академия обучения</span><span className="dv-learning-top-location">Мои курсы / {data.course.title}</span></header>
    <div className="dv-learning-layout">
      <aside className="dv-learning-sidebar">
        <button className="dv-learning-back-link" onClick={onBack}>← К моим курсам</button>
        <div className="dv-learning-course-overview"><span className="dv-learning-course-glyph">▤</span><div><h2>{data.course.title}</h2><p>{blocks.length} блоков</p></div></div>
        {data.assignment.deadline&&<p className="dv-learning-deadline">Срок: {new Date(data.assignment.deadline).toLocaleDateString("ru-RU")}</p>}
        <nav aria-label="Навигация по блокам">
          {data.modules.map(m=><div className="dv-learning-module" key={m.id}><h3>{m.title}</h3>
            {m.lessons.map(l=><button type="button" key={l.id} className={`dv-learning-nav-item ${l.id===current?"active":""}`} aria-current={l.id===current?"step":undefined} onClick={()=>choose(l.id)}>
              <span className="dv-learning-number">{blocks.findIndex(b=>b.id===l.id)+1}</span><span className="dv-learning-nav-label">{l.title}</span><span aria-hidden="true">▤</span>
            </button>)}
            {m.test&&<button className="dv-learning-test-link" onClick={()=>{setCurrent(null);setTest(m.test!.id)}}>☑ Тест модуля · {m.test.pass_score}%</button>}
          </div>)}
        </nav>
      </aside>
      <main className="dv-learning-main">
        <div className="dv-learning-page-bar">
          <button className="dv-learning-outline" onClick={()=>{setCurrent(null);setTest(null)}}>← Назад к курсу</button>
          {idx>=0&&<div className="dv-learning-position">Блок {idx+1} из {blocks.length}<span className="dv-learning-track"><span style={{width:`${(idx+1)/blocks.length*100}%`}}/></span><strong>{Math.round((idx+1)/blocks.length*100)}%</strong></div>}
        </div>
        {test?<div className="dv-learning-content-card"><TestScreen testId={test} onBack={()=>setTest(null)}/></div>:
          idx>=0?<LessonScreen lessonId={blocks[idx].id} onBack={()=>setCurrent(null)}/>:
          <article className="dv-learning-content-card dv-learning-intro"><span className="dv-learning-eyebrow">Учебный курс</span><h1>{data.course.title}</h1>{data.course.description&&<p>{data.course.description}</p>}
            {blocks.length?<button className="dv-learning-primary" onClick={()=>choose(blocks[0].id)}>Начать с первого блока →</button>:<p>В этом курсе пока нет блоков.</p>}
          </article>}
        {idx>=0&&<div className="dv-learning-footer">
          <button className="dv-learning-outline" disabled={idx===0} onClick={()=>choose(blocks[idx-1].id)}>← Предыдущий блок</button>
          {idx+1<blocks.length?<button className="dv-learning-primary" onClick={()=>choose(blocks[idx+1].id)}>Следующий блок →</button>:
            <button className="dv-learning-primary" onClick={()=>setCurrent(null)}>К обзору курса ✓</button>}
        </div>}
      </main>
    </div>
  </div>;
}
