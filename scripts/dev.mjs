import {spawn} from 'node:child_process';
console.log('Launching Vercel CLI. To use local env vars, configure .env.local.');
const child=spawn(process.platform==='win32'?'npx.cmd':'npx',['vercel','dev'],{stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));
