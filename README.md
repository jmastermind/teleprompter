# Teleprompter

Samostalna zamjena za cueprompter.com — statička web aplikacija bez ovisnosti,
bez build koraka i bez ijednog vanjskog poziva. Vrti se u nginx kontejneru.

## Što ima

- Uređivač teksta koji se pamti u pregledniku (`localStorage`), učitavanje `.txt` datoteke
- Glatko pomicanje teksta (`requestAnimationFrame`), traka napretka i procjena trajanja
- Kontrole u alatnoj traci: pokreni/pauziraj, poravnanje, zrcaljenje vodoravno i okomito,
  boja pozadine, boja teksta, veličina slova, margina, brzina, oznaka za čitanje, cijeli zaslon
- Oznaka mjesta čitanja u tri stanja (gumb kruži kroz njih): isključena → dvije linije preko
  teksta → strelica uz lijevi rub teksta, kao na originalu
- Snimanje videozapisa kamerom (`MediaRecorder`) dok tekst teče — snimka se preuzima kao `.webm`
- Radi offline (service worker), instalira se kao PWA

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
   `ghcr.io/jmastermind/teleprompter:latest`.
2. U Portaineru: **Stacks → Add stack → Repository** (ili zalijepi sadržaj
   `docker-compose.yml`), pa **Deploy**.
3. Container nosi labelu `com.centurylinklabs.watchtower.enable=true`, pa ga
   Watchtower koji već vrti na serveru sam ažurira nakon svakog builda.
