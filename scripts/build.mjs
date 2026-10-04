import { mkdir, copyFile, readdir } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await copyFile('index.html','dist/index.html');
console.log('Built static frontend. Server files and environment files are excluded.');
