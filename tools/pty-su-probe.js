'use strict';
// Prueba: ssh interactivo a kali@127.0.0.1:2223 + ver si sudo responde sin usuario
const pty = require('node-pty');
const os = require('os');
const path = require('path');

const exe = 'C:\\WINDOWS\\System32\\OpenSSH\\ssh.exe';
const privKey = path.join(os.homedir(), '.ssh', 'id_ed25519');

const p = pty.spawn(exe, [
  '-p','2223','-i',privKey,'-o','StrictHostKeyChecking=accept-new','kali@127.0.0.1',
], {
  name:'xterm-256color', cols:100, rows:28 });

const out = [];
let sent = 0;
function clean(s){return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');}

function writeIf(d){ if(p&&p.writable){ try{p.write(d);}catch(e){} } }


    sent=1;
    writeIf('whoami\r');
    setTimeout(()=>writeIf('sudo -n true 2>/dev/null && echo REPLY_NOPASS || echo REPLY_NONOPASS\r'),250);    setTimeout(()=>writeIf('printf kali | sudo -S true 2>/dev/null && echo REPLY_S || echo REPLY_NS\r'),500);    setTimeout(()=>writeIf('ls -la /etc/sudoers.d/ 2>/dev/null | grep knk || echo NOPENOFILE\r'),750);    setTimeout(()=>writeIf('exit\r'),1000);  }});p.onExit(({exitCode})=>{  const t=clean(out.join(''));Prueba: ssh interactivo a kali@127.0.0.1:2223 + ver si sudo responde sin usuarioconst pty = require('node-pty');const os = require('os');const path = require('path');const exe = 'C:\\WINDOWS\\System32\\OpenSSH\\ssh.exe';const privKey = path.join(os.homedir(), '.ssh', 'id_ed25519');const p = pty.spawn(exe, [  '-p','2223','-i',privKey,'-o','StrictHostKeyChecking=accept-new','kali@127.0.0.1',], {  name:'xterm-256color', cols:100, rows:28 });const out = [];let sent = 0;function clean(s){return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');}function writeIf(d){ if(p&&p.writable){ try{p.write(d);}catch(e){} } }    sent=1;    writeIf('whoami\r');    setTimeout(()=>writeIf('sudo -n true 2>/dev/null && echo REPLY_NOPASS || echo REPLY_NONOPASS\r'),250);
    setTimeout(()=>writeIf('printf kali | sudo -S true 2>/dev/null && echo REPLY_S || echo REPLY_NOS\r'),500);    setTimeout(()=>writeIf('ls -la /etc/sudoers.d/ 2>/dev/null | grep knk || echo NOPENOFILE\r'),750);    setTimeout(()=>writeIf('exit\r'),1000);  }});p.onExit(({exitCode})=>{  const t=clean(out.join(''));
  const lines=t.split('
').filter(l=>l.trim());
  console.log('EXIT',exitCode,'(lines:',lines.length,')');
  console.log(lines.slice(-14).join('
'));
});

setTimeout(()=>{
  console.log('TIMEOUT last 14:');
  console.log(clean(out.join('')).split('
').filter(l=>l.trim()).slice(-14).join('
'));
  if(p){try{p.kill();}catch{}}
  process.exit(1);
},22000);

  const lines=t.split('
').filter(l=>l.trim());
  console.log('EXIT',exitCode,'(lines:',lines.length,')');
  console.log(lines.slice(-14).join('
'));
});

setTimeout(()=>{
  console.log('TIMEOUT last 14:');
  console.log(clean(out.join('')).split('
').filter(l=>l.trim()).slice(-14).join('
'));
  if(p){try{p.kill();}catch{}}
  process.exit(1);
},22000);
