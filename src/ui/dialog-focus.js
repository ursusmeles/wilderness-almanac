// Remember the actual invoker, including when a draft guard was opened by a map click.
export function openDialog(dialog, initial) {
  if (dialog.open) return;
  const invoker = document.activeElement;
  dialog.addEventListener(
    'close',
    () => {
      if (dialog.open) return;
      const active = document.activeElement;
      if (
        (active === document.body || active === dialog || dialog.contains(active)) &&
        invoker?.isConnected &&
        !invoker.disabled &&
        invoker.getClientRects().length &&
        !invoker.closest('[hidden], [inert]')
      )
        invoker.focus({ preventScroll: true });
    },
    { once: true },
  );
  dialog.showModal();
  (initial || dialog.querySelector('[autofocus]'))?.focus({ preventScroll: true });
}
