import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { get } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.BRIDGELAB_PORT || 5215);
const url = `http://127.0.0.1:${port}/`;
const sha = value => createHash('sha256').update(value).digest('hex');
function probe() {
  return new Promise(resolve => {
    const request = get(url, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', () => resolve(null));
    });
    request.setTimeout(700, () => request.destroy());
    request.on('error', () => resolve(null));
  });
}
try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('桌面端口设置无效。');
  const expected = sha(await readFile(resolve(root, 'dist/index.html')));
  let served = await probe();
  const reused = !!served;
  if (served && sha(served) !== expected) throw Error('当前端口已有其他版本，请关闭该入口或设置独立端口。');
  if (!served) {
    await mkdir(resolve(root, 'artifacts'), {recursive:true});
    const log = openSync(resolve(root, 'artifacts/desktop-server.log'), 'a');
    const child = spawn(process.execPath, [resolve(root, 'scripts/serve.mjs')], {
      cwd:root, detached:true, windowsHide:true, stdio:['ignore',log,log],
      env:{...process.env,BRIDGELAB_PORT:String(port)},
    });
    child.unref();closeSync(log);
    for (let i=0;i<30;i++) {
      await delay(150);served=await probe();
      if (served) break;
    }
  }
  if (!served || sha(served)!==expected) throw Error('桌面页面未能启动，请查看安装目录中的运行记录。');
  if (!process.argv.includes('--no-open')) {
    spawn('explorer.exe',[url],{detached:true,windowsHide:true,stdio:'ignore'}).unref();
  }
  console.log(JSON.stringify({version:'3.3.0',url,indexHashMatches:true,reusedExistingServer:reused}));
} catch(error) { console.error(error.message);process.exitCode=1; }
