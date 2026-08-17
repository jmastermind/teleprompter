# Teleprompter

Samostalna zamjena za cueprompter.com — statička web aplikacija bez ovisnosti,
bez build koraka i bez ijednog vanjskog poziva. Vrti se u nginx kontejneru.

## Što ima

- Uređivač teksta koji se pamti u pregledniku (`localStorage`)
- Učitavanje `.txt`, `.md` i **`.docx`** datoteka — formatiranje se odbacuje, ostaje samo tekst
  (docx se raspakirava ugrađenim `DecompressionStream`-om, bez ijedne biblioteke)
- **Povlačenje s Pastebina** — prihvaća puni link, `/raw/` link ili samo ključ
- Glatko pomicanje teksta (`requestAnimationFrame`), traka napretka i procjena trajanja
- Kontrole u alatnoj traci: pokreni/pauziraj, poravnanje, zrcaljenje vodoravno i okomito,
  boja pozadine, boja teksta, veličina slova, margina, brzina, oznaka za čitanje, cijeli zaslon
- Oznaka mjesta čitanja u tri stanja (gumb kruži kroz njih): isključena → dvije linije preko
  teksta → strelica uz lijevi rub teksta, kao na originalu
- Snimanje videozapisa kamerom (`MediaRecorder`) dok tekst teče — snimka se preuzima kao `.webm`
- Radi offline (service worker) i instalira se kao aplikacija (PWA)

### Ograničenja koja treba znati

- **Stari `.doc`** (Word 97–2003) nije podržan — to je binarni OLE format koji bez vanjske
  biblioteke nema smisla parsirati. Aplikacija ga prepozna i javi da datoteku treba
  spremiti kao `.docx`.
- **Pastebin** ne šalje CORS zaglavlja, pa dohvat ide kroz proxy u nginxu
  (`/pastebin/<ključ>` → `pastebin.com/raw/<ključ>`). Proxy je namjerno zaključan
  na taj jedan cilj i nije opći proxy. Izvan kontejnera (npr. `python -m http.server`)
  dohvat neće raditi.
- **Snimanje kamerom i instalacija PWA traže siguran kontekst** — HTTPS ili `localhost`.
  Preko običnog `http://` na LAN adresi preglednik neće ponuditi ni kameru ni instalaciju.
  Ako to trebaš, stavi aplikaciju iza reverse proxyja s TLS-om.

### Tipkovnica

| Tipka | Radnja |
|---|---|
| razmaknica | pokreni / pauziraj |
| ↑ / ↓ | brzina + / − |
| Shift + ↑ / ↓ | ručni pomak teksta |
| PageUp / PageDown | skok za jedan zaslon (radi i s daljinskim za prezentacije) |
| Home / End | početak / kraj |
| F | cijeli zaslon |
| M | zrcali vodoravno |
| Esc | natrag na uređivanje |

Kotačić miša pomiče tekst ručno, klik po tekstu pokreće i pauzira.

**Dodir i miš:** pritisni i povuci po tekstu da ga pomakneš gore/dolje — tekst prati
prst dok držiš. Automatsko pomicanje staje dok povlačiš i nastavlja se kad pustiš.
Kratki dodir bez povlačenja i dalje pokreće i pauzira.

## Lokalno pokretanje

```bash
python -m http.server 5180 --directory public
```

Otvori http://localhost:5180.

> Snimanje kamerom traži siguran kontekst — `localhost` ili HTTPS. Preko običnog
> `http://` na LAN adresi preglednik neće dati pristup kameri.

## Docker

```bash
docker compose up -d --build
```

Aplikacija je na http://localhost:8090 (port se mijenja s `APP_PORT`).

## Deploy (GitHub → GHCR → Portainer)

1. Push na `master` → GitHub Actions buildaju sliku i guraju je na
   `ghcr.io/jmastermind/teleprompter:latest` (slika je javna, pa Portainer ne treba
   `docker login`).
2. U Portaineru: **Stacks → Add stack → Repository** (ili zalijepi sadržaj
   `docker-compose.yml`), pa **Deploy**.

### Ažuriranje na novu verziju

Na ovom hostu ne vrti Watchtower (on je na VPS-u), pa auto-update ne ide sam od sebe.
Tri mogućnosti, po redu jednostavnosti:

1. **Ručno u Portaineru** — Stack → **Update the stack** s uključenim
   *Re-pull image and redeploy*. Dovoljno za povremene promjene.
2. **Portainer webhook (auto-deploy)** — u stacku uključi **Webhook**, kopiraj URL i
   spremi ga kao repo secret `PORTAINER_WEBHOOK`
   (`gh secret set PORTAINER_WEBHOOK`). Workflow ga zove nakon svakog uspješnog
   builda i Portainer sam povuče sliku i restarta stack. Bez secreta se korak preskače.
3. **Vlastiti Watchtower u ovom stacku** — odkomentiraj `watchtower` servis u
   `docker-compose.yml`; provjerava GHCR svakih 5 minuta i ažurira samo containere
   s labelom `com.centurylinklabs.watchtower.enable=true`.
