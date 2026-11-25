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
    : youtubeThumbnail(item.type === "direct" && item.statut === "termine"
      ? item.replay_url || item.video_url
      : item.video_url);
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
    omnisports: "Omnisports",
    echo242: "Écho 242"
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
  let pinnedLiveId = "";
  let activeSport = "Toutes";
  let activeLibraryPage = "";
  const players = new Map();
  const retryTimers = new Map();
  let active = true;
  let carouselTimer = null;
  const replaySources = [fetchMatchsLocaux, fetchMatchsEpfKin, fetchMatchsInternationaux, fetchMatchsLeopards];

  const stopCarousel = () => {
    clearInterval(carouselTimer);
    carouselTimer = null;
  };

  const startCarousel = () => {
    stopCarousel();
    const track = root.querySelector("#tvRecentTrack");
    if (!active || document.hidden || !track || track.children.length < 2
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    carouselTimer = window.setInterval(() => {
      if (document.hidden || root.querySelector(".tv-playback-dialog[open]")) return;
      const slides = [...track.children];
      const firstOffset = slides[0].offsetLeft;
      const offsets = slides.map((slide) => slide.offsetLeft - firstOffset);
      const currentIndex = offsets.reduce((nearest, offset, index) =>
        Math.abs(offset - track.scrollLeft) < Math.abs(offsets[nearest] - track.scrollLeft) ? index : nearest, 0);
      const nextIndex = (currentIndex + 1) % slides.length;
      track.scrollTo({ left: offsets[nextIndex], behavior: "smooth" });
    }, 5000);
  };

  const handleCarouselVisibility = () => {
    if (document.hidden) stopCarousel();
    else startCarousel();
  };
  document.addEventListener("visibilitychange", handleCarouselVisibility);

  const stopPlayers = (container = root) => {
    container.querySelectorAll(".tv-player-video").forEach((video) => {
      clearTimeout(retryTimers.get(video));
      retryTimers.delete(video);
      players.get(video)?.destroy();
      players.delete(video);
      video.pause();
      video.removeAttribute("src");
      video.load();
    });
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

  const cardMarkup = (content, featured = false, libraryIndex = -1, showAll = false) => {
    const libraryAttributes = libraryIndex < 0 ? "" : ` data-tv-library-card data-tv-search="${escapeHtml([
      content.titre, content.description, content.emission_nom, content.sport, content.competition,
      content.statut, content.debut, content.created_at
    ].filter(Boolean).join(" "))}"`;
    return `<button type="button" class="tv-content-card${featured ? " is-featured-card" : ""}" data-tv-id="${escapeHtml(content.id)}"${libraryAttributes}${libraryIndex >= 5 && !showAll ? " hidden" : ""}>
    ${tvThumbnail(content)
      ? `<img src="${escapeHtml(tvThumbnail(content))}" alt="" loading="lazy">`
      : `<span class="tv-card-placeholder" aria-hidden="true">▶</span>`}
    <span class="tv-card-copy">
      <small>${escapeHtml(content.emission_nom || (content.type === "resume" || content.type === "recap" ? "Résumé du match" : statusLabel(content.statut)))}${content.debut ? ` · ${escapeHtml(formatDate(content.debut))}` : ""}</small>
      <strong>${escapeHtml(content.titre)}</strong>
      ${content.match_id ? `<span>${escapeHtml(content.competition || "Rencontre liée")}</span>` : content.emission_nom ? `<span>${escapeHtml(content.emission_nom)}</span>` : ""}
    </span>
  </button>`;
  };

  const sectionMarkup = (title, items, dedicated = false) => items.length
    ? `<section class="tv-library-section">
        <header class="tv-library-heading"><h2>${escapeHtml(title)}</h2>${items.length > 5 ? dedicated
          ? '<button type="button" class="tv-library-more" data-tv-open-library="recaps" aria-label="Afficher tous les résumés">Plus…</button>'
          : '<button type="button" class="tv-library-more" data-tv-expand aria-expanded="false">Plus…</button>' : ""}</header>
        ${items.length > 5 && !dedicated ? `<label class="tv-library-search" hidden><span class="visually-hidden">Rechercher dans ${escapeHtml(title)}</span><input type="search" data-tv-library-search placeholder="Rechercher…" aria-label="Rechercher dans ${escapeHtml(title)}"></label>` : ""}
        <div class="tv-content-grid">${items.map((item, index) => cardMarkup(item, false, index)).join("")}<p class="tv-library-empty" role="status" hidden>Aucun contenu ne correspond à cette recherche.</p></div>
      </section>`
    : "";

  const libraryPageMarkup = (title, items) => `<section class="tv-library-page" aria-labelledby="tvLibraryPageTitle">
    <button type="button" class="tv-library-page-back" data-tv-library-back><span aria-hidden="true">←</span> Retour à Masano TV</button>
    <header class="tv-library-page-heading">
      <p class="tv-eyebrow">MASANO TV · VIDÉOTHÈQUE</p>
      <h1 id="tvLibraryPageTitle">${escapeHtml(title)}</h1>
      <p>${items.length} résumé${items.length === 1 ? "" : "s"} disponible${items.length === 1 ? "" : "s"}</p>
    </header>
    <label class="tv-library-search tv-library-page-search"><span class="visually-hidden">Rechercher dans les résumés</span><input type="search" data-tv-page-search placeholder="Rechercher un match…" aria-label="Rechercher dans les résumés"></label>
    <div class="tv-content-grid">${items.map((item, index) => cardMarkup(item, false, index, true)).join("")}<p class="tv-library-empty" data-tv-page-empty role="status" hidden>Aucun résumé ne correspond à cette recherche.</p></div>
  </section>`;

  const bindLibraryControls = () => {
    root.querySelectorAll(".tv-library-section").forEach((section) => {
      const button = section.querySelector("[data-tv-expand]");
      const search = section.querySelector("[data-tv-library-search]");
      const cards = [...section.querySelectorAll("[data-tv-library-card]")];
      const empty = section.querySelector(".tv-library-empty");
      if (!button || !search) return;
      const filterCards = () => {
        const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
        const query = normalize(search.value);
        const expanded = button.getAttribute("aria-expanded") === "true";
        let visibleCount = 0;
        cards.forEach((card, index) => {
          const matches = !query || normalize(card.dataset.tvSearch).includes(query);
          card.hidden = !matches || (!expanded && index >= 5);
          if (!card.hidden) visibleCount += 1;
        });
        empty.hidden = visibleCount > 0;
      };
      button.addEventListener("click", () => {
        const expanded = button.getAttribute("aria-expanded") !== "true";
        button.setAttribute("aria-expanded", String(expanded));
        button.textContent = expanded ? "Moins" : "Plus…";
        search.closest(".tv-library-search").hidden = !expanded;
        if (!expanded) search.value = "";
        filterCards();
        if (expanded) search.focus();
      });
      search.addEventListener("input", filterCards);
    });
  };

  const initializePlayers = async (container = root) => {
    const videos = [...container.querySelectorAll("[data-tv-hls]")].filter((video) => !players.has(video));
    await Promise.all(videos.map(async (video) => {
      players.set(video, null);
      const source = video.dataset.tvHls;
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = source;
        return;
      }
      try {
        const Hls = await loadHls();
        if (!active || !players.has(video) || !video.isConnected) return;
        if (!Hls?.isSupported()) throw new Error("Ce navigateur ne prend pas en charge la lecture HLS.");
        const hls = new Hls();
        players.set(video, hls);
        hls.loadSource(source);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          const message = video.closest(".tv-live-feature, .tv-playback-dialog")?.querySelector(".tv-player-message");
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (message) message.textContent = "En attente du signal vidéo… la lecture démarrera automatiquement.";
            clearTimeout(retryTimers.get(video));
            retryTimers.set(video, setTimeout(() => {
              if (active && players.get(video) === hls) hls.loadSource(source);
            }, 5000));
            return;
          }
          if (message) message.textContent = "Le flux vidéo est momentanément indisponible.";
        });
      } catch (error) {
        console.error("Impossible de démarrer le lecteur HLS.", error);
        const message = video.closest(".tv-live-feature, .tv-playback-dialog")?.querySelector(".tv-player-message");
        if (message) message.textContent = error.message;
      }
    }));
  };

  const render = () => {
    stopCarousel();
    stopPlayers();
    const matchesSport = (item) => activeSport === "Toutes"
      || item.sport?.toLowerCase().includes(activeSport.toLowerCase());
    const liveItems = contents.filter((item) => item.type === "direct" && item.statut === "en_direct").sort((first, second) =>
      new Date(second.debut || second.created_at || 0) - new Date(first.debut || first.created_at || 0)
    );
    const live = liveItems.find((item) => String(item.id) === String(pinnedLiveId)) || liveItems[0] || null;
    const visible = contents.filter(matchesSport);
    const recent = visible.filter((item) => !(item.type === "direct" && item.statut !== "termine")
      && mediaSource(item).type !== "none")
      .sort((first, second) => new Date(second.debut || second.created_at || 0) - new Date(first.debut || first.created_at || 0))
      .slice(0, 3);
    const recaps = visible.filter((item) => ["resume", "recap"].includes(item.type)
      || (item.type === "direct" && item.statut === "termine" && (item.match_id || item.replay_url)));
    const emissions = visible.filter((item) => item.type === "emission");
    const upcoming = visible.filter((item) => item.type === "direct" && item.statut === "programme");
    const otherVideos = visible.filter((item) => !["direct", "resume", "recap", "emission"].includes(item.type)
      || (item.type === "direct" && item.statut === "termine" && !recaps.includes(item)));
    const allRecaps = contents.filter((item) => ["resume", "recap"].includes(item.type)
      || (item.type === "direct" && item.statut === "termine" && (item.match_id || item.replay_url)));
    const liveSource = live ? mediaSource(live) : { type: "none" };
    const recentMarkup = recent.length
      ? `<section class="tv-featured-section" aria-labelledby="tvRecentTitle">
          <div class="tv-section-heading"><h2 id="tvRecentTitle">À la une</h2><span>Les 3 dernières vidéos</span></div>
          <div class="tv-carousel">
            <button type="button" class="tv-carousel-arrow" data-carousel-move="-1" aria-label="Faire défiler vers la gauche">‹</button>
            <div class="tv-carousel-track" id="tvRecentTrack" role="list">${recent.map((item) => `<div role="listitem">${cardMarkup(item, true)}</div>`).join("")}</div>
            <button type="button" class="tv-carousel-arrow" data-carousel-move="1" aria-label="Faire défiler vers la droite">›</button>
          </div>
          <div class="tv-carousel-dots" aria-label="3 dernières vidéos">${recent.map((item, index) => `<button type="button" data-carousel-dot="${index}" aria-label="Afficher ${escapeHtml(item.titre)}"${index === 0 ? ' aria-current="true"' : ""}></button>`).join("")}</div>
        </section>`
      : `<p class="tv-empty">Aucune vidéo récente n’est disponible pour le moment.</p>`;
    const selectedContent = contents.find((item) => String(item.id) === String(selectedId));
    const mainMarkup = activeLibraryPage === "recaps"
      ? libraryPageMarkup("Résumés des matchs", allRecaps)
      : `<header class="tv-page-header">
      <p class="tv-eyebrow">MASANO243 · SPORT EN DIRECT</p>
      <h1>Masano <span>TV</span></h1>
      <p>Matchs, résumés et émissions à regarder.</p>
    </header>
    ${live ? `<section class="tv-live-feature" aria-label="Direct en cours">
      <div class="tv-live-feature-heading"><span class="tv-live-label"><i></i> EN DIRECT</span><span>${escapeHtml([live.sport, live.competition].filter(Boolean).join(" · ") || "Masano TV")}</span></div>
      <div class="tv-player tv-live-player" data-tv-player-shell>
        ${playerMarkup(live)}
        <div class="pwa-tv-player-overlay"><span class="pwa-tv-player-live">● EN DIRECT</span><button type="button" data-tv-fullscreen>⛶ Plein écran</button></div>
      </div>
      <div class="tv-feature-info"><h2>${escapeHtml(live.titre)}</h2>${live.description ? `<p>${escapeHtml(live.description)}</p>` : ""}</div>
      ${liveSource.type === "hls" ? `<p class="tv-player-message" role="status"></p>` : ""}
    </section>` : ""}
    <nav class="pwa-tv-sport-nav" aria-label="Filtrer par sport">
      ${["Toutes", "Football", "Basketball", "Judo"].map((sport) => `<button type="button" class="${activeSport === sport ? "is-active" : ""}" data-tv-sport="${sport}" aria-pressed="${activeSport === sport}">${sport}</button>`).join("")}
    </nav>
    ${recentMarkup}
    ${sectionMarkup("Résumés des matchs", recaps, true)}
    ${sectionMarkup("Émissions", emissions)}
    ${sectionMarkup("Prochains directs", upcoming)}
    ${sectionMarkup("Autres vidéos", otherVideos)}`;
    root.innerHTML = `${mainMarkup}
    <dialog class="tv-playback-dialog" aria-labelledby="tvPlaybackTitle"${selectedContent ? " open" : ""}>
      <div class="tv-playback-dialog-inner">
        <button type="button" class="tv-playback-close" data-tv-close aria-label="Fermer la vidéo">×</button>
        <div class="tv-player" data-tv-player-shell>${selectedContent ? playerMarkup(selectedContent) : ""}</div>
        <div class="tv-feature-info">
          <small>${escapeHtml(selectedContent?.competition || selectedContent?.emission_nom || "Masano TV")}</small>
          <h2 id="tvPlaybackTitle">${escapeHtml(selectedContent?.titre || "Lecture vidéo")}</h2>
          ${selectedContent?.description ? `<p>${escapeHtml(selectedContent.description)}</p>` : ""}
          <button type="button" class="tv-playback-fullscreen" data-tv-fullscreen>⛶ Plein écran</button>
          <p class="tv-player-message" role="status"></p>
        </div>
      </div>
    </dialog>`;
    bindLibraryControls();
    root.querySelector("[data-tv-library-back]")?.addEventListener("click", () => {
      activeLibraryPage = "";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    root.querySelector("[data-tv-open-library='recaps']")?.addEventListener("click", () => {
      activeLibraryPage = "recaps";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    const pageSearch = root.querySelector("[data-tv-page-search]");
    pageSearch?.addEventListener("input", () => {
      const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").trim();
      const query = normalize(pageSearch.value);
      const cards = [...root.querySelectorAll("[data-tv-library-card]")];
      let visibleCount = 0;
      cards.forEach((card) => {
        card.hidden = !normalize(card.dataset.tvSearch).includes(query);
        if (!card.hidden) visibleCount += 1;
      });
      const empty = root.querySelector("[data-tv-page-empty]");
      if (empty) empty.hidden = visibleCount > 0;
    });
    root.querySelectorAll("[data-tv-sport]").forEach((button) => {
      button.addEventListener("click", () => {
        activeSport = button.dataset.tvSport;
        selectedId = "";
        render();
      });
    });
    root.querySelectorAll("[data-tv-fullscreen]").forEach((button) => button.addEventListener("click", async () => {
      const shell = button.closest("[data-tv-player-shell]");
      const media = shell?.querySelector("iframe, video") || shell;
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await media?.requestFullscreen();
      } catch (error) {
        console.error("Impossible d’ouvrir Masano TV en plein écran.", error);
      }
    }));
    root.querySelectorAll("[data-tv-id]").forEach((button) => button.addEventListener("click", () => {
      const content = contents.find((item) => String(item.id) === button.dataset.tvId);
      if (!content) return;
      selectedId = String(content.id);
      const dialog = root.querySelector(".tv-playback-dialog");
      const body = dialog.querySelector(".tv-playback-dialog-inner");
      body.innerHTML = `<button type="button" class="tv-playback-close" data-tv-close aria-label="Fermer la vidéo">×</button>
        <div class="tv-player" data-tv-player-shell>${playerMarkup(content)}</div>
        <div class="tv-feature-info"><small>${escapeHtml(content.competition || content.emission_nom || "Masano TV")}</small><h2 id="tvPlaybackTitle">${escapeHtml(content.titre)}</h2>
          ${content.description ? `<p>${escapeHtml(content.description)}</p>` : ""}<button type="button" class="tv-playback-fullscreen" data-tv-fullscreen>⛶ Plein écran</button><p class="tv-player-message" role="status"></p></div>`;
      dialog.showModal();
      body.querySelector("[data-tv-close]").addEventListener("click", () => dialog.close());
      body.querySelector("[data-tv-fullscreen]").addEventListener("click", async (event) => {
        const shell = event.currentTarget.closest("[data-tv-player-shell]");
        const media = shell?.querySelector("iframe, video") || shell;
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await media?.requestFullscreen();
        } catch (error) {
          console.error("Impossible d’ouvrir la vidéo Masano TV en plein écran.", error);
        }
      });
      void initializePlayers(body);
    }));
    const dialog = root.querySelector(".tv-playback-dialog");
    dialog.querySelector("[data-tv-close]")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      stopPlayers(dialog);
      dialog.querySelectorAll("iframe").forEach((frame) => frame.setAttribute("src", "about:blank"));
      selectedId = "";
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    root.querySelectorAll("[data-carousel-move]").forEach((button) => button.addEventListener("click", () => {
      const track = root.querySelector("#tvRecentTrack");
      const firstCard = track?.firstElementChild;
      const step = firstCard ? firstCard.getBoundingClientRect().width + 14 : 240;
      track?.scrollBy({ left: Number(button.dataset.carouselMove) * step, behavior: "smooth" });
    }));
    root.querySelectorAll("[data-carousel-dot]").forEach((button) => button.addEventListener("click", () => {
      const card = root.querySelectorAll("#tvRecentTrack > div")[Number(button.dataset.carouselDot)];
      card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }));
    const track = root.querySelector("#tvRecentTrack");
    track?.addEventListener("scroll", () => {
      const cards = [...track.children];
      const index = cards.reduce((nearest, card, candidate) =>
        Math.abs(card.offsetLeft - track.scrollLeft) < Math.abs(cards[nearest].offsetLeft - track.scrollLeft) ? candidate : nearest, 0);
      root.querySelectorAll("[data-carousel-dot]").forEach((dot, dotIndex) => {
        if (dotIndex === index) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
    }, { passive: true });
    const carouselSection = root.querySelector(".tv-featured-section");
    carouselSection?.addEventListener("mouseenter", stopCarousel);
    carouselSection?.addEventListener("mouseleave", startCarousel);
    carouselSection?.addEventListener("focusin", stopCarousel);
    carouselSection?.addEventListener("focusout", (event) => {
      if (!carouselSection.contains(event.relatedTarget)) startCarousel();
    });
    startCarousel();
    void initializePlayers();
  };

  const loadContents = async () => {
    stopPlayers();
    if (!supabase) {
      root.innerHTML = `<p class="tv-empty">La connexion à la télévision n’est pas configurée.</p>`;
      return;
    }
    root.innerHTML = `<p class="tv-empty">Chargement des programmes TV…</p>`;
    const [contentResult, replayResults] = await Promise.all([
      supabase
        .from("tv_contenus")
        .select("id,type,titre,description,emission_nom,sport,competition,statut,debut,fin,video_url,miniature_url,hls_url,replay_url,match_id,publie,created_at")
        .eq("publie", true)
        .order("debut", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      Promise.allSettled(replaySources.map((fetchMatches) => fetchMatches()))
    ]);
    const { data, error } = contentResult;
    if (!active) return;
    if (error) {
      console.error("Impossible de charger Masano TV.", error);
      const message = error.code === "PGRST205" || error.code === "42P01"
        ? "La table TV n’est pas encore installée. Exécutez schema_tv.sql dans le SQL Editor Supabase."
        : "Les programmes TV sont momentanément indisponibles.";
      root.innerHTML = `<p class="tv-empty">${escapeHtml(message)}</p>`;
      return;
    }
    const tvContents = data || [];
    const linkedMatchIds = new Set(tvContents.map((item) => String(item.match_id || "")).filter(Boolean));
    const matchReplays = replayResults.flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .filter((match) => match.resume_video_url && !linkedMatchIds.has(String(match.id)))
      .map((match) => ({
        id: `match-replay-${match.source || "match"}-${match.id}`,
        type: "resume",
        titre: `${match.equipe_domicile} – ${match.equipe_visiteur}`,
        description: "Résumé vidéo de la rencontre",
        sport: match.sport || "Football",
        competition: match.competition || "Football",
        statut: "termine",
        debut: match.date_match || null,
        video_url: match.resume_video_url,
        miniature_url: match.resume_video_thumbnail || null,
        match_id: String(match.id),
        publie: true
      }));
    contents = [...tvContents, ...matchReplays];
    let pendingContentId = "";
    try {
      pendingContentId = sessionStorage.getItem("masano-tv-pending-content-id") || "";
    } catch (error) {
      console.error("Impossible de récupérer le direct Masano TV demandé.", error);
    }
    if (pendingContentId) {
      const pendingContent = contents.find((item) => item.id === pendingContentId && item.type === "direct");
      if (pendingContent) {
        activeSport = "Toutes";
        pinnedLiveId = String(pendingContent.id);
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
    stopCarousel();
    document.removeEventListener("visibilitychange", handleCarouselVisibility);
    stopPlayers();
    if (channel) void supabase.removeChannel(channel);
  };
};
