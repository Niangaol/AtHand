import { Link } from 'react-router-dom';
import { Bell, BookOpen, CalendarClock, Wallet } from 'lucide-react';
import { useCampus } from '../../data/CampusProvider';
import { money } from '../../domain/summary';
import { courseWhen, examWhen, nextCourse, nextExam } from './campusSummary';

export function CampusTodayBar() {
  const { status, summary } = useCampus();
  if (!status?.connected) return null;
  const course = nextCourse(summary.courses);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const exam = nextExam(summary.exams, todayKey);
  const notice = summary.notices[0];
  const card = summary.card;
  if (!course && !exam && !notice && !card && !summary.loading) return null;
  return <section className="panel campus-today" aria-label="校园速览">
    <div className="planner-section-title"><h2><BookOpen size={19} />校园</h2><Link className="text-link" to="/campus">打开校园页</Link></div>
    <ul className="planner-list">
      {course ? <li><div><strong>下一节 · {course.name}</strong><p>{courseWhen(course)}{course.location ? ` · ${course.location}` : ''}</p></div><span className="subtle-tag">{course.teacher ?? '课表'}</span></li>
        : summary.loading ? <li><div><strong>正在读课表…</strong></div></li> : null}
      {exam ? <li><div><strong><CalendarClock size={15} /> 最近考试 · {exam.course}</strong><p>{examWhen(exam)}</p></div></li> : null}
      {notice ? <li><div><strong><Bell size={15} /> {notice.title}</strong><p>{notice.published_at?.slice(0, 10) ?? '时间未标注'}</p></div></li> : null}
      {card ? <li><div><strong><Wallet size={15} /> 饭卡余额 ¥ {money(card.balanceCents)}</strong><p>{card.recent[0]?.place ?? '最近没有新流水'}</p></div></li> : null}
    </ul>
  </section>;
}