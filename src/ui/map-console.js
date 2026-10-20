// Action feedback temporarily takes priority over hover coordinates.
export function createMapConsole({
  write,
  announce = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let summary = '';
  let hover = '';
  let notice = '';
  let timer;
  const render = () =>
    write(notice || hover || summary, notice ? 'action' : hover ? 'coordinates' : 'summary');
  function clearNotice() {
    clearTimer(timer);
    timer = undefined;
    notice = '';
  }
  return {
    reset(text) {
      clearNotice();
      summary = text;
      hover = '';
      render();
    },
    hover(text = '') {
      hover = text;
      render();
    },
    notify(text, duration = 3500) {
      clearNotice();
      notice = text;
      announce(text);
      render();
      if (duration > 0)
        timer = setTimer(() => {
          notice = '';
          timer = undefined;
          render();
        }, duration);
    },
    dispose: clearNotice,
  };
}
