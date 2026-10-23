// Runs on app.csjax.org/kiosk: tells the page the launcher is installed and relays its "Close board" button.
document.documentElement.dataset.launcher = '1';
window.addEventListener('message', e => {
  if (e.source === window && e.origin === location.origin && e.data && e.data.ccsKiosk === 'close') {
    chrome.runtime.sendMessage({ type: 'close-board' });
  }
});
