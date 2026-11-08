import { supabase } from "./supabaseClient.js";
import {
  fetchMatchsEpfKin,
  fetchMatchsInternationaux,
  fetchMatchsLeopards,
  fetchMatchsLocaux
} from "./services/sportsService.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
}[character]));

const drivePreviewUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (!["drive.google.com", "docs.google.com"].includes(url.hostname)) return "";
  const fileId = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1]
    || url.searchParams.get("id");
  return fileId && /^[A-Za-z0-9_-]+$/.test(fileId)
    ? `https://drive.google.com/file/d/${fileId}/preview`
    : "";
};

const YT_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com"];

const youtubeVideoId = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  let id = "";
  if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
  else if (YT_HOSTS.includes(url.hostname)) id = url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] || "";
  return id !== "live_stream" && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
};

// Lien YouTube -> lecteur intégré Masano TV.
// Accepte watch?v=, /live/ID, youtu.be/ID et la page live permanente d'une chaîne (/channel/UC.../live).
const youtubeEmbedUrl = (value, live = false) => {
  const query = `rel=0&playsinline=1${live ? "&autoplay=1" : ""}`;
  const id = youtubeVideoId(value);
  if (id) return `https://www.youtube-nocookie.com/embed/${id}?${query}`;
  try {
    const url = new URL(value);
    const channel = YT_HOSTS.includes(url.hostname)
      ? url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})\/live\/?$/)?.[1]
      : "";
    return channel ? `https://www.youtube-nocookie.com/embed/live_stream?channel=${channel}&${query}` : "";
  } catch {
    return "";
  }
};

const youtubeThumbnail = (value) => {
  const id = youtubeVideoId(value);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
};

const mediaSource = (content) => {
  const value = content.type === "direct"
    ? (content.statut === "termine" ? content.replay_url || content.hls_url || content.video_url : content.hls_url || content.video_url)
    : content.video_url;
  if (!value) return { type: "none", url: "" };
  const drive = drivePreviewUrl(value);
  if (drive) return { type: "iframe", url: drive, title: "Lecteur Google Drive" };
  const youtube = youtubeEmbedUrl(value, content.type === "direct" && content.statut === "en_direct");
  if (youtube) return { type: "iframe", url: youtube, title: "Lecteur YouTube" };

  let url;
  try {
    url = new URL(value);
  } catch {
    return { type: "none", url: "" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { type: "none", url: "" };
  if (/\.m3u8$/i.test(url.pathname)) return { type: "hls", url: url.href };
  if (/\.(mp4|webm|ogg)$/i.test(url.pathname)) return { type: "video", url: url.href };
  return { type: "none", url: "" };
};

const statusLabel = (status) => ({
  programme: "À venir",
  en_direct: "En direct",
  termine: "Terminé"
}[status] || status);

const formatDate = (date) => {
  if (!date) return "";
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? ""
    : new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(parsed);
};

const initialsOf = (name) => String(name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2)
  .map((word) => word[0]).join("").toUpperCase() || "?";

const safeImageUrl = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};

// Miniature d'un contenu TV : celle saisie dans l'admin, sinon l'image du flux Cloudflare Stream.
const tvThumbnail = (item) => {
  const manual = safeImageUrl(item.miniature_url);
  if (manual) return manual;
  const hls = safeImageUrl(item.hls_url);
  return hls && /\/manifest\/video\.m3u8$/i.test(hls)
    ? hls.replace(/\/manifest\/video\.m3u8$/i, "/thumbnails/thumbnail.jpg?height=360")
    : youtubeThumbnail(item.video_url);
};

const PENDING_TV_KEY = "masano-tv-pending-content-id";
const PENDING_MATCH_KEY = "masano-open-match-id";

export const mountTvHomePreview = (root) => {
  if (!root || !supabase) return () => {};
  let active = true;
  let channel;
  let liveMatches = [];
  let tvDirects = [];
  let tvContents = [];
  const liveMatchSources = [
    ["Linafoot", fetchMatchsLocaux],
    ["EPF-KIN", fetchMatchsEpfKin],
    ["Matchs internationaux", fetchMatchsInternationaux],
    ["Matchs des Léopards", fetchMatchsLeopards]
  ];
  const matchSourceData = new Map();
  const normalizeKeyPart = (value) => String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  const liveMatchKey = (match) => [
    [match.equipe_domicile, match.equipe_visiteur].map(normalizeKeyPart).sort().join("|"),
    normalizeKeyPart(match.competition),
    String(match.date_match).slice(0, 10)
  ].join("|");
  const sportLabel = (category) => ({
    basketball: "Basketball",
    judo: "Judo",
    omnisports: "Omnisports"
  }[category] || "Football");

  // Un direct programmé n'apparaît que s'il est proche (ou sans date) : pas de direct fantôme dans 3 semaines.
  const isNearby = (item) => {
    if (!item.debut) return true;
    const gap = new Date(item.debut).getTime() - Date.now();
    return Number.isFinite(gap) && gap < 36 * 3600 * 1000 && gap > -3 * 3600 * 1000;
  };

  const teamRow = (name, logo, score) => `<span class="home-live-row">
      <span class="home-live-logo" aria-hidden="true"><i>${escapeHtml(initialsOf(name))}</i>${safeImageUrl(logo)
        ? `<img class="home-live-logo-img" src="${escapeHtml(safeImageUrl(logo))}" alt="" loading="lazy">`
        : ""}</span>
      <span class="home-live-name">${escapeHtml(name)}</span>
      <b>${score === null || score === undefined ? "–" : escapeHtml(score)}</b>
    </span>`;

  const matchCard = (match) => `<a class="home-live-card is-match" role="listitem" href="#resultats" data-live-match="${escapeHtml(match.id)}" aria-label="${escapeHtml(`${match.equipe_domicile} contre ${match.equipe_visiteur}, en direct`)}">
      <span class="home-live-top">
        <span class="home-live-comp">${escapeHtml(sportLabel(match.competition_category))} · ${escapeHtml(match.competition)}</span>
        <span class="home-live-status">${escapeHtml(match.minute ? `${match.minute}'` : "EN DIRECT")}</span>
      </span>
      ${teamRow(match.equipe_domicile, match.logo_domicile, match.score_domicile)}
      ${teamRow(match.equipe_visiteur, match.logo_visiteur, match.score_visiteur)}
    </a>`;

  const tvCard = (item) => {
    const live = item.statut === "en_direct";
    const thumbnail = tvThumbnail(item);
    const meta = [item.competition, item.sport, item.emission_nom].filter(Boolean).join(" · ") || "Masano TV";
    return `<a class="home-live-card is-tv${live ? " is-onair" : ""}" role="listitem" href="#tv" data-tv-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(`${live ? "En direct sur Masano TV" : "Bientôt sur Masano TV"} : ${item.titre}`)}">
      <span class="home-live-thumb">
        ${thumbnail ? `<img class="home-live-thumb-img" src="${escapeHtml(thumbnail)}" alt="" loading="lazy">` : ""}
        <span class="home-live-thumb-fallback" aria-hidden="true">MASANO <b>TV</b></span>
        <span class="home-live-badge${live ? "" : " is-soon"}">${live ? "● EN DIRECT" : "BIENTÔT"}</span>
        <span class="home-live-play" aria-hidden="true"></span>
      </span>
      <strong>${escapeHtml(item.titre)}</strong>
      <small>${escapeHtml(meta)}</small>
    </a>`;
  };

  const liveStripMarkup = () => {
    const onAir = tvDirects.filter((item) => item.statut === "en_direct");
    const soon = tvDirects.filter((item) => item.statut === "programme" && isNearby(item));
    const cards = [...onAir.map(tvCard), ...liveMatches.map(matchCard), ...soon.map(tvCard)];
    if (!cards.length) return "";
    const liveCount = onAir.length + liveMatches.length;
    return `<section class="home-live-strip" aria-label="En direct">
      <div class="home-live-head">
        <h2><span class="home-live-pulse" aria-hidden="true"></span>${liveCount ? "En direct" : "À suivre"}</h2>
        <a href="#resultats">Live Center</a>
      </div>
      <div class="home-live-track" role="list" tabindex="0">${cards.join("")}</div>
    </section>`;
  };

  const render = () => {
    if (!active) return;
    const previews = tvContents.slice(0, 2);
    const strip = liveStripMarkup();
    const hasLive = liveMatches.length > 0 || tvDirects.some((item) => item.statut === "en_direct");
    if (!strip && !previews.length) {
      root.hidden = true;
      root.innerHTML = "";
      window.dispatchEvent(new CustomEvent("masano-tv-live-update", { detail: { live: false } }));
      return;
    }

    root.innerHTML = `${strip}${previews.length ? `<section class="pwa-tv-preview-list" aria-labelledby="pwaTvPreviewTitle">
      <div class="pwa-tv-preview-heading"><h2 id="pwaTvPreviewTitle">Sur Masano TV</h2><a href="#tv">Tout voir</a></div>
      <div class="pwa-tv-preview-cards">${previews.map((item) => `<a class="pwa-tv-preview-card" href="#tv" data-tv-id="${escapeHtml(item.id)}">
        ${tvThumbnail(item) ? `<img src="${escapeHtml(tvThumbnail(item))}" alt="" loading="lazy">` : `<span class="pwa-tv-preview-placeholder" aria-hidden="true"></span>`}
        <strong>${escapeHtml(item.titre)}</strong>
        <small>${escapeHtml(item.emission_nom || (item.type === "resume" ? "Résumé" : "Émission"))}</small>
      </a>`).join("")}</div>
    </section>` : ""}`;
    root.hidden = false;
    window.dispatchEvent(new CustomEvent("masano-tv-live-update", { detail: { live: hasLive } }));
  };

  // Un clic mémorise ce qu'il faut ouvrir ; la page cible (Live Center / Masano TV) le récupère.
  const onClick = (event) => {
    const tv = event.target.closest("[data-tv-id]");
    const match = event.target.closest("[data-live-match]");
    try {
      if (tv) sessionStorage.setItem(PENDING_TV_KEY, tv.dataset.tvId);
      else if (match) sessionStorage.setItem(PENDING_MATCH_KEY, `${match.dataset.liveMatch}|${Date.now()}`);
    } catch (error) {
      console.error("Impossible de mémoriser l’élément à ouvrir.", error);
    }
  };
  // Logo ou miniature introuvable : on retire l'image, les initiales / le repli restent visibles.
  const onImageError = (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (image.classList.contains("home-live-logo-img") || image.classList.contains("home-live-thumb-img")) image.remove();
  };
  root.addEventListener("click", onClick);
  root.addEventListener("error", onImageError, true);

  const loadContents = async () => {
    const columns = "id,type,titre,emission_nom,sport,competition,statut,debut,miniature_url,hls_url,video_url,publie,created_at";
    const [directs, others] = await Promise.all([
      supabase.from("tv_contenus").select(columns).eq("publie", true).eq("type", "direct")
        .in("statut", ["en_direct", "programme"])
        .order("debut", { ascending: false, nullsFirst: false }).limit(6),
      supabase.from("tv_contenus").select(columns).eq("publie", true).neq("type", "direct")
        .order("debut", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }).limit(4)
    ]);
    if (!active) return;
    if (directs.error || others.error) {
      console.error("Impossible de charger l’aperçu Masano TV.", directs.error || others.error);
      return;
    }
    tvDirects = directs.data || [];
    tvContents = others.data || [];
    render();
  };

  const loadLiveMatches = async () => {
    await Promise.all(liveMatchSources.map(async ([label, fetchMatches]) => {
      try {
        matchSourceData.set(label, await fetchMatches());
      } catch (error) {
        console.error(`Impossible de charger les événements en direct (${label}).`, error);
      }
    }));
    if (!active) return;
    const matchesByKey = new Map();
    for (const matches of matchSourceData.values()) {
      for (const match of matches) {
        if (match.statut === "live") matchesByKey.set(liveMatchKey(match), match);
      }
    }
    liveMatches = [...matchesByKey.values()].sort((first, second) =>
      String(first.competition).localeCompare(String(second.competition), "fr")
    );
    render();
  };

  void loadContents();
  void loadLiveMatches();
  channel = supabase.channel("masano-tv-home-preview")
    .on("postgres_changes", { event: "*", schema: "public", table: "tv_contenus" }, () => { void loadContents(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "matchs" }, () => { void loadLiveMatches(); })
    .on("postgres_changes", { event: "*", schema: "public", table: "epf_kin_matches" }, () => { void loadLiveMatches(); })
    .subscribe();
  const refreshTimer = window.setInterval(() => { void loadLiveMatches(); }, 60000);

  return () => {
    active = false;
    window.clearInterval(refreshTimer);
    root.removeEventListener("click", onClick);
    root.removeEventListener("error", onImageError, true);
    if (channel) void supabase.removeChannel(channel);
  };
};

let hlsLoader;
const loadHls = () => {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoader) {
    hlsLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js";
      script.onload = () => resolve(window.Hls);
      script.onerror = () => reject(new Error("Le lecteur HLS n’a pas pu être chargé."));
      document.head.append(script);
    });
  }
  return hlsLoader;
};

export const mountTv = (root) => {
  let contents = [];
  let selectedId = "";
  let activeContentType = "direct";
  let activeSport = "Toutes";
  let player = null;
  let hls = null;
  let retryTimer = null;
  let active = true;

  const stopPlayer = () => {
    clearTimeout(retryTimer);
    retryTimer = null;
    hls?.destroy();
    hls = null;
    if (player) {
      player.pause?.();
      player.removeAttribute("src");
      player.load?.();
      player = null;
    }
  };

  const playerMarkup = (content) => {
    if (!content) {
      return `<div class="tv-player-empty"><span aria-hidden="true">▶</span><p>Sélectionnez une émission ou un programme pour le regarder ici.</p></div>`;
    }
    const source = mediaSource(content);
    if (content.type === "direct" && content.statut === "programme") {
      return `<div class="tv-player-empty"><span aria-hidden="true">◷</span><p>Ce direct est programmé${content.debut ? ` pour le ${escapeHtml(formatDate(content.debut))}` : ""}.</p></div>`;
    }
    if (source.type === "iframe") {
      return `<iframe class="tv-player-frame" src="${escapeHtml(source.url)}" title="${escapeHtml(source.title)}" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
    }
    if (source.type === "hls") {
      return `<video class="tv-player-video" controls playsinline preload="metadata" data-tv-hls="${escapeHtml(source.url)}"></video>`;
    }
    if (source.type === "video") {
      return `<video class="tv-player-video" controls playsinline preload="metadata" src="${escapeHtml(source.url)}"></video>`;
    }
    return `<div class="tv-player-empty"><span aria-hidden="true">▶</span><p>Cette vidéo ne peut pas être lue dans le lecteur TV. Utilisez un lien Google Drive ouvert à tous, YouTube, HLS ou un fichier MP4.</p></div>`;
  };

  const cardMarkup = (content) => `<button type="button" class="tv-content-card${content.id === selectedId ? " is-selected" : ""}" data-tv-id="${escapeHtml(content.id)}">
    ${tvThumbnail(content)
      ? `<img src="${escapeHtml(tvThumbnail(content))}" alt="" loading="lazy">`
      : `<span class="tv-card-placeholder" aria-hidden="true">▶</span>`}
    <span class="tv-card-copy">
      <small>${content.type === "direct" && content.statut === "en_direct" ? `<span class="tv-live-label">● EN DIRECT</span>` : escapeHtml(statusLabel(content.statut))}${content.debut ? ` · ${escapeHtml(formatDate(content.debut))}` : ""}</small>
      <strong>${escapeHtml(content.titre)}</strong>
      ${content.emission_nom ? `<span>${escapeHtml(content.emission_nom)}</span>` : ""}
    </span>
  </button>`;

  const sectionMarkup = (title, items) => items.length
    ? `<section class="tv-library-section"><h2>${escapeHtml(title)}</h2><div class="tv-content-grid">${items.map(cardMarkup).join("")}</div></section>`
    : "";

  const initializePlayer = async () => {
    const video = root.querySelector("[data-tv-hls]");
    if (!video) return;
    player = video;
    const source = video.dataset.tvHls;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source;
      return;
    }
    try {
      const Hls = await loadHls();
      if (!active || player !== video) return;
      if (!Hls?.isSupported()) throw new Error("Ce navigateur ne prend pas en charge la lecture HLS.");
      hls = new Hls();
      hls.loadSource(source);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const message = root.querySelector("#tvPlayerMessage");
        if (message) message.textContent = "";
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        const message = root.querySelector("#tvPlayerMessage");
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // Le signal OBS n'est pas encore arrivé : on réessaie toutes les 5 s sans recharger la page.
          if (message) message.textContent = "En attente du signal du direct… la lecture démarrera automatiquement.";
          clearTimeout(retryTimer);
          const current = hls;
          retryTimer = setTimeout(() => { if (active && hls === current) current.loadSource(source); }, 5000);
          return;
        }
        if (message) message.textContent = "Le flux vidéo est momentanément indisponible.";
      });
    } catch (error) {
      console.error("Impossible de démarrer le lecteur HLS.", error);
      const message = root.querySelector("#tvPlayerMessage");
      if (message) message.textContent = error.message;
    }
  };

  const render = () => {
    const typeContents = contents.filter((item) => activeContentType === "matchs"
      ? ["resume", "recap"].includes(item.type)
      : item.type === activeContentType);
    const visibleContents = activeSport === "Toutes"
      ? typeContents
      : typeContents.filter((item) => item.sport?.toLowerCase().includes(activeSport.toLowerCase()));
    const live = visibleContents.filter((item) => item.type === "direct" && item.statut === "en_direct");
    const selected = visibleContents.find((item) => item.id === selectedId) || live[0] || visibleContents[0] || null;
    selectedId = selected?.id || "";
    const source = selected ? mediaSource(selected) : { type: "none" };
    const title = selected?.titre || (live.length ? "En direct" : "Masano TV");
    root.innerHTML = `<nav class="pwa-tv-type-nav" aria-label="Catégories TV">
      ${[["direct","Direct"],["recap","Récaps"],["matchs","Matchs"],["emission","Émissions"]].map(([value,label]) => `<button type="button" class="${activeContentType === value ? "is-active" : ""}" data-tv-type="${value}" aria-pressed="${activeContentType === value}">${label}</button>`).join("")}
    </nav>
    <nav class="pwa-tv-sport-nav" aria-label="Filtrer par sport">
      ${["Toutes","Football","Basketball","Judo"].map((sport) => `<button type="button" class="${activeSport === sport ? "is-active" : ""}" data-tv-sport="${sport}" aria-pressed="${activeSport === sport}">${sport}</button>`).join("")}
    </nav>
    <header class="tv-page-header">
      <p class="tv-eyebrow">Masano243 · Chaîne sportive</p>
      <h1>MASANO <span>TV</span></h1>
      <p>Les directs, émissions et temps forts du sport congolais.</p>
    </header>
    <section class="tv-feature" aria-label="Lecteur Masano TV">
      <div class="tv-player">
        ${playerMarkup(selected)}
        ${selected ? `<div class="pwa-tv-player-overlay">
          ${selected.type === "direct" && selected.statut === "en_direct" ? `<span class="pwa-tv-player-live">● EN DIRECT</span>` : ""}
          <span>${escapeHtml(selected.emission_nom || selected.competition || "Masano TV")}</span>
          <button type="button" data-tv-fullscreen>⛶ Plein écran</button>
        </div>` : ""}
      </div>
      <div class="tv-feature-info">
        <div>${selected?.type === "direct" && selected.statut === "en_direct" ? `<span class="tv-live-label">● EN DIRECT</span>` : `<span class="tv-content-type">${escapeHtml(selected?.emission_nom || (selected ? statusLabel(selected.statut) : "CHAÎNE TV"))}</span>`}</div>
        <h2>${escapeHtml(title)}</h2>
        ${selected?.description ? `<p>${escapeHtml(selected.description)}</p>` : ""}
        ${selected?.sport || selected?.competition ? `<small>${escapeHtml([selected.sport, selected.competition].filter(Boolean).join(" · "))}</small>` : ""}
      </div>
    </section>
    ${sectionMarkup(activeContentType === "matchs" ? "Résumés et récapitulatifs" : activeContentType === "direct" ? "Directs et programmes" : activeContentType === "emission" ? "Émissions" : "Récaps", visibleContents)}
    ${visibleContents.length ? "" : `<p class="tv-empty">Aucun contenu disponible dans cette rubrique pour le moment.</p>`}
    ${source.type === "hls" ? `<p class="tv-player-message" id="tvPlayerMessage" role="status"></p>` : ""}`;
    root.querySelectorAll("[data-tv-type]").forEach((button) => {
      button.addEventListener("click", () => {
        activeContentType = button.dataset.tvType;
        selectedId = "";
        stopPlayer();
        render();
      });
    });
    root.querySelectorAll("[data-tv-sport]").forEach((button) => {
      button.addEventListener("click", () => {
        activeSport = button.dataset.tvSport;
        selectedId = "";
        stopPlayer();
        render();
      });
    });
    root.querySelector("[data-tv-fullscreen]")?.addEventListener("click", async () => {
      const media = root.querySelector(".tv-player iframe, .tv-player video") || root.querySelector(".tv-player");
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await media.requestFullscreen();
      } catch (error) {
        console.error("Impossible d’ouvrir Masano TV en plein écran.", error);
      }
    });
    root.querySelectorAll("[data-tv-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedId = button.dataset.tvId;
        stopPlayer();
        render();
        root.querySelector(".tv-feature")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    void initializePlayer();
  };

  const loadContents = async () => {
    stopPlayer();
    if (!supabase) {
      root.innerHTML = `<p class="tv-empty">La connexion à la télévision n’est pas configurée.</p>`;
      return;
    }
    root.innerHTML = `<p class="tv-empty">Chargement des programmes TV…</p>`;
    const { data, error } = await supabase
      .from("tv_contenus")
      .select("id,type,titre,description,emission_nom,sport,competition,statut,debut,fin,video_url,miniature_url,hls_url,replay_url,publie,created_at")
      .eq("publie", true)
      .order("debut", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (!active) return;
    if (error) {
      console.error("Impossible de charger Masano TV.", error);
      const message = error.code === "PGRST205" || error.code === "42P01"
        ? "La table TV n’est pas encore installée. Exécutez schema_tv.sql dans le SQL Editor Supabase."
        : "Les programmes TV sont momentanément indisponibles.";
      root.innerHTML = `<p class="tv-empty">${escapeHtml(message)}</p>`;
      return;
    }
    contents = data || [];
    let pendingContentId = "";
    try {
      pendingContentId = sessionStorage.getItem("masano-tv-pending-content-id") || "";
    } catch (error) {
      console.error("Impossible de récupérer le direct Masano TV demandé.", error);
    }
    if (pendingContentId) {
      const pendingContent = contents.find((item) => item.id === pendingContentId && item.type === "direct");
      if (pendingContent) {
        activeContentType = "direct";
        activeSport = "Toutes";
        selectedId = pendingContent.id;
      } else {
        console.error("Le direct Masano TV demandé n’est plus disponible.", pendingContentId);
      }
      try {
        sessionStorage.removeItem("masano-tv-pending-content-id");
      } catch (error) {
        console.error("Impossible d’effacer le direct Masano TV demandé.", error);
      }
    }
    render();
  };

  void loadContents();
  const channel = supabase?.channel("masano-tv-public")
    .on("postgres_changes", { event: "*", schema: "public", table: "tv_contenus" }, () => {
      void loadContents();
    })
    .subscribe();

  return () => {
    active = false;
    stopPlayer();
    if (channel) void supabase.removeChannel(channel);
  };
};