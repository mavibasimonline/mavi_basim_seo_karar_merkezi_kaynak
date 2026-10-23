import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const magic=Buffer.from('MAVI-SEO-BACKUP-v1\n');
function keyBytes(key){const bytes=Buffer.from(key||'','base64');if(bytes.length!==32)throw new Error('BACKUP_ENCRYPTION_KEY 32 bayt base64 olmalı');return bytes;}
export function encryptArchive(sql,key){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyBytes(key),iv);
  cipher.setAAD(magic);
  const encrypted=Buffer.concat([cipher.update(gzipSync(sql)),cipher.final()]);
  return Buffer.concat([magic,iv,cipher.getAuthTag(),encrypted]);
}
export function decryptArchive(archive,key){
  if(!archive.subarray(0,magic.length).equals(magic))throw new Error('Geçersiz yedek biçimi');
  const iv=archive.subarray(magic.length,magic.length+12),tag=archive.subarray(magic.length+12,magic.length+28);
  const decipher=createDecipheriv('aes-256-gcm',keyBytes(key),iv);decipher.setAAD(magic);decipher.setAuthTag(tag);
  return gunzipSync(Buffer.concat([decipher.update(archive.subarray(magic.length+28)),decipher.final()]),{maxOutputLength:512*1024*1024});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [mode,input,output]=process.argv.slice(2);
    if(!['encrypt','decrypt'].includes(mode)||!input||!output)throw new Error('Kullanım: node scripts/backup.mjs encrypt|decrypt girdi çıktı');
    const data=readFileSync(input),result=mode==='encrypt'?encryptArchive(data,process.env.BACKUP_ENCRYPTION_KEY):decryptArchive(data,process.env.BACKUP_ENCRYPTION_KEY);
    writeFileSync(output,result,{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({format:'mavi-seo-v1',bytes:result.length,sha256:createHash('sha256').update(result).digest('hex')}));
  }catch{console.error('Yedek işlemi başarısız; anahtar, bütünlük, dosya yolu ve çıktı dosyasının varlığını kontrol edin.');process.exitCode=1;}
}
