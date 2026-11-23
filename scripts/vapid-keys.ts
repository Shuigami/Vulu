// Prints a VAPID key pair for web push, to paste into .env (once: changing it drops every device).
import { generateVapidKeys } from '../src/lib/server/webpush';

const { publicKey, privateKey } = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`);
