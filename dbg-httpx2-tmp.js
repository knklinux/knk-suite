const { execFile } = require('child_process');
const bin = 'C:/Users/knkli/.knk-suite/tools/httpx/httpx.exe';
function t(name, opts) {
  return new Promise((resolve) => {
    execFile(bin, ['-u', 'http://scanme.nmap.org', '-silent', '-status-code'], { timeout: 60000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout) => {
      resolve(`${name}: err=${err ? 'Y' : 'n'} out=${JSON.stringify(String(stdout).slice(0, 60))}`);
    });
  });
}
(async () => {
  console.log(await t('stdio-default ', {}));
  console.log(await t('stdio-ignore  ', { stdio: ['ignore', 'pipe', 'pipe'] }));
  console.log(await t('no-hide      ', { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false }));
})();
