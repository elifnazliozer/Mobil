/*!
 * RadioTEDU Mini Player
 * Document Picture-in-Picture mini player. No dependencies.
 * Connects to the page's player through window.RadioTEDUPlayer (v1) and the
 * 'radiotedu:playerstate' event, or, on radiotedu.com, through a built-in
 * adapter for the theme's player bar (no theme changes needed).
 */
(() => {
    'use strict';

    if (window.__radioteduMiniPlayer) return;
    window.__radioteduMiniPlayer = true;

    const API_VERSION = 1;
    const DEFAULT_RGB = [229, 9, 20];
    const SPOTIFY_HOSTS = ['open.spotify.com'];
    // Official Amazon storefronts only (a loose amazon.* pattern would also match domains Amazon does not own).
    const AMAZON_DOMAINS = new Set([
        'amazon.com', 'amazon.com.tr', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.nl',
        'amazon.se', 'amazon.pl', 'amazon.com.be', 'amazon.ca', 'amazon.com.mx', 'amazon.com.br', 'amazon.com.au',
        'amazon.co.jp', 'amazon.in', 'amazon.ae', 'amazon.sa', 'amazon.sg', 'amazon.eg',
    ]);
    const isAmazonHost = (hostname) => AMAZON_DOMAINS.has(hostname.toLowerCase().replace(/^(www|music)\./, ''));
    const supported = 'documentPictureInPicture' in window;

    const LABELS = {
        tr: { open: 'Mini oynatıcı', play: 'Oynat', pause: 'Duraklat', prev: 'Önceki istasyon', next: 'Sonraki istasyon', links: 'Şarkıyı bul', spotify: 'Spotify\'da dinle', amazon: 'Amazon\'da ara', windowTitle: 'Mini Oynatıcı', live: 'Canlı yayın' },
        en: { open: 'Mini player', play: 'Play', pause: 'Pause', prev: 'Previous station', next: 'Next station', links: 'Find this track', spotify: 'Listen on Spotify', amazon: 'Search on Amazon', windowTitle: 'Mini Player', live: 'Live radio' },
    };
    const currentLang = () => {
        const lang = String(document.documentElement.lang || window.RadioTEDUConfig?.language || 'tr').slice(0, 2).toLowerCase();
        return LABELS[lang] ? lang : 'tr';
    };
    const labels = () => LABELS[currentLang()];

    // ---- Data validation ----

    const text = (value, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

    const safeUrl = (value, hosts) => {
        if (typeof value !== 'string' || !value) return '';
        try {
            const url = new URL(value, location.href);
            const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin);
            const hostAllowed = !hosts || (typeof hosts === 'function' ? hosts(url.hostname) : hosts.includes(url.hostname));
            if (!allowed || !hostAllowed) return '';
            return url.href;
        } catch {
            return '';
        }
    };

    const isRgb = (value) => Array.isArray(value) && value.length >= 3
        && value.slice(0, 3).every((n) => Number.isFinite(n) && n >= 0 && n <= 255);

    const normalize = (raw) => {
        const s = raw && typeof raw === 'object' ? raw : {};
        const title = text(s.title);
        const subtitle = text(s.subtitle);
        // hasTrack: false → only a station/podcast name is known, so "find this track" links make no sense
        const query = s.hasTrack === false ? '' : `${title} ${subtitle}`.trim();
        return {
            title,
            subtitle,
            artwork: safeUrl(s.artwork),
            playing: s.playing === true,
            color: isRgb(s.color) ? s.color.slice(0, 3) : null, // optional; otherwise taken from the cover
            canSwitchStation: s.canSwitchStation !== false,
            spotifyUrl: query ? (safeUrl(s.spotifyUrl, SPOTIFY_HOSTS) || `https://open.spotify.com/search/${encodeURIComponent(query)}`) : '',
            amazonUrl: query ? (safeUrl(s.amazonUrl, isAmazonHost) || `https://www.amazon.com/s?k=${encodeURIComponent(query)}&i=digital-music`) : '',
        };
    };

    // ---- Player connection ----
    // 1) window.RadioTEDUPlayer (v1), if the page provides one (e.g. the React app).
    // 2) Otherwise a built-in adapter for the radiotedu.com WordPress theme: it reads the theme's player bar
    //    (data-rt-* attributes) and drives it through the theme's own buttons, so the theme needs no changes.

    let adapter = null;
    const themeAdapter = () => {
        if (adapter && adapter.player.isConnected && adapter.player.matches('[data-rt-player]')) return adapter;
        adapter = null;
        const player = document.querySelector('[data-rt-player]');
        if (!player || !player.querySelector('[data-rt-player-toggle]')) return null;

        const pick = (selector) => player.querySelector(selector);
        const restBase = (() => {
            try {
                const url = new URL(window.RadioTEDUConfig?.restBase || '/wp-json/radiotedu/v1/', location.href);
                return url.origin === location.origin ? url.href : ''; // never send requests to another site
            } catch {
                return '';
            }
        })();
        const getJson = async (path) => {
            if (!restBase) return null;
            const response = await fetch(new URL(path, restBase), {
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
                signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined, // a slow server must not pile up requests
            });
            if (!response.ok) return null;
            const body = await response.json();
            return body && typeof body === 'object' && !Array.isArray(body) && 'data' in body ? body.data : body;
        };

        const readState = () => {
            const art = pick('[data-rt-player-art]');
            const amazon = pick('[data-rt-buy-amazon]');
            const kind = player.dataset.kind || null;
            const amazonUrl = amazon && !amazon.hidden ? amazon.href : '';
            return {
                version: API_VERSION,
                kind,
                stationId: pick('[data-rt-player-favorite]')?.dataset.id || null,
                playing: player.classList.contains('is-playing'),
                title: pick('[data-rt-player-title]')?.textContent || '',
                subtitle: pick('[data-rt-player-subtitle]')?.textContent || '',
                artwork: art?.currentSrc || art?.src || '',
                amazonUrl,
                // the theme shows store links only while a song's details are known
                hasTrack: kind === 'station' && Boolean(amazonUrl),
                canSwitchStation: kind !== 'podcast',
            };
        };

        // The theme stops refreshing now-playing data while the tab is hidden; the mini player fetches it itself then.
        let live = null;
        const getState = () => {
            const s = readState();
            if (live && document.hidden && s.kind === 'station' && live.stationId === s.stationId) {
                return { ...s, title: live.track, subtitle: live.artist || s.subtitle, artwork: live.artwork || s.artwork, amazonUrl: live.amazon || s.amazonUrl, hasTrack: true };
            }
            return s;
        };

        let lastJson = '';
        let queued = false;
        const emit = () => {
            queued = false;
            const state = getState();
            const json = JSON.stringify(state);
            if (json === lastJson) return;
            lastJson = json;
            document.dispatchEvent(new CustomEvent('radiotedu:playerstate', { detail: state }));
        };
        const queueEmit = () => {
            if (queued) return;
            queued = true;
            setTimeout(emit, 50);
        };

        let polling = false;
        const pollLive = async () => {
            const s = readState();
            if (polling || !document.hidden || s.kind !== 'station' || !s.stationId || /lo-?fi/i.test(s.stationId)) return;
            polling = true;
            try {
                const data = await getJson(`stations/${encodeURIComponent(s.stationId)}/live?player=1`);
                const track = text(data?.track);
                live = track ? {
                    stationId: s.stationId,
                    track,
                    artist: text(data.artist),
                    artwork: text(data.artwork_url, 2000),
                    amazon: text(data.purchase?.amazon, 2000),
                } : null;
                queueEmit();
            } catch {
                /* keep the last known state */
            } finally {
                polling = false;
            }
        };
        const onVisibility = () => {
            if (!document.hidden) live = null; // the theme refreshes itself again
            else pollLive();
            queueEmit();
        };

        let observer = null;
        let liveTimer = null;
        const connect = (enabled) => {
            if (enabled && !observer) {
                observer = new MutationObserver(queueEmit);
                observer.observe(player, {
                    subtree: true, childList: true, characterData: true,
                    attributes: true, attributeFilter: ['class', 'src', 'href', 'hidden', 'data-kind', 'data-id'],
                });
                document.addEventListener('visibilitychange', onVisibility);
                liveTimer = setInterval(pollLive, 5000);
                pollLive();
            } else if (!enabled && observer) {
                observer.disconnect();
                observer = null;
                clearInterval(liveTimer);
                document.removeEventListener('visibilitychange', onVisibility);
                live = null;
                lastJson = '';
            }
        };

        let stations = null;
        const loadStations = () => {
            if (!stations) {
                stations = getJson('stations')
                    .then((list) => (Array.isArray(list) ? list : [])
                        .filter((item) => item && item.id && /^https:\/\//i.test(String(item.streams?.default || '')))
                        .map((item) => ({ id: String(item.id), src: String(item.streams.default), title: text(item.title), artwork: safeUrl(item.artwork) })))
                    .catch(() => [])
                    .then((list) => {
                        if (!list.length) stations = null; // try again next time
                        return list;
                    });
            }
            return stations;
        };
        const switchStation = async (step) => {
            const s = readState();
            if (s.kind === 'podcast') return;
            const list = await loadStations();
            if (!list.length) return;
            const index = list.findIndex((item) => item.id === s.stationId);
            const target = list[index < 0 ? (step > 0 ? 0 : list.length - 1) : (index + step + list.length) % list.length];
            const pageButton = [...document.querySelectorAll('[data-rt-play="station"]')].find((node) => node.dataset.id === target.id);
            if (pageButton) {
                pageButton.click();
                return;
            }
            // Same data attributes as the theme's own station buttons; the theme's click handler starts the station.
            const button = document.createElement('button');
            button.type = 'button';
            button.hidden = true;
            Object.assign(button.dataset, { rtPlay: 'station', id: target.id, src: target.src, title: target.title, subtitle: labels().live, artwork: target.artwork });
            document.body.append(button);
            button.click();
            button.remove();
        };

        adapter = {
            player,
            version: API_VERSION,
            getState,
            toggle: () => pick('[data-rt-player-toggle]')?.click(),
            next: () => switchStation(1),
            prev: () => switchStation(-1),
            setBackgroundMetadata: connect,
        };
        return adapter;
    };

    const getPlayer = () => {
        const api = window.RadioTEDUPlayer;
        if (api && api.version === API_VERSION) return api;
        return themeAdapter();
    };

    // ---- Colour: dark, saturated version of the cover's dominant colour ----

    const toSpotifyBg = ([r, g, b]) => {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        const newS = s < 0.08 ? s : Math.min(0.85, Math.max(s, 0.5));
        const newL = Math.max(0.14, Math.min(l, 0.3));
        if (newS === 0) {
            const v = Math.round(newL * 255);
            return [v, v, v];
        }
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS;
        const p = 2 * newL - q;
        return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)].map((v) => Math.round(v * 255));
    };

    const colorCache = new Map();
    const coverColor = (src) => new Promise((resolve) => {
        if (!src) return resolve(null);
        if (colorCache.has(src)) return resolve(colorCache.get(src));
        const remember = (value) => {
            if (colorCache.size > 50) colorCache.delete(colorCache.keys().next().value);
            colorCache.set(src, value);
            resolve(value);
        };
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const size = 24;
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, size, size);
                const { data } = ctx.getImageData(0, 0, size, size);
                let r = 0, g = 0, b = 0, w = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i + 3] < 128) continue;
                    const max = Math.max(data[i], data[i + 1], data[i + 2]);
                    const min = Math.min(data[i], data[i + 1], data[i + 2]);
                    const sat = max === 0 ? 0 : (max - min) / max;
                    const lum = (max + min) / 510;
                    const weight = 0.1 + sat * (lum > 0.08 && lum < 0.92 ? 1 : 0.2);
                    r += data[i] * weight;
                    g += data[i + 1] * weight;
                    b += data[i + 2] * weight;
                    w += weight;
                }
                remember(w ? [r / w, g / w, b / w].map(Math.round) : null);
            } catch {
                remember(null); // canvas tainted (no CORS) → default colour
            }
        };
        img.onerror = () => remember(null);
        img.src = src;
    });

    // ---- Picture-in-Picture window ----

    const ICONS = {
        prev: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 6.5h1.5v11H6.5zM10 12l7.5 5.25V6.75z"/></svg>',
        next: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M16 6.5h1.5v11H16zM14 12L6.5 6.75v10.5z"/></svg>',
        play: '<svg viewBox="0 0 24 24" aria-hidden="true"><mask id="mp-pp"><circle cx="12" cy="12" r="11.6" fill="#fff"/><path fill="#000" stroke="#000" stroke-width="1.2" stroke-linejoin="round" d="M9.75 7.5v9l7-4.5z"/></mask><circle cx="12" cy="12" r="11.6" fill="#fff" mask="url(#mp-pp)"/></svg>',
        pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><mask id="mp-pp"><circle cx="12" cy="12" r="11.6" fill="#fff"/><path fill="#000" stroke="#000" stroke-width="0.6" stroke-linejoin="round" d="M8.75 7.5h2.25v9H8.75zM13 7.5h2.25v9H13z"/></mask><circle cx="12" cy="12" r="11.6" fill="#fff" mask="url(#mp-pp)"/></svg>',
        spotify: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>',
        amazon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.2 9.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L21 7H7M10 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM19 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
        links: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>',
        launcher: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM13 12h6v5h-6z"/></svg>',
    };

    // Layout phases follow the PiP window height (same breakpoints as the React version):
    // ≥140px full cover, 110–139px two rows, <110px single row.
    const CSS = `
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #121212; }
        body { color: #fff; font-family: 'Circular Std', 'Poppins', 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; user-select: none; -webkit-font-smoothing: antialiased; }
        button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
        button:focus-visible, a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        [hidden] { display: none !important; }

        .mp { --bg: 40, 40, 40; --artist: 200, 200, 200; --play: 44px; --nav: 28px;
              width: 100%; height: 100%; display: flex; flex-direction: column; padding: 16px 16px 12px;
              background-color: rgb(var(--bg)); transition: background-color .6s ease; overflow: hidden; }
        .mp-stage { position: relative; flex: 1; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; container-type: size; }
        .mp-cover { position: relative; width: min(100cqw, 100cqh); height: min(100cqw, 100cqh); border-radius: 8px; overflow: hidden; box-shadow: 0 8px 24px rgba(0, 0, 0, .5); background: #282828; flex-shrink: 0; }
        .mp-cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
        .mp-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 40px; }
        .mp-veil { position: absolute; inset: 0; background: rgba(var(--bg), .8); opacity: 0; transition: opacity .25s ease; pointer-events: none; }
        .mp-controls { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px;
                       opacity: 0; pointer-events: none; transition: opacity .25s ease; }
        .mp:hover .mp-veil, .mp:focus-within .mp-veil { opacity: 1; }
        .mp:hover .mp-controls, .mp:focus-within .mp-controls { opacity: 1; pointer-events: auto; }

        .mp-nav { display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 999px; transition: transform .15s; flex-shrink: 0; }
        .mp-nav svg { width: var(--nav); height: var(--nav); display: block; }
        .mp-play { width: var(--play); height: var(--play); border-radius: 999px; transition: transform .15s; flex-shrink: 0; }
        .mp-play svg { width: 100%; height: 100%; display: block; }
        .mp-nav:hover, .mp-links:hover { transform: scale(1.1); }
        .mp-play:hover { transform: scale(1.05); }
        .mp-nav:active { transform: scale(.9); }
        .mp-play:active, .mp-links:active { transform: scale(.95); }

        .mp-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 20px; flex-shrink: 0; }
        .mp-info { min-width: 0; flex: 1; }
        /* extra padding (cancelled by negative margin) keeps descenders like y/g/p from being clipped */
        .mp-title-wrap { overflow: hidden; white-space: nowrap; width: 100%; min-width: 0; padding: 2px 0 6px; margin: -2px 0 -6px;
                         -webkit-mask-image: linear-gradient(to right, #000 0%, #000 calc(100% - 22px), transparent 100%);
                         mask-image: linear-gradient(to right, #000 0%, #000 calc(100% - 22px), transparent 100%); }
        .mp-title-wrap.is-scrolled { -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 16px, #000 calc(100% - 22px), transparent 100%);
                                     mask-image: linear-gradient(to right, transparent 0%, #000 16px, #000 calc(100% - 22px), transparent 100%); }
        .mp-title { display: inline-block; margin: 0; white-space: nowrap; font-size: 17px; line-height: 1.2; font-weight: 700; letter-spacing: -.4px;
                    will-change: transform; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .05)); }
        .mp-artist { margin-top: 2px; padding-bottom: 3px; margin-bottom: -3px; font-size: 13px; font-weight: 500; color: rgb(var(--artist)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mp-links { display: flex; align-items: center; justify-content: center; padding: 4px; color: rgba(255, 255, 255, .75); border-radius: 999px;
                    transition: transform .15s, color .15s, background-color .15s; flex-shrink: 0; margin-right: 2px; }
        .mp-links:hover, .mp-links[aria-expanded="true"] { color: #fff; background-color: rgba(255, 255, 255, .12); }
        .mp-links svg { width: 24px; height: 24px; display: block; }

        .mp-menu { position: fixed; top: 0; left: 0; z-index: 10; min-width: 180px; max-width: calc(100vw - 8px); padding: 4px; border-radius: 6px;
                   background: #282828; box-shadow: 0 16px 24px rgba(0, 0, 0, .3), 0 6px 8px rgba(0, 0, 0, .2); overflow-y: auto; }
        .mp-menu a { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 3px; color: #e5e5e5; text-decoration: none;
                     font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .mp-menu a:hover, .mp-menu a:focus-visible { background: rgba(255, 255, 255, .1); color: #fff; outline: none; }
        .mp-menu svg { width: 20px; height: 20px; flex-shrink: 0; display: block; }
        .mp-menu-spotify svg { color: #1db954; }
        .mp-menu-amazon svg { color: #ff9900; }

        @media (min-height: 301px) {
            .mp { --play: 52px; }
            .mp-title { font-size: 20px; }
            .mp-artist { font-size: 14px; }
        }

        /* Two rows */
        @media (max-height: 139.98px) {
            .mp { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; grid-template-areas: "cover info spot" "ctl ctl ctl";
                  align-content: center; column-gap: 12px; row-gap: 8px; padding: 0 12px; --play: 36px; --nav: 20px; }
            .mp-stage, .mp-meta { display: contents; }
            .mp-cover { grid-area: cover; width: 48px; height: 48px; border-radius: 4px; box-shadow: 0 4px 6px rgba(0, 0, 0, .3); }
            .mp-ph { font-size: 18px; }
            .mp-veil { display: none; }
            .mp-controls { grid-area: ctl; position: static; opacity: 1; pointer-events: auto; gap: 20px; }
            .mp-info { grid-area: info; }
            .mp-links { grid-area: spot; margin-right: 0; }
            .mp-links svg { width: 20px; height: 20px; }
            .mp-menu { min-width: 160px; }
            .mp-menu a { padding: 6px 8px; font-size: 13px; }
            .mp-menu svg { width: 18px; height: 18px; }
            .mp-title { font-size: 14px; line-height: 1.25; }
            .mp-artist { font-size: 12px; }
        }

        /* Single row: links menu, prev and next appear as the window gets wider */
        @media (max-height: 109.98px) {
            .mp { grid-template-columns: 40px minmax(0, 1fr) auto auto; grid-template-areas: "cover info spot ctl"; --play: 32px; --nav: 24px; }
            .mp-cover { width: 40px; height: 40px; }
            .mp-ph { font-size: 14px; }
            .mp-controls { gap: 0; }
            .mp-links { margin-right: 8px; }
            .mp-links svg { width: 18px; height: 18px; }
            .mp-title { font-size: 13px; }
            .mp-artist { font-size: 11px; }
        }
        @media (max-height: 109.98px) and (max-width: 399.98px) { .mp-links { display: none; } }
        @media (max-height: 109.98px) and (max-width: 339.98px) { .mp-prev { display: none; } }
        @media (max-height: 109.98px) and (max-width: 279.98px) { .mp-next { display: none; } }

        @media (prefers-reduced-motion: reduce) { .mp-title { transition: none !important; } }
    `;

    const TEMPLATE = `
        <div class="mp" data-mp-root>
            <div class="mp-stage">
                <div class="mp-cover">
                    <img data-mp-art alt="" hidden>
                    <div class="mp-ph" data-mp-ph aria-hidden="true">📻</div>
                    <div class="mp-veil"></div>
                </div>
                <div class="mp-controls">
                    <button type="button" class="mp-nav mp-prev" data-mp-prev>${ICONS.prev}</button>
                    <button type="button" class="mp-play" data-mp-play></button>
                    <button type="button" class="mp-nav mp-next" data-mp-next>${ICONS.next}</button>
                </div>
            </div>
            <div class="mp-meta">
                <div class="mp-info">
                    <div class="mp-title-wrap" data-mp-title-wrap><h1 class="mp-title" data-mp-title></h1></div>
                    <div class="mp-artist" data-mp-artist></div>
                </div>
                <button type="button" class="mp-links" data-mp-links aria-haspopup="menu" aria-expanded="false" aria-controls="mp-menu">${ICONS.links}</button>
            </div>
        </div>
        <div class="mp-menu" id="mp-menu" role="menu" data-mp-menu hidden>
            <a class="mp-menu-spotify" role="menuitem" data-mp-spotify target="_blank" rel="noopener noreferrer">${ICONS.spotify}<span data-mp-spotify-label></span></a>
            <a class="mp-menu-amazon" role="menuitem" data-mp-amazon target="_blank" rel="noopener noreferrer">${ICONS.amazon}<span data-mp-amazon-label></span></a>
        </div>`;

    let pip = null;
    let opening = false;

    const setLaunchersPressed = (pressed) => {
        document.querySelectorAll('[data-rt-miniplayer-open]').forEach((node) => node.setAttribute('aria-pressed', String(pressed)));
    };

    const buildWindow = (win) => {
        const doc = win.document;
        const style = doc.createElement('style');
        style.textContent = CSS;
        doc.head.append(style);
        doc.body.innerHTML = TEMPLATE; // static markup only; all data is set via textContent / attributes

        const q = (selector) => doc.querySelector(selector);
        const el = {
            root: q('[data-mp-root]'), art: q('[data-mp-art]'), ph: q('[data-mp-ph]'),
            prev: q('[data-mp-prev]'), play: q('[data-mp-play]'), next: q('[data-mp-next]'),
            titleWrap: q('[data-mp-title-wrap]'), title: q('[data-mp-title]'), artist: q('[data-mp-artist]'),
            links: q('[data-mp-links]'), menu: q('[data-mp-menu]'),
            spotify: q('[data-mp-spotify]'), spotifyLabel: q('[data-mp-spotify-label]'),
            amazon: q('[data-mp-amazon]'), amazonLabel: q('[data-mp-amazon-label]'),
        };

        let current = null;
        let rootHover = false;
        let titleHover = false;
        const compact = win.matchMedia('(max-height: 139.98px)');

        // Long titles scroll to their end while hovered (whole window in compact phases, title only in full phase).
        const updateScroll = () => {
            const active = titleHover || (rootHover && compact.matches);
            const overflow = el.title.scrollWidth - el.titleWrap.clientWidth;
            if (active && overflow > 0) {
                el.title.style.transition = `transform ${Math.max(1.8, overflow / 35)}s linear`;
                el.title.style.transform = `translateX(${-overflow - 6}px)`;
                el.titleWrap.classList.add('is-scrolled');
            } else {
                el.title.style.transition = 'transform .5s linear';
                el.title.style.transform = 'translateX(0)';
                el.titleWrap.classList.remove('is-scrolled');
            }
        };
        el.root.addEventListener('mouseenter', () => { rootHover = true; updateScroll(); });
        el.root.addEventListener('mouseleave', () => { rootHover = false; updateScroll(); });
        el.titleWrap.addEventListener('mouseenter', () => { titleHover = true; updateScroll(); });
        el.titleWrap.addEventListener('mouseleave', () => { titleHover = false; updateScroll(); });
        win.addEventListener('resize', updateScroll);

        const applyColor = (rgb) => {
            const bg = toSpotifyBg(isRgb(rgb) ? rgb : DEFAULT_RGB);
            el.root.style.setProperty('--bg', bg.join(', '));
            // artist line: bg mixed 65% with white, like Spotify
            el.root.style.setProperty('--artist', bg.map((v) => Math.round(v + (255 - v) * 0.65)).join(', '));
        };
        applyColor(null);

        let lastRaw = null;
        const render = (raw) => {
            lastRaw = raw;
            const s = normalize(raw);
            const l = labels();
            doc.documentElement.lang = currentLang();
            const prev = current;
            current = s;

            if (!prev || prev.title !== s.title) {
                el.title.textContent = s.title || '—';
                el.titleWrap.title = s.title;
                updateScroll();
            }
            el.artist.textContent = s.subtitle;
            doc.title = `${s.title ? `${s.title} • ` : ''}${l.windowTitle}`;

            if (!prev || prev.artwork !== s.artwork) {
                el.art.hidden = !s.artwork;
                el.ph.hidden = Boolean(s.artwork);
                if (s.artwork) el.art.src = s.artwork;
                else el.art.removeAttribute('src');
            }
            const colorKey = s.color ? s.color.join(',') : '';
            if (!prev || prev.artwork !== s.artwork || (prev.color ? prev.color.join(',') : '') !== colorKey) {
                if (s.color) applyColor(s.color);
                else coverColor(s.artwork).then((rgb) => {
                    if (current && current.artwork === s.artwork && !current.color) applyColor(rgb);
                });
            }
            el.art.alt = s.title;

            if (!prev || prev.playing !== s.playing) el.play.innerHTML = s.playing ? ICONS.pause : ICONS.play;
            const playLabel = s.playing ? l.pause : l.play;
            el.play.setAttribute('aria-label', playLabel);
            el.play.title = playLabel;

            [[el.prev, l.prev], [el.next, l.next]].forEach(([button, label]) => {
                button.hidden = !s.canSwitchStation;
                button.setAttribute('aria-label', label);
                button.title = label;
            });

            [[el.spotify, el.spotifyLabel, s.spotifyUrl, l.spotify], [el.amazon, el.amazonLabel, s.amazonUrl, l.amazon]].forEach(([link, label, url, labelText]) => {
                link.hidden = !url;
                if (url) link.href = url;
                else link.removeAttribute('href');
                label.textContent = labelText;
            });
            el.links.hidden = !s.spotifyUrl && !s.amazonUrl;
            if (el.links.hidden) closeMenu();
            el.links.setAttribute('aria-label', l.links);
            el.links.title = l.links;
        };

        // Links menu: opens above the button when there is room, otherwise below, and fills a very small window.
        const menuItems = () => [...el.menu.querySelectorAll('a:not([hidden])')];
        const positionMenu = () => {
            const pad = 4, gap = 6;
            el.menu.style.maxHeight = '';
            const b = el.links.getBoundingClientRect();
            const m = el.menu.getBoundingClientRect();
            const width = win.innerWidth, height = win.innerHeight;
            const left = Math.max(pad, Math.min(b.right - m.width, width - m.width - pad));
            let top;
            if (m.height <= b.top - gap - pad) top = b.top - gap - m.height;
            else if (m.height <= height - b.bottom - gap - pad) top = b.bottom + gap;
            else {
                top = pad;
                el.menu.style.maxHeight = `${height - pad * 2}px`;
            }
            el.menu.style.left = `${left}px`;
            el.menu.style.top = `${top}px`;
        };
        const openMenu = (focusFirst) => {
            el.menu.hidden = false;
            el.links.setAttribute('aria-expanded', 'true');
            positionMenu();
            if (focusFirst) menuItems()[0]?.focus();
        };
        function closeMenu(restoreFocus = false) {
            if (el.menu.hidden) return;
            el.menu.hidden = true;
            el.links.setAttribute('aria-expanded', 'false');
            if (restoreFocus) el.links.focus();
        }
        el.links.addEventListener('click', (event) => {
            if (el.menu.hidden) openMenu(event.detail === 0); // detail 0 = keyboard activation
            else closeMenu();
        });
        el.menu.addEventListener('click', (event) => {
            if (event.target.closest('a')) closeMenu();
        });
        el.menu.addEventListener('keydown', (event) => {
            const items = menuItems();
            const index = items.indexOf(doc.activeElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                items[(index + step + items.length) % items.length]?.focus();
            } else if (event.key === 'Tab') {
                closeMenu();
            }
        });
        doc.addEventListener('pointerdown', (event) => {
            if (!el.menu.hidden && !el.menu.contains(event.target) && !el.links.contains(event.target)) closeMenu();
        });
        doc.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeMenu(true);
        });
        win.addEventListener('resize', () => {
            if (!el.menu.hidden) positionMenu();
        });

        const call = (method, ...args) => {
            try {
                const result = getPlayer()?.[method]?.(...args);
                if (result && typeof result.catch === 'function') result.catch(() => {});
            } catch (error) {
                console.warn('[RadioTEDU Mini Player]', error);
            }
        };
        el.play.addEventListener('click', () => call('toggle'));
        el.prev.addEventListener('click', () => call('prev'));
        el.next.addEventListener('click', () => call('next'));
        doc.addEventListener('keydown', (event) => {
            if (event.code === 'Space' && !event.target.closest?.('button, a')) {
                event.preventDefault();
                call('toggle');
            }
        });

        const onState = (event) => {
            try { render(event.detail); } catch (error) { console.warn('[RadioTEDU Mini Player]', error); }
        };
        document.addEventListener('radiotedu:playerstate', onState);

        const closeWithOpener = () => win.close();
        window.addEventListener('pagehide', closeWithOpener);

        call('setBackgroundMetadata', true);

        win.addEventListener('pagehide', () => {
            call('setBackgroundMetadata', false);
            document.removeEventListener('radiotedu:playerstate', onState);
            window.removeEventListener('pagehide', closeWithOpener);
            if (pip && pip.win === win) pip = null;
            setLaunchersPressed(false);
        }, { once: true });

        // used when the site language changes: same state, new labels
        if (pip && pip.win === win) pip.relabel = () => render(lastRaw);

        try { render(getPlayer()?.getState()); } catch (error) { console.warn('[RadioTEDU Mini Player]', error); }
    };

    // Must run synchronously inside the click handler: requestWindow needs user activation.
    const toggleMiniPlayer = async () => {
        if (!supported || !getPlayer()) return;
        if (pip) {
            pip.win.close();
            return;
        }
        if (opening) return;
        opening = true;
        let win = null;
        try {
            win = await window.documentPictureInPicture.requestWindow({ width: 420, height: 500, disallowReturnToOpener: true });
            pip = { win };
            buildWindow(win);
            setLaunchersPressed(true);
        } catch (error) {
            pip = null;
            try { win?.close(); } catch { /* already closed */ } // never leave an empty window behind
            console.warn('[RadioTEDU Mini Player]', error);
        } finally {
            opening = false;
        }
    };

    // ---- Launcher button in the site's player bar ----

    const ensureLauncher = () => {
        const available = supported && Boolean(getPlayer());
        const existing = document.querySelectorAll('[data-rt-miniplayer-open]');
        existing.forEach((node) => { node.hidden = !available; });
        if (!available || existing.length) return;

        const actions = document.querySelector('[data-rt-player] .rt-player__actions');
        if (!actions) return;
        const l = labels();
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rt-icon-button rt-miniplayer-open';
        button.setAttribute('data-rt-miniplayer-open', '');
        button.setAttribute('aria-label', l.open);
        button.setAttribute('aria-pressed', String(Boolean(pip)));
        button.title = l.open;
        button.innerHTML = ICONS.launcher;
        actions.insertBefore(button, actions.querySelector('.rt-volume'));
    };

    document.addEventListener('click', (event) => {
        const trigger = event.target.closest?.('[data-rt-miniplayer-open]');
        if (!trigger) return;
        event.preventDefault();
        toggleMiniPlayer();
    });

    // Re-label when the site language changes without a reload (e.g. a TR/EN toggle).
    new MutationObserver(() => {
        const l = labels();
        document.querySelectorAll('.rt-miniplayer-open[data-rt-miniplayer-open]').forEach((node) => {
            node.setAttribute('aria-label', l.open);
            node.title = l.open;
        });
        try {
            pip?.relabel?.();
        } catch (error) {
            console.warn('[RadioTEDU Mini Player]', error);
        }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    document.addEventListener('radiotedu:routechange', ensureLauncher);
    // for players that register window.RadioTEDUPlayer after this script has run (e.g. SPA apps)
    document.addEventListener('radiotedu:playerready', ensureLauncher);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureLauncher, { once: true });
    else ensureLauncher();
})();
