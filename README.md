# 🌿 Agralytic AI — Artificial Intelligence for Plant Biosecurity

> **Prevent outbreaks. Secure local food.**
> An offline-first web app that turns any smartphone into a plant-quarantine agent: it diagnoses leaf disease **on the device**, prescribes **safe organic remedies from the kitchen**, and warns neighbours automatically when an **outbreak cluster** forms.

Built for the Young AI Innovators challenge (YAI Singapore). SDG 2 · 4 · 12 · 13 · 15.

---

## 🚀 Quick start (2 minutes)

```bash
npm install
```

```bash
npm start
```

Open **http://localhost:3000**. Demo data (scans across SE Asia, 6 outbreak clusters, stories, listings, ratings) is seeded on first launch.

* Camera access needs **https://** or **localhost**. On a phone, deploy it (see below) or use a tunnel such as `npx localtunnel --port 3000`.
* Everything works **without any API key**: diagnosis runs in the browser, the chatbot uses the offline knowledge engine and alerts run in *simulation mode* (visible in the Radar's live log).
* Optional keys (Claude, Twilio, Telegram): copy `.env.example` to `.env` and fill in what you have.

Other scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Auto-restart on file changes |
| `npm test` | 18 API + logic checks (cluster rule, encryption, demotion, prescription…) |
| `npm run reset` | Wipe the demo database (re-seeded on next start) |

Requires Node.js ≥ 18 (≥ 20.12 to auto-load `.env`).

---

## 🗺️ System flow

```
 User photographs a leaf
        │
        ▼
 Edge-AI Computer Vision (in the browser — no upload, saves bandwidth) ──► offline? → IndexedDB queue → auto-sync later
        │  diagnosis succeeded
        ▼
 3D anatomy + microscopic simulation + confidence score + 14-day forecast
        │  geographic matching
        ▼
 AI recipe generator (kitchen ingredients + neighbours' marketplace listings) ──► user prepares remedy & ticks checklist
        │  anonymous coordinate extraction (~100 m grid)
        ▼
 Spatial database ── cluster rule: >3 same-pathogen cases within 1 km / 14 days
        │
        ▼
 Outbreak Radar renders the red zone + wind-driven spore drift ──► Twilio SMS / WhatsApp (+ Telegram) alerts to residents
```

## 🧱 Architecture

```
public/                      Frontend — vanilla HTML/CSS/JS PWA (no build step)
  index.html                 Cinematic landing page (+ css/experience.css, js/experience.js)
  dashboard.html … contact.html  10 app pages (9 from the blueprint + Contact & Support)
  css/style.css              "Specimen Lab" design system: obsidian/neon/sand, Instrument Serif + Inter Tight,
                             full-screen menu with hover reveal, custom cursor, page transitions, easy-read mode
  js/app.js                  Shell: navbar/footer, API client, profiles, voice chatbot, onboarding
  js/knowledge.js            Shared plant-pathology knowledge base (used by browser AND server)
  js/vision.js               Edge-AI engine: segmentation → 18 features → FeatureNet MLP; AR, forecast, metadata stripper
  js/samples.js              Procedural leaf generator (demo samples, quiz images, synthetic training data)
  js/micro.js, anatomy.js    Microscopic simulator & CSS-3D leaf anatomy
  js/idb.js                  IndexedDB history + offline outbox
  sw.js, manifest.webmanifest  Offline-first PWA
  model/featurenet.json      Trained FeatureNet weights + training history + confusion matrix
  vendor/                    Leaflet, leaflet.heat, Plus Jakarta Sans (self-hosted → works offline)
server.js                    Express REST API, security headers (CSP), rate limiting, static hosting
server/
  db.js                      Zero-dependency JSON document store (atomic writes)
  geo.js                     Haversine, ~100 m anonymisation, outbreak cluster detection
  notify.js                  AES-256-GCM phone encryption + Twilio / Telegram dispatcher
  ai.js                      Prescription ranking, Wilson bio-rating, offline chatbot, optional Claude
  quiz.js, seed.js           Quiz bank (answers server-side) and demo data
training/train_plantvillage.py  MobileNetV2 transfer learning → TensorFlow.js (optional upgrade)
test/smoke.js                API smoke tests
```

---

## 📑 The 9(+1) pages

| Page | Highlights |
|---|---|
| 🎬 **Home (cinematic landing)** | Oversized broken-grid hero, live specimen plate with AI readout, rotating seal CTA, outbreak ticker, vertical specimen index with hover reveal, intro loader |
| 🏠 **Field desk (dashboard.html)** | Hero + giant *Launch Bio-Scanner* CTA · live telemetry (leaves scanned, kg pesticide diverted, active red zones) · **geo-location alert banner** · weather-based fungal-risk gauge · on-device scan history · **drag-and-drop crop scheduler** |
| 📸 **Bio-Scanner** | Live camera + **AR overlay** (leaf brackets, pulsing lesion targets, animated arrow) · quality guidance (dark/blurry/too far) · flashlight & camera flip · photo upload with **metadata stripper** · 11 sample leaves · results in 4 tabs: Diagnosis, **14-day forecast slider**, **3D anatomy + microscope**, Emergency action · cloud second opinion · offline queue |
| 🧪 **Eco-Prescription** | AI recipe customizer (diagnosis × pantry × weather × community rating) · locked step-by-step checklist · **toxicity calculator** with phytotoxicity gauge · **eco-impact counter** · spray schedule → dashboard calendar · nearby ingredient matching from the marketplace · community recipe library with **auto-demotion** |
| 🗺️ **Outbreak Radar** | Leaflet heat-map · red zones (watch / warning / critical) · **wind-driven spore-drift vectors** (live wind from Open-Meteo) · encrypted SMS/WhatsApp/Telegram registration · live alert log · *Simulate outbreak near me* demo button |
| 👥 **Community Hub** | Story forum (likes, comments, community reporting) · **Bio-Agent quiz missions** · weekly **Bio-Defender leaderboard** (agents & schools) · badges |
| 🛒 **Marketplace / Seed Swap** | Zero-waste exchange of kitchen "waste" · seed swaps · P2P harvest sale · in-app requests (no phone numbers or addresses exposed) |
| 🔬 **Diagnostics Lab** | Model playground (7 parameter sliders, 4-stage pipeline view, 18-feature vector, live hidden-layer activations) · **train the neural network live in the browser** · loss/accuracy chart · confusion matrix · full-size microscopic simulator |
| ❓ **FAQ & Knowledge Base** | Germ types explained · collectible **wiki trading cards** (flip) · botanical dictionary · FAQ · camera troubleshooting · searchable, offline |
| ℹ️ **About Us** | Academic narrative with cited data (FAO, Savary 2019, Bebber 2013…) · methodology & limitations · SDGs · **Boss Check validation log** |
| ✉️ **Contact & Support** | Ticketed contact form · escalation to extension officers · delete-my-data button |

## ✅ The 12 high-utility features — where they live

| # | Feature | Implementation |
|---|---|---|
| 1 | Real-time AR overlays | `scanner.js → drawAR()` runs the vision engine on video frames every 280 ms and draws targets + arrow on a canvas overlay |
| 2 | Interactive slider timeline | `vision.js → simulate()` grows lesions with a chamfer distance transform at each pathogen's progression rate, seeds satellite infections |
| 3 | Voice-guided agronomist | `app.js → chat` — Web Speech API (EN/ID), hands-free loop, "read the recipe / next / repeat / back" works **offline** |
| 4 | Drag-and-drop crop scheduler | `home.js` — pointer-event DnD (mouse **and** touch), synced to server for profiles |
| 5 | Microscopic simulator | `micro.js` — separate invasion stories for fungus, water mould, bacteria, virus and deficiency; live photosynthesis meter |
| 6 | Gamified quizzes | `/api/quiz` (answers kept server-side), procedural leaf images, points & badges |
| 7 | Eco-impact counter | Transparent maths in `knowledge.js → ECO` (concentrate avoided × active ingredient ÷ EU 0.1 µg/L limit) |
| 8 | Pathology wiki-cards | `faq.html` — rarity, stats, history; "collected" when you diagnose that disease |
| 9 | Automated Twilio/WhatsApp trigger | `server/notify.js` — runs on every report, no human in the loop, 12 h cooldown, escalation on level change |
| 10 | Offline-first PWA | `sw.js` pre-caches all pages, engine, model, map library and fonts; IndexedDB outbox + Background Sync |
| 11 | Decentralized bio-rating | `server/ai.js → bioRating()` — Wilson lower bound + Bayesian average; auto-demote at < 30 % after ≥ 5 reviews, "verified" badge when strong |
| 12 | Anonymous metadata stripper | `vision.js → sanitize()` re-encodes images (drops EXIF/GPS/device model), blurs faces via `FaceDetector` where supported, reports what was removed; coordinates snapped to a ~100 m grid server-side |

### ➕ Extras added beyond the blueprint
Weather-based fungal-risk index & spray advice · **easy-read mode** for elders · custom cursor, full-screen menu with specimen hover previews and page transitions · onboarding tour · mobile thumb tab-bar · explainable AI (feature vector, neuron activations, confusion matrix) · live in-browser training · Claude vision **second opinion** · geographic ingredient matching with the marketplace · anonymous profiles (no email/phone/password) · community moderation (auto-hide after 3 reports) · profanity filter · rate limiting · strict Content-Security-Policy · delete-my-data.

---

## 🧠 About the AI (be ready to explain this to judges)

1. **Pipeline** — RGB → HSV → 7 pixel classes (healthy, chlorosis, necrosis, dark, pustule, powder, background) → leaf mask (morphological closing + hole filling + largest component) → lesion components → **18 interpretable features** (class fractions, spot count/size, yellow-halo ratio, margin ratio…).
2. **FeatureNet** — a multilayer perceptron 18 → 24 → 11 (731 parameters) trained with SGD + momentum on ~1,000 procedurally generated, augmented leaves. Shipped model: **97.8 % on a held-out synthetic test set** (see the Lab's confusion matrix). Runs in ~20–30 ms on a phone.
3. **Honesty clause** — synthetic accuracy is an upper bound. The app shows confidence, warns below 60 %, offers a cloud second opinion and escalates severe cases.
4. **Upgrade path** — `training/train_plantvillage.py` fine-tunes MobileNetV2 on PlantVillage (54k images) and exports to TensorFlow.js. Drop the output into `public/model/` and the scanner automatically blends it (70 % deep model / 30 % FeatureNet). Free GPU: Google Colab.

### Optional: Claude
With `ANTHROPIC_API_KEY` set, the server uses the Claude API (`claude-opus-5-5`, with server-side refusal fallback) for free-form chat, personalised weather-aware tips on prescriptions, and the vision second opinion. The deterministic engine remains the safety net: Claude is instructed never to exceed the safe concentrations in the knowledge base, and the app works fully without it.

### Optional: real alerts
Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` (SMS) and/or `TWILIO_WHATSAPP_FROM` (WhatsApp sandbox works for demos), or `TELEGRAM_BOT_TOKEN`. The Radar shows **LIVE delivery** when configured.

---

## ✅ "Boss Check" — field validation (do this before judging!)

Judges reward real-world evidence. Test the scanner on **real leaves** with a biology teacher, community leader or agricultural extension officer, then record each trial in `public/validation.json`:

```json
[
  {
    "title": "School garden — 20 chilli leaves",
    "date": "2026-12-05",
    "verifiedBy": "Ms. Name, Biology teacher, SMA …",
    "result": "AI matched the teacher's diagnosis on 16/20 leaves (80%). Misses: 3 early leaf spots labelled healthy, 1 chlorosis labelled mosaic.",
    "photo": "/validation/chilli-trial.jpg"
  }
]
```

Report the field accuracy honestly next to the synthetic one — that contrast shows scientific understanding (the 25 % "Understanding" criterion).

---

## ☁️ Deploy (free tiers)

* **Render / Railway / Fly.io**: new web service from this repo → build `npm install` → start `npm start`. Add a persistent disk mounted at `/app/data` (or set `DATA_DIR`) so the database survives restarts. Set `DATA_KEY` to a long random secret.
* HTTPS is provided by the platform — required for camera, geolocation, microphone and the service worker.
* For production scale, swap `server/db.js` for PostgreSQL + PostGIS (the collection API maps 1:1 to tables).

## 🎤 3-minute demo script for judges

1. **Home** → point at the red outbreak banner and live telemetry. Drag "🧪 Organic spray" onto a calendar day.
2. **Bio-Scanner** → start the camera on a real leaf (AR markers), then tap the *Early Blight* sample → show confidence, segmentation, **14-day forecast** (press play), **3D anatomy** and the **microscope**.
3. **Get organic treatment** → toggle pantry items, show the **toxicity gauge** turning red at 20 g/L, tick the checklist, press **🎙️ Voice guide** and say "next".
4. **Outbreak Radar** → register an alert, press **⚡ Simulate outbreak near me** → red zone + spore vectors + alert in the live log.
5. **Diagnostics Lab** → move a slider, then **train the network live** in front of the judges.

## 🔐 Privacy & child safety

On-device inference · no account data beyond a nickname · EXIF/GPS stripped and faces blurred before sharing · locations rounded to ~100 m · phone numbers AES-256-GCM encrypted and masked · guardian consent for alerts · marketplace never exposes contact details · community reporting & profanity filter · no ads or third-party trackers.

## 📄 Licences
App code: MIT. Vendored: Leaflet (BSD-2), Leaflet.heat (BSD-2), Plus Jakarta Sans (SIL OFL 1.1) — licence files in `public/vendor/`. Map tiles © OpenStreetMap contributors © CARTO. Weather: Open-Meteo.
