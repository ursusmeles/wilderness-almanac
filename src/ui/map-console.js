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
  let noticeKind = 'action';
  let timer;
  const render = () =>
    write(notice || hover || summary, notice ? noticeKind : hover ? 'coordinates' : 'summary');
  function clearNotice() {
    clearTimer(timer);
    timer = undefined;
    notice = '';
  }
  function notify(text, duration = 3500, kind = 'action') {
    clearNotice();
    notice = text;
    noticeKind = kind;
    announce(text);
    render();
    if (duration > 0)
      timer = setTimer(() => {
        notice = '';
        timer = undefined;
        render();
      }, duration);
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
    notify,
    error: (text) => notify(text, 3500, 'error'),
    dispose: clearNotice,
  };
}
