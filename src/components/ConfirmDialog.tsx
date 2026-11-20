import { useEffect, useId, useRef } from 'react';

export function ConfirmDialog({ title, description, confirmLabel = '确认删除', onConfirm, onCancel }: {
  title: string; description: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="confirm-dialog" aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id={id}>{title}</h2><p>{description}</p>
    <div className="dialog-actions"><button className="button secondary" autoFocus onClick={onCancel}>取消</button><button className="button danger" onClick={onConfirm}>{confirmLabel}</button></div>
  </dialog>;
}
