import { useEffect, useRef, type ReactNode } from "react";

export function ProductModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      className="product-modal"
      aria-label={title}
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="product-title-row">
        <h2>{title}</h2>
        <button className="product-button" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
