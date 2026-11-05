import { supabase } from "./supabaseClient.js";

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

const youtubeEmbedUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.hostname === "youtu.be" || url.hostname === "www.youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : "";
  }
  if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) return "";
  const id = url.searchParams.get("v") || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
  return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : "";
};

const mediaSource = (content) => {
  const value = content.type === "direct"
    ? (content.statut === "termine" ? content.replay_url || content.hls_url : content.hls_url || content.video_url)
    : content.video_url;
  if (!value) return { type: "none", url: "" };
  const drive = drivePreviewUrl(value);
  if (drive) return { type: "iframe", url: drive, title: "Lecteur Google Drive" };
  const youtube = youtubeEmbedUrl(value);
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
  let player = null;
  let hls = null;
  let active = true;

  const stopPlayer = () => {
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
    ${content.miniature_url
      ? `<img src="${escapeHtml(content.miniature_url)}" alt="" loading="lazy">`
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
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          const message = root.querySelector("#tvPlayerMessage");
          if (message) message.textContent = "Le flux vidéo est momentanément indisponible.";
        }
      });
    } catch (error) {
      console.error("Impossible de démarrer le lecteur HLS.", error);
      const message = root.querySelector("#tvPlayerMessage");
      if (message) message.textContent = error.message;
    }
  };

  const render = () => {
    const live = contents.filter((item) => item.type === "direct" && item.statut === "en_direct");
    const selected = contents.find((item) => item.id === selectedId) || live[0] || null;
    selectedId = selected?.id || "";
    const source = selected ? mediaSource(selected) : { type: "none" };
    const title = selected?.titre || (live.length ? "En direct" : "Masano TV");
    root.innerHTML = `<header class="tv-page-header">
      <p class="tv-eyebrow">MASANO243 · CHAÎNE SPORTIVE</p>
      <h1>MASANO <span>TV</span></h1>
      <p>Les directs, émissions et temps forts du sport congolais.</p>
    </header>
    <section class="tv-feature" aria-label="Lecteur Masano TV">
      <div class="tv-player">${playerMarkup(selected)}</div>
      <div class="tv-feature-info">
        <div>${selected?.type === "direct" && selected.statut === "en_direct" ? `<span class="tv-live-label">● EN DIRECT</span>` : `<span class="tv-content-type">${escapeHtml(selected?.emission_nom || (selected ? statusLabel(selected.statut) : "CHAÎNE TV"))}</span>`}</div>
        <h2>${escapeHtml(title)}</h2>
        ${selected?.description ? `<p>${escapeHtml(selected.description)}</p>` : ""}
        ${selected?.sport || selected?.competition ? `<small>${escapeHtml([selected.sport, selected.competition].filter(Boolean).join(" · "))}</small>` : ""}
      </div>
    </section>
    ${sectionMarkup("Directs et programmes", contents.filter((item) => item.type === "direct"))}
    ${sectionMarkup("Émissions", contents.filter((item) => item.type === "emission"))}
    ${sectionMarkup("Résumés de matchs", contents.filter((item) => item.type === "resume"))}
    ${sectionMarkup("Récaps", contents.filter((item) => item.type === "recap"))}
    ${contents.length ? "" : `<p class="tv-empty">Aucun programme TV n’est publié pour le moment.</p>`}
    ${source.type === "hls" ? `<p class="tv-player-message" id="tvPlayerMessage" role="status"></p>` : ""}`;
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
