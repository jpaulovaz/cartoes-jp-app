//node generate-vapid.js
//Pegue a saída e coloque no .env:
//# ===== NOTIFICAÇÕES VIA PUSH =====
//VAPID_PUBLIC_KEY=COLE_AQUI_A_PUBLIC_KEY
//VAPID_PRIVATE_KEY=COLE_AQUI_A_PRIVATE_KEY
//VAPID_SUBJECT=mailto:seuemail@seudominio.com
//#O VAPID_SUBJECT pode ser um mailto: ou uma URL.

const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();
console.log(keys);