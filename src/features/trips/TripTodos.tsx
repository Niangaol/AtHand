import { useState } from 'react';
import type { Trip } from '../../domain/planner';

export function TripTodos({ trip, busy, save }: {
  trip: Trip; busy: boolean; save: (value: Trip) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const progress = { done: trip.todos.filter((todo) => todo.done).length, total: trip.todos.length };
  return <section className="trip-plan-block" aria-label="行前事项">
    <h3>出发前，把这些办完</h3>
    <p className="form-hint">{progress.total ? `${progress.done}/${progress.total} 已完成` : '证件、订票、取票、请假，都可以先记在这里。'}</p>
    {trip.todos.map((todo) => <div className="trip-item" key={todo.id}>
      {editing?.id === todo.id ? <form className="trip-add" onSubmit={async (event) => {
        event.preventDefault();
        if (await save({ ...trip, todos: trip.todos.map((value) => value.id === todo.id ? { ...value, text: editing.text.trim() } : value) })) setEditing(null);
      }}><label>修改事项<input required maxLength={200} value={editing.text} onChange={(e) => setEditing({ id: todo.id, text: e.target.value })} /></label><button className="button secondary compact" disabled={busy || !editing.text.trim()}>保存</button><button type="button" className="button secondary compact" onClick={() => setEditing(null)}>取消</button></form>
        : <><label><input type="checkbox" checked={todo.done} disabled={busy} onChange={(e) => void save({ ...trip, todos: trip.todos.map((value) => value.id === todo.id ? { ...value, done: e.target.checked } : value) })} /><span>{todo.text}</span></label><div className="planner-actions"><button className="button secondary compact" aria-label={`编辑行前事项 ${todo.text}`} disabled={busy} onClick={() => setEditing({ id: todo.id, text: todo.text })}>编辑</button><button className="button secondary compact" aria-label={`删除行前事项 ${todo.text}`} disabled={busy} onClick={() => void save({ ...trip, todos: trip.todos.filter((value) => value.id !== todo.id) })}>删除</button></div></>}
    </div>)}
    <form className="trip-add" onSubmit={async (event) => {
      event.preventDefault();
      if (await save({ ...trip, todos: [...trip.todos, { id: crypto.randomUUID(), text: text.trim(), done: false }] })) setText('');
    }}>
      <label>行前事项<input required maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="带身份证、取纸质票…" /></label>
      <button className="button secondary" disabled={busy || !text.trim()}>添加事项</button>
    </form>
  </section>;
}
