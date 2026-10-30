import { app, BrowserWindow } from 'electron';
import { createInterface } from 'node:readline';
import { writeSync } from 'node:fs';

app.setPath('userData', process.env.CW_TEST_USER_DATA);
function reply(value) { writeSync(1, `${JSON.stringify(value)}\n`); }

app.whenReady().then(async () => {
  const window = new BrowserWindow({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<input id="normal" autofocus><input id="password" type="password"><div id="rich" contenteditable="true" role="textbox"></div>');
  await window.webContents.executeJavaScript(`document.body.insertAdjacentHTML('afterbegin', '<button>filler</button>'.repeat(6000))`);
  window.focus();
  reply({ ready: true, pid: process.pid });
  createInterface({ input: process.stdin }).on('line', async (line) => {
    const request = JSON.parse(line);
    if (request.cmd === 'focus' && ['normal', 'password', 'rich'].includes(request.field)) {
      await window.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(request.field)}).focus()`);
      reply({ focused: request.field });
      return;
    }
    if (request.cmd === 'text' && ['normal', 'password', 'rich'].includes(request.field)) {
      const text = await window.webContents.executeJavaScript(`(() => { const field = document.getElementById(${JSON.stringify(request.field)}); return field.value ?? field.textContent; })()`);
      reply({ text });
      return;
    }
    if (request.cmd === 'quit') app.quit();
  }).on('close', () => app.quit());
});
