// Reuses the existing authenticated backup encryption; only the public receipt
// key is supplied to Actions. The private key stays in the operator workspace.
import {randomBytes,publicEncrypt,privateDecrypt} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {encryptArchive,decryptArchive} from './backup.mjs';
export function seal(data,publicKey){
  const key=randomBytes(32);
  return JSON.stringify({format:'mavi-operator-receipt-v1',key:publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),
    data:encryptArchive(data,key.toString('base64')).toString('base64')});
}
export function open(data,privateKey){
  const value=JSON.parse(data);
  if(value.format!=='mavi-operator-receipt-v1')throw Error('RECEIPT_FORMAT');
  const key=privateDecrypt({key:privateKey,oaepHash:'sha256'},Buffer.from(value.key,'base64'));
  return decryptArchive(Buffer.from(value.data,'base64'),key.toString('base64'));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [mode,input,key,output]=process.argv.slice(2);
    if(!['seal','open'].includes(mode)||!input||!key||!output)throw Error('RECEIPT_ARGUMENTS');
    writeFileSync(output,(mode==='seal'?seal:open)(readFileSync(input),readFileSync(key)),{mode:0o600,flag:'wx'});
  }catch{console.error('OPERATOR_RECEIPT_FAILED');process.exitCode=1;}
}
