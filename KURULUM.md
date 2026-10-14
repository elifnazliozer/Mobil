# RadioTEDU Mini Player: Kurulum (WordPress eklentisi)

Mini player bir **WordPress eklentisi** olarak paketlendi. Temaya ve sitenin kendi dosyalarına
(`app.js`, `functions.php` vb.) **hiç dokunmaz**. Kaldırmak için eklentiyi devre dışı bırakmak yeterli.

## Klasör

| Dosya / klasör | Ne |
|---|---|
| `radiotedu-miniplayer.zip` | **Yüklenecek tek dosya** |
| `radiotedu-miniplayer/` | Zip'in içeriği (eklentinin kaynak dosyaları) |
| `eski-app-js-yaklasimi/` | Önceki yaklaşım (app.js yaması). **Kullanılmıyor**, sadece arşiv |

## Yükleme (FTP gerekmez, sadece WordPress yönetici hesabı)

1. radiotedu.com/wp-admin → **Eklentiler → Yeni Ekle → Eklenti Yükle**
2. `radiotedu-miniplayer.zip` dosyasını seç → **Şimdi Kur** → **Etkinleştir**
3. **WP Fastest Cache → Tüm önbelleği sil** (yoksa ziyaretçiler bir süre eski sayfayı görür)
4. Chrome'da radiotedu.com'u aç, oynatıcı çubuğunda kalbin yanındaki yeni butonu dene

## Geri alma

**Eklentiler → RadioTEDU Mini Player → Devre dışı bırak**, ardından önbelleği temizle. Site eski haline döner.

## Güncelleme (ileride mini player değişirse)

Eklentiyi devre dışı bırak → sil → yeni zip'i aynı şekilde yükle → etkinleştir → önbelleği temizle.

## Nasıl çalışıyor

- Sitenin oynatıcı çubuğunu okur (şarkı adı, sanatçı, kapak, çalıyor mu) ve sitenin kendi
  butonlarına basarak kontrol eder. Önceki/sonraki istasyon için sitenin `/wp-json/radiotedu/v1/stations` listesini kullanır.
- Sekme arka plandayken site şarkı bilgisini güncellemeyi durdurduğu için, mini player açıkken
  şarkı bilgisini 5 saniyede bir kendisi çeker (yalnızca aynı siteden, `/wp-json/radiotedu/v1/stations/{id}/live`).
- **Bağımlılığı:** temanın oynatıcı HTML'indeki `data-rt-player`, `data-rt-player-title`, `data-rt-player-toggle`
  gibi işaretler. Tema yeniden yazılır ve bunlar değişirse mini player butonu görünmez (site bozulmaz); o zaman güncellenmesi gerekir.
- Yalnızca masaüstü Chrome/Edge (Document Picture-in-Picture). Diğer tarayıcılarda buton hiç çıkmaz.

## Aynı dosya React uygulamasında

`radio-tedu-client/src/lib/radiotedu-miniplayer.js` bu eklentideki `radiotedu-miniplayer.js` ile birebir aynı.
React uygulaması oynatıcıyı `window.RadioTEDUPlayer` (v1) üzerinden bağlar (`src/components/MiniPlayer.jsx`).
Bir yerde değiştirirsen diğerine kopyala ve zip'i yeniden oluştur.

### Oynatıcı arayüzü (v1), başka bir sitede kullanmak için

```js
window.RadioTEDUPlayer = {
  version: 1,
  getState(),   // { kind, stationId, playing, title, subtitle, artwork, canSwitchStation,
                //   hasTrack?, spotifyUrl?, amazonUrl?, color?: [r,g,b] }
  toggle(), next(), prev(),
  setBackgroundMetadata(bool),   // mini player açılınca true, kapanınca false
}
// Her değişiklikte: document 'radiotedu:playerstate' (detail = getState())
// API mini player dosyasından sonra tanımlanıyorsa: document 'radiotedu:playerready' yayınla
// spotifyUrl yalnızca open.spotify.com, amazonUrl yalnızca resmi Amazon mağazaları kabul edilir
```

## Bilinen veri sorunu (sunucu tarafı)

`/stations/{id}/live` bazı şarkılarda şarkı adıyla sanatçıyı birleşik, sanatçıyı yanlış ("Lyrics Editor") gönderiyor,
jingle'ları ("TEDU_1") şarkı gibi gösteriyor. Mini player sitenin gösterdiğini aynen gösterir.
