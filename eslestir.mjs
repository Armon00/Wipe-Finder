#!/usr/bin/env node
/* ============================================================
   eslestir.mjs — servers.json'daki eşleşmemiş serverları
   RUSTalyzer org sayfalarından otomatik eşleştirir.

   Kullanım:  node eslestir.mjs
   (servers.json ile aynı klasörde çalıştır; Node 18+ yeter, paket yok)

   Ne yapar:
   1. servers.json'u okur, rustalyzer alanı boş serverları bulur.
   2. Her topluluk için rustalyzer_org haritasındaki slug ile
      https://www.rustalyzer.com/org/<slug> sayfasını çeker.
      (Bu sayfalar sunucu tarafında dolu gelir: isim + /server/<kimlik>)
   3. İsimleri normalize edip eşleştirir (küçük harf, noktalama/boşluk
      temizliği). Önce tam eşleşme, sonra "bizim isim onlarınkinin
      başlangıcı mı" kontrolü (Rustalyzer isim sonuna wipe tarihi vb. ekler).
   4. Bulunanları servers.json'a yazar, bulunamayanları raporlar
      (onlar araçtaki manuel Eşleştirme ekranıyla yapılır).

   Yeni server eklerken: servers.json'a isim + topluluk yaz,
   (topluluk yeniyse rustalyzer_org'a slug ekle), bunu bir kez çalıştır.
   ============================================================ */

import { readFileSync, writeFileSync } from "node:fs";

const DOSYA = new URL("./servers.json", import.meta.url);
const veri = JSON.parse(readFileSync(DOSYA, "utf8"));
const orglar = veri.rustalyzer_org || {};

// isim normalizasyonu: küçük harf, sadece harf+rakam kalır
const norm = s => s.toLowerCase()
  .replace(/\.com|\.gg|\.co\b|\.net/g, "")           // alan adı ekleri
  .replace(/just\s*(full)?wiped?/g, "")               // rustalyzer'ın eklediği durum metni
  .replace(/\b\d{1,2}[./]\d{1,2}\b/g, "")             // wipe tarihleri (13/8, 20.08)
  .replace(/[^a-z0-9]+/g, "");                        // gerisi: ayraç/boşluk/noktalama at

async function orgSayfasi(slug){
  const r = await fetch(`https://www.rustalyzer.com/org/${slug}`, {
    headers: { "user-agent": "wipe-finder-eslestirici (kisisel arac)" }
  });
  if(!r.ok) throw new Error(`org/${slug} -> HTTP ${r.status}`);
  const html = await r.text();
  // Sayfadaki her /server/<kimlik> linkini, link metniyle birlikte topla.
  // Hem wipe tablosunda hem server kartlarında geçer; hepsini alırız.
  const bulunan = new Map(); // kimlik -> isim (ilk görülen metin)
  const re = /href="https:\/\/www\.rustalyzer\.com\/server\/(-?\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while((m = re.exec(html))){
    const kimlik = m[1];
    const metin = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if(metin && !bulunan.has(kimlik)) bulunan.set(kimlik, metin);
  }
  return bulunan;
}

const eksikler = veri.serverlar.filter(s => !s.rustalyzer);
if(!eksikler.length){ console.log("Her şey zaten eşleşik. ✔"); process.exit(0); }

const topluluklar = [...new Set(eksikler.map(s => s.topluluk))];
let yeni = 0;
const kalanlar = [];

for(const top of topluluklar){
  const grup = eksikler.filter(s => s.topluluk === top);
  const slug = orglar[top];
  if(!slug){
    grup.forEach(s => kalanlar.push([s.ad, "org sayfası yok — manuel ekranla eşleştir"]));
    continue;
  }
  process.stdout.write(`${top} (org/${slug}) çekiliyor… `);
  let liste;
  try { liste = await orgSayfasi(slug); }
  catch(e){ console.log(`HATA: ${e.message}`); grup.forEach(s => kalanlar.push([s.ad, e.message])); continue; }
  console.log(`${liste.size} server bulundu`);

  const adaylar = [...liste].map(([kimlik, ad]) => ({ kimlik, ad, n: norm(ad) }));
  for(const s of grup){
    const bizim = norm(s.ad);
    // 1) tam eşleşme  2) tek yönlü başlangıç eşleşmesi (uzun olan kısa olanla başlıyor)
    let tutan = adaylar.find(a => a.n === bizim)
             || adaylar.filter(a => a.n.startsWith(bizim) || bizim.startsWith(a.n))
                       .sort((a,b) => Math.abs(a.n.length-bizim.length) - Math.abs(b.n.length-bizim.length))[0];
    if(tutan){
      s.rustalyzer = tutan.kimlik;
      yeni++;
      console.log(`  ✔ ${s.ad}  →  ${tutan.kimlik}  (${tutan.ad})`);
    } else {
      kalanlar.push([s.ad, "isim tutmadı — manuel ekranla eşleştir"]);
    }
  }
  await new Promise(r => setTimeout(r, 500)); // kibar aralık
}

if(yeni){
  veri.guncelleme_tarihi = new Date().toISOString().slice(0,10);
  writeFileSync(DOSYA, JSON.stringify(veri, null, 1), "utf8");
}
console.log(`\n${yeni} yeni eşleşme servers.json'a yazıldı.`);
if(kalanlar.length){
  console.log(`${kalanlar.length} server eşleşemedi:`);
  kalanlar.forEach(([ad, neden]) => console.log(`  ✘ ${ad}  (${neden})`));
}
