import { scoopSupabase, supabase } from "./supabaseClient.js";
import { mountResults } from "./src_results.js";
import {
  fetchMatchsEpfKin,
  fetchMatchsInternationaux,
  fetchMatchsLeopards,
  fetchMatchsLocaux
} from "./services/sportsService.js";

let articles = [];
let resultsCleanup;

const categoryLabels = {
  linafoot: "LINAFOOT",
  "linafoot-l1": "Linafoot L1",
  "linafoot-l2": "Linafoot L2",
  leopards: "LÉOPARDS",
  football: "Football",
  interclubs: "Interclubs",
  international: "International",
  "basket-ball": "Basket-ball",
  judo: "Judo",
  omnisports: "Omnisports",
  resultats: "Résultats",
  "rendez-vous": "Rendez-vous",
  interview: "Interview",
  portrait: "Portrait"
};

const categoryAliases = {
  leopards: ["equipe-nationale"],
  "linafoot-l1": ["linafoot-ligue-1", "linafoot-1"],
  "linafoot-l2": ["linafoot-ligue-2", "linafoot-2"],
  interclubs: ["inter-clubs"],
  international: ["football-international"],
  "basket-ball": ["basketball"]
};

const categoryGroups = {
  football: new Set(["football", "linafoot", "linafoot-l1", "linafoot-l2", "leopards", "equipe-nationale", "interclubs", "inter-clubs", "international", "football-international"]),
  "basket-ball": new Set(["basket-ball", "basketball"]),
  judo: new Set(["judo"]),
  omnisports: new Set(["omnisports"])
};

const homeCategorySections = [
  { slug: "football", title: "Football" },
  { slug: "basket-ball", title: "Basketball" },
  { slug: "judo", title: "Judo" },
  { slug: "omnisports", title: "Omnisports" }
];

const footballCompetitionRoutes = {
  l1: { competition: "linafoot_l1", title: "Linafoot L1", view: "all", layout: "league" },
  l2: { competition: "linafoot_l2", title: "Linafoot L2", view: "all", layout: "league" },
  "epf-kin": { competition: "epf_kin", title: "EPF-KIN", view: "all", layout: "league" },
  leopards: { competition: "leopards", title: "Léopards", view: "matches", layout: "leopards" }
};

const disciplineEventRoutes = {
  "basket-ball/evenements": { competition: "basketball", title: "Basketball · Événements", view: "matches", discipline: "basketball", layout: "events" },
  "judo/evenements": { competition: "judo", title: "Judo · Événements", view: "matches", discipline: "judo", layout: "events" },
  "omnisports/evenements": { competition: "omnisports", title: "Omnisports · Événements", view: "matches", discipline: "omnisports", layout: "events" }
};

// Interclubs et International sont désormais de simples pages d'événements (plus d'actualités).
const footballEventRoutes = {
  "football/interclubs": { competition: "interclubs", title: "Interclubs (CAF)", view: "matches", layout: "interclubs" },
  "football/international": { competition: "international", title: "International", view: "matches", discipline: "international", layout: "international" }
};

// Les anciens liens .../actualites et .../evenements d'Interclubs et International redirigent vers la page unique.
const normalizeRoute = (route) => route.replace(/^football\/(interclubs|international)\/(?:actualites|evenements)$/, "football/$1");

const sectionNewsCategories = {
  "football/actualites": "football",
  "basket-ball/actualites": "basket-ball",
  "judo/actualites": "judo",
  "omnisports/actualites": "omnisports"
};

const sectionNavigation = {
  football: [
    ["Actualités", "#football/actualites"],
    ["Linafoot L1", "#football/l1"],
    ["Linafoot L2", "#football/l2"],
    ["Léopards", "#football/leopards"],
    ["EPF-KIN", "#football/epf-kin"],
    ["Interclubs (CAF)", "#football/interclubs"],
    ["International", "#football/international"]
  ],
  "basket-ball": [["Actualités", "#basket-ball/actualites"], ["Événements", "#basket-ball/evenements"]],
  judo: [["Actualités", "#judo/actualites"], ["Événements", "#judo/evenements"]],
  omnisports: [["Actualités", "#omnisports/actualites"], ["Événements", "#omnisports/evenements"]]
};

const normalizeCategory = (category) => String(category || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

// Une catégorie d'article peut contenir plusieurs valeurs (« Football, Judo »). L'article appartient
// à une rubrique si au moins une de ses valeurs correspond à cette rubrique, et à aucune autre.
const categoryTokens = (value) => String(value || "")
  .split(/[,;/|·>]+/)
  .map(normalizeCategory)
  .filter(Boolean);

const articleMatchesCategory = (article, category) => {
  const accepted = [...new Set([...(categoryGroups[category] || []), category, ...(categoryAliases[category] || [])])];
  return categoryTokens(article.category).some((token) => accepted.some((slug) => token === slug || token.startsWith(`${slug}-`)));
};

const renderSectionNavigation = (route) => {
  const section = route.split("/")[0];
  const links = sectionNavigation[section];
  const row = document.getElementById("sectionNavRow");
  const nav = document.getElementById("sectionNav");
  if (!row || !nav) return;
  document.querySelectorAll(".nav-left > a").forEach((link) => {
    const href = link.getAttribute("href");
    link.classList.toggle("is-active", href === `#${section}` || href.endsWith(`#${section}`));
  });
  if (!links) {
    row.hidden = true;
    nav.replaceChildren();
    return;
  }
  row.hidden = false;
  const linkPrefix = document.getElementById("listViewContainer") ? "" : "index.html";
  nav.innerHTML = links.map(([label, href]) => {
    const isActive = href.slice(1) === route
      || (route === section && href === `#${section}/actualites`);
    return `<a href="${linkPrefix}${href}"${isActive ? ' class="is-active" aria-current="page"' : ""}>${label}</a>`;
  }).join("");
};

const refreshLiveNavigation = async () => {
  const sources = await Promise.allSettled([
    fetchMatchsLocaux(),
    fetchMatchsEpfKin(),
    fetchMatchsInternationaux(),
    fetchMatchsLeopards()
  ]);
  const liveMatches = new Map();
  for (const source of sources) {
    if (source.status !== "fulfilled") continue;
    for (const match of source.value) {
      if (match.statut === "live") liveMatches.set(match.id, match);
    }
  }
  const liveCount = liveMatches.size;
  document.querySelectorAll(".nav-live").forEach((link) => {
    link.classList.toggle("is-live", liveCount > 0);
    link.setAttribute("aria-label", `Live Center, ${liveCount} match${liveCount === 1 ? "" : "s"} en direct`);
  });
};

const normalizeArticle = (article) => {
  const columnPhotos = Object.keys(article)
    .filter((key) => /^photo_[1-9]\d*$/.test(key))
    .sort((first, second) => Number(first.slice(6)) - Number(second.slice(6)))
    .map((key) => article[key])
    .filter((photo) => typeof photo === "string" && photo.trim())
    .map((url) => ({ url }));
  const legacyPhotos = Array.isArray(article.photos)
    ? article.photos.map((photo) => typeof photo === "string" ? { url: photo } : photo)
    : [];
  const content = article.contenu ?? article.content ?? article.body ?? "";
  const body = Array.isArray(content)
    ? content
    : String(content).split(/\r?\n(?:\s*\r?\n)*/).filter((paragraph) => paragraph.trim());

  return {
    ...article,
    id: String(article.id),
    title: article.titre || article.title || "",
    excerpt: article.chapeau || article.excerpt || article.summary || "",
    category: article.categorie || article.category || "",
    author: article.publie_par || article.author || "Masano243",
    date: article.created_at || article.published_at || article.date || "",
    image: columnPhotos[0]?.url || article.image || article.image_url || "",
    body,
    photos: columnPhotos.length ? columnPhotos : legacyPhotos
  };
};

export const fetchArticles = async () => {
  if (!supabase) {
    throw new Error("Supabase n'est pas configuré : aucun article ne peut être chargé.");
  }

  const { data, error } = await supabase
    .from("articles")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(normalizeArticle);
};

const loadArticles = async () => {
  try {
    articles = sortedArticles(await fetchArticles());
  } catch (error) {
    console.error("Impossible de charger les articles depuis Supabase.", error);
    articles = [];
  }
};

let laUneArticles = [];
let laUneIndex = 0;
let laUneTimer;
let laUnePaused = false;

const PLACEHOLDER_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='360'%3E%3Crect width='900' height='360' fill='%23e9e9e9'/%3E%3C/svg%3E";
const EMPTY_NEWS_MESSAGE = "Aucune actualité n'est disponible pour le moment.";

const sortedArticles = (items) => [...items].sort((first, second) => {
  const firstDate = first.created_at || first.date || "";
  const secondDate = second.created_at || second.date || "";
  return String(secondDate).localeCompare(String(firstDate));
});

const formatArticleDate = (value) => {
  const parsed = new Date(value);
  return value && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(parsed)
    : String(value || "");
};

// Déplace la piste du carrousel : la transition « slide » est gérée en CSS (transform).
const setLaUneIndex = (index) => {
  const track = document.getElementById("heroTrack");
  if (!track || !laUneArticles.length) return;
  laUneIndex = (index + laUneArticles.length) % laUneArticles.length;
  track.style.transform = `translate3d(${-laUneIndex * 100}%, 0, 0)`;
  track.querySelectorAll(".hero-slide").forEach((slide, slideIndex) => {
    const active = slideIndex === laUneIndex;
    slide.setAttribute("aria-hidden", String(!active));
    slide.tabIndex = active ? 0 : -1;
  });
  document.getElementById("carouselPosition").textContent = `${laUneIndex + 1} / ${laUneArticles.length}`;
};

const renderLaUne = (items = articles) => {
  const track = document.getElementById("heroTrack");
  if (!track) return;
  laUneArticles = sortedArticles(items).slice(0, 5);
  track.style.transition = "none";
  track.innerHTML = laUneArticles.map((article, index) => `<a class="hero-slide hero-link" href="#read/${escapeHtml(article.id)}" role="group" aria-roledescription="diapositive" aria-label="${index + 1} sur ${laUneArticles.length}">
    <div class="hero-img-container"><img class="hero-img" src="${escapeHtml(article.image || PLACEHOLDER_IMAGE)}" alt="${escapeHtml(article.title)}"${index ? ' loading="lazy"' : ""}></div>
    <div class="hero-body">
      <h3 class="hero-title lead-title">${escapeHtml(article.title)}</h3>
      <p class="hero-excerpt lead-summary">${escapeHtml(article.excerpt)}</p>
      <div class="hero-meta article-meta">Par ${escapeHtml(article.author)} • ${escapeHtml(article.date)}</div>
    </div>
  </a>`).join("");
  setLaUneIndex(0);
  void track.offsetWidth;
  track.style.transition = "";
  const controls = document.querySelector("#heroCarousel .carousel-controls");
  if (controls) controls.hidden = laUneArticles.length < 2;
};

const moveLaUne = (step) => {
  if (laUneArticles.length > 1) setLaUneIndex(laUneIndex + step);
};

const fetchFlashArticles = async () => {
  const track = document.getElementById("flashTickerTrack");
  if (!track) return;
  if (!supabase) {
    track.innerHTML = `<span class="flash-ticker-item">Connectez Supabase pour afficher les actualités.</span>`;
    return;
  }
  const { data, error } = await supabase
    .from("flash")
    .select("id, info")
    .order("id", { ascending: false })
    .limit(10);
  if (error) {
    console.error("Impossible de charger les flash infos depuis Supabase.", error);
    track.innerHTML = `<span class="flash-ticker-item">Les flash infos sont momentanément indisponibles.</span>`;
    return;
  }
  if (!data?.length) {
    track.innerHTML = `<span class="flash-ticker-item">Aucune flash info pour le moment.</span>`;
    return;
  }
  const items = data.map((flash) => `<span class="flash-ticker-item">${escapeHtml(flash.info)}</span>`);
  track.innerHTML = data.length > 1 ? [...items, ...items].join("") : items.join("");
};

const fetchPhotoReportage = async () => {
  const grid = document.getElementById("photoReportageGrid");
  if (!grid || !supabase) {
    if (grid) grid.innerHTML = `<p class="data-status">Les reportages photo seront bientôt disponibles.</p>`;
    return;
  }
  const { data, error } = await supabase
    .from("photo_reports")
    .select("image_url, caption, created_at")
    .order("created_at", { ascending: false })
    .limit(12);
  if (error || !data?.length) {
    grid.innerHTML = `<p class="data-status">Les reportages photo seront bientôt disponibles.</p>`;
    return;
  }
  grid.innerHTML = data.map((report) => `<figure class="photo-reportage-item">
    <img src="${escapeHtml(report.image_url)}" alt="${escapeHtml(report.caption || "Reportage photo")}" loading="lazy">
    ${report.caption ? `<figcaption class="photo-reportage-caption">${escapeHtml(report.caption)}</figcaption>` : ""}
  </figure>`).join("");
};

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
}[character]));

const renderArticleText = (value) => escapeHtml(value)
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  .replace(/__(.+?)__/g, "<em>$1</em>");

const getArticle = (id) => articles.find((article) => article.id === id) || articles[0];

const fetchScoopLatestArticle = async () => {
  const image = document.getElementById("scoop-widget-img");
  const title = document.getElementById("scoop-widget-title");
  const excerpt = document.getElementById("scoop-widget-excerpt");
  if (!image || !title || !excerpt) return;
  if (!scoopSupabase) {
    title.textContent = "Connexion Scoop243 indisponible";
    excerpt.textContent = "La configuration de la base Scoop243 est manquante.";
    return;
  }

  const { data, error } = await scoopSupabase
    .from("articles")
    .select("title, excerpt, image_url, published_at, created_at")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Impossible de charger le dernier article Scoop243.", error);
    title.textContent = "Article Scoop243 indisponible";
    excerpt.textContent = `Erreur Supabase${error.code ? ` (${error.code})` : ""} : ${error.message}`;
    return;
  }
  if (!data) {
    title.textContent = "Aucun article Scoop243";
    excerpt.textContent = "Aucun article n’est disponible pour le moment.";
    image.removeAttribute("src");
    image.alt = "";
    return;
  }

  title.textContent = data.title || "Article Scoop243";
  excerpt.textContent = data.excerpt || "";
  if (data.image_url) {
    image.src = data.image_url;
    image.alt = data.title || "Article Scoop243";
  } else {
    image.removeAttribute("src");
    image.alt = "";
  }
};

const renderArticleCard = (article) => `<a class="post-mini" href="#read/${article.id}" role="listitem">
  <img src="${escapeHtml(article.image)}" alt="${escapeHtml(article.title)}" loading="lazy">
  <span class="post-mini-title">${escapeHtml(article.title)}</span>
</a>`;

const renderArticleListItem = (article) => `<a class="article-list-item" href="#read/${escapeHtml(article.id)}" role="listitem">
  <img src="${escapeHtml(article.image || PLACEHOLDER_IMAGE)}" alt="${escapeHtml(article.title)}" loading="lazy">
  <span class="article-list-body">
    <span class="article-list-meta">${escapeHtml(article.category)}${article.date ? ` · ${escapeHtml(formatArticleDate(article.date))}` : ""}</span>
    <strong class="article-list-title">${escapeHtml(article.title)}</strong>
    <span class="article-list-excerpt">${escapeHtml(article.excerpt)}</span>
  </span>
</a>`;

const renderHomeCategorySections = (items) => homeCategorySections.map(({ slug, title }) => {
  const categoryArticles = items.filter((article) => articleMatchesCategory(article, slug)).slice(0, 5);
  const content = categoryArticles.length
    ? `<div class="posts-grid category-posts-grid" role="list">${categoryArticles.map(renderArticleCard).join("")}</div>`
    : `<p class="data-status empty-state">${EMPTY_NEWS_MESSAGE}</p>`;
  return `<section class="home-category-section" aria-labelledby="home-${slug}-title">
    <header class="home-category-header">
      <h2 class="section-title" id="home-${slug}-title">${title}</h2>
      <a href="#${slug}" class="home-category-more">Toute la rubrique</a>
    </header>
    ${content}
  </section>`;
}).join("");

const articlePhotoItems = (photos) => (Array.isArray(photos) ? photos : [])
  .map((photo) => typeof photo === "string" ? { url: photo } : photo)
  .filter((photo) => photo && typeof photo.url === "string" && photo.url.trim());

const renderInlineArticleBody = (paragraphs, photos, title, primaryImage) => {
  const inlinePhotos = articlePhotoItems(photos);
  const primaryPhotoIndex = inlinePhotos.findIndex((photo) => photo.url === primaryImage);
  if (primaryPhotoIndex !== -1) inlinePhotos.splice(primaryPhotoIndex, 1);

  let photoIndex = 0;
  const renderPhoto = (photo) => `<figure class="article-inline-photo">
    <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt || photo.caption || title)}" loading="lazy">
    ${photo.caption ? `<figcaption>${escapeHtml(photo.caption)}</figcaption>` : ""}
  </figure>`;
  const content = paragraphs.map((paragraph, index) => {
    const renderedParagraph = `<p>${renderArticleText(paragraph)}</p>`;
    const afterEveryTwoParagraphs = (index + 1) % 2 === 0;
    return renderedParagraph + (afterEveryTwoParagraphs && inlinePhotos[photoIndex] ? renderPhoto(inlinePhotos[photoIndex++]) : "");
  });
  while (photoIndex < inlinePhotos.length) content.push(renderPhoto(inlinePhotos[photoIndex++]));
  return content.join("");
};

const renderArticle = (article) => {
  if (!article) {
    renderHome();
    return;
  }
  if (resultsCleanup) {
    resultsCleanup();
    resultsCleanup = undefined;
  }
  document.querySelector("main.container")?.classList.remove("has-results-view");
  document.getElementById("listViewContainer").style.display = "none";
  document.getElementById("resultsView").hidden = true;
  const view = document.getElementById("articleView");
  view.style.display = "block";
  document.getElementById("artBreadcrumbCat").textContent = article.category || "Sport";
  document.getElementById("artTitle").textContent = article.title;
  document.getElementById("artAuthor").textContent = article.author;
  document.getElementById("artDate").textContent = `Publié le ${article.date}`;
  const image = view.querySelector(".article-main-img");
  const imageWrap = image.closest(".article-main-img-wrap");
  const photos = articlePhotoItems(article.photos);
  const primaryImage = article.image || photos[0]?.url || "";
  imageWrap.style.display = primaryImage ? "" : "none";
  if (primaryImage) {
    image.src = primaryImage;
    image.alt = article.title;
  }
  document.getElementById("artLead").textContent = article.excerpt;
  document.getElementById("artBody").innerHTML = renderInlineArticleBody(article.body, photos, article.title, primaryImage);
  window.scrollTo({ top: 0, behavior: "smooth" });
};

const renderHome = (query = "") => {
  const list = document.getElementById("listViewContainer");
  const view = document.getElementById("articleView");
  if (!list || !view) return;
  if (resultsCleanup) {
    resultsCleanup();
    resultsCleanup = undefined;
  }
  document.querySelector("main.container")?.classList.remove("has-results-view");
  list.style.display = "block";
  document.getElementById("resultsView").hidden = true;
  view.style.display = "none";

  const heroContainer = document.getElementById("heroContainer");
  const articleList = document.getElementById("articleList");
  const homeSections = document.getElementById("homeCategorySections");
  const pageTitle = document.getElementById("pageSectionTitle");
  const hashCategory = window.location.hash.slice(1).toLowerCase();
  const category = sectionNewsCategories[hashCategory]
    || (categoryLabels[hashCategory] ? hashCategory : "");
  const normalizedQuery = query.trim().toLowerCase();

  // Les reportages photo (tous sports) ne s'affichent que sur l'accueil, pas dans une rubrique ni une recherche.
  const photoReportage = document.querySelector(".photo-reportage");
  if (photoReportage) photoReportage.hidden = Boolean(category || normalizedQuery);
  heroContainer.style.display = "none";
  articleList.hidden = true;
  homeSections.hidden = true;
  laUneArticles = [];

  if (!articles.length) {
    pageTitle.textContent = categoryLabels[category] || "A la une";
    articleList.innerHTML = `<p class="data-status empty-state">${supabase ? EMPTY_NEWS_MESSAGE : "Configurez la connexion Supabase pour publier et afficher les articles."}</p>`;
    articleList.hidden = false;
    return;
  }

  // Accueil : carrousel « À la une », puis directement les articles regroupés par catégorie.
  if (!category && !normalizedQuery) {
    pageTitle.textContent = "A la une";
    heroContainer.style.display = "block";
    renderLaUne(articles);
    homeSections.innerHTML = renderHomeCategorySections(articles);
    homeSections.hidden = false;
    return;
  }

  // Rubriques « Actualités » et recherche : simple liste, sans carrousel.
  const filtered = sortedArticles(articles.filter((article) => {
    const matchesCategory = !category || articleMatchesCategory(article, category);
    const matchesQuery = !normalizedQuery || `${article.title} ${article.excerpt} ${article.category}`.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  }));
  pageTitle.textContent = normalizedQuery
    ? `Résultats pour « ${query.trim()} »`
    : `Actualités · ${categoryLabels[category]}`;
  articleList.innerHTML = filtered.length
    ? filtered.map(renderArticleListItem).join("")
    : `<p class="data-status empty-state">${normalizedQuery ? `Aucun article ne correspond à « ${escapeHtml(query.trim())} ».` : EMPTY_NEWS_MESSAGE}</p>`;
  articleList.hidden = false;
};

const initializeIndex = () => {
  const search = document.getElementById("siteSearch");
  const homeLink = document.getElementById("homeLogoLink");
  refreshLiveNavigation();
  window.setInterval(() => {
    if (document.getElementById("resultsView").hidden) refreshLiveNavigation();
  }, 60000);
  const showRoute = () => {
    const route = normalizeRoute(window.location.hash.slice(1));
    // Anciennes pages dédiées : le Live Center ne garde que le filtre des matchs.
    if (["calendrier", "classements", "buteurs"].includes(route)) {
      window.location.replace(`${window.location.pathname}${window.location.search}#resultats`);
      return;
    }
    const footballRoute = /^football\/([^/]+)(?:\/([^/]+))?$/.exec(route);
    const competitionPage = footballEventRoutes[route]
      || (footballRoute ? footballCompetitionRoutes[footballRoute[1]] : null)
      || disciplineEventRoutes[route];
    renderSectionNavigation(route);
    const isResultsRoute = route === "resultats" || Boolean(competitionPage);
    if (window.location.pathname === "/resultats" || isResultsRoute) {
      if (resultsCleanup) resultsCleanup();
      document.querySelector("main.container").classList.add("has-results-view");
      document.getElementById("listViewContainer").style.display = "block";
      document.getElementById("articleView").style.display = "none";
      document.getElementById("resultsView").hidden = false;
      resultsCleanup = mountResults(document.getElementById("resultsView"), competitionPage);
      const requestedCompetitionView = competitionPage?.view === "all";
      const requestedView = requestedCompetitionView && footballRoute?.[2] === "buteurs" || route === "buteurs"
        ? "scorers"
        : requestedCompetitionView && footballRoute?.[2] === "classements" || route === "classements"
          ? "standings"
          : "matches";
      if (requestedView === "standings") document.getElementById("standingsTab").click();
      if (requestedView === "scorers") document.getElementById("topScorersView").click();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    else if (route.startsWith("read/")) renderArticle(getArticle(route.slice(5)));
    else renderHome(search.value);
  };
  search.addEventListener("input", () => {
    const route = normalizeRoute(window.location.hash.slice(1));
    const isFootballResultsPage = route.startsWith("football/") && Boolean(footballCompetitionRoutes[route.split("/")[1]]);
    if (window.location.pathname !== "/resultats" && route !== "resultats" && !isFootballResultsPage && !footballEventRoutes[route] && !disciplineEventRoutes[route]) {
      renderHome(search.value);
    }
  });
  homeLink.addEventListener("click", (event) => {
    event.preventDefault();
    search.value = "";
    if (window.location.pathname === "/resultats") {
      window.location.href = "/";
      return;
    }
    window.location.hash = "";
    renderHome();
  });
  document.querySelectorAll(".nav-left a[href^='#'], .footer-column a[href^='#']").forEach((link) => link.addEventListener("click", (event) => {
    search.value = "";
    if (window.location.pathname === "/resultats") {
      event.preventDefault();
      window.location.href = `/${link.getAttribute("href")}`;
    }
  }));
  document.getElementById("sectionNav")?.addEventListener("click", (event) => {
    const link = event.target.closest("a[href^='#']");
    if (!link) return;
    search.value = "";
    if (window.location.pathname === "/resultats") {
      event.preventDefault();
      window.location.href = `/${link.getAttribute("href")}`;
    }
  });
  document.getElementById("carouselPrevious").addEventListener("click", (event) => { event.preventDefault(); moveLaUne(-1); });
  document.getElementById("carouselNext").addEventListener("click", (event) => { event.preventDefault(); moveLaUne(1); });
  const carousel = document.getElementById("heroCarousel");
  if (carousel) {
    carousel.addEventListener("mouseenter", () => { laUnePaused = true; });
    carousel.addEventListener("mouseleave", () => { laUnePaused = false; });
    carousel.addEventListener("focusin", () => { laUnePaused = true; });
    carousel.addEventListener("focusout", () => { laUnePaused = false; });
    let swipeStartX = null;
    carousel.addEventListener("touchstart", (event) => { swipeStartX = event.touches[0].clientX; }, { passive: true });
    carousel.addEventListener("touchend", (event) => {
      if (swipeStartX === null) return;
      const deltaX = event.changedTouches[0].clientX - swipeStartX;
      swipeStartX = null;
      if (Math.abs(deltaX) > 50) moveLaUne(deltaX < 0 ? 1 : -1);
    }, { passive: true });
  }
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    laUneTimer = window.setInterval(() => { if (!laUnePaused) moveLaUne(1); }, 5000);
  }
  window.addEventListener("hashchange", showRoute);
  window.addEventListener("popstate", showRoute);
  showRoute();
};

const initializeArticlePage = () => {
  const article = articles[0];
  const articleSection = article
    ? ["football", "basket-ball", "judo", "omnisports"].find((section) => articleMatchesCategory(article, section)) || "football"
    : "football";
  renderSectionNavigation(`${articleSection}/actualites`);
  const title = document.querySelector(".article-main-title");
  const image = document.querySelector(".article-main-img");
  const lead = document.querySelector(".article-lead");
  const body = document.querySelector(".article-content");
  const author = document.querySelector(".author-name strong");
  const date = document.querySelector(".publish-date");
  if (!article) {
    if (title) title.textContent = "Aucun article publié";
    if (image) image.closest(".article-main-img-wrap").style.display = "none";
    if (lead) lead.textContent = "Les articles publiés depuis Supabase apparaîtront ici.";
    if (author) author.textContent = "Masano243";
    if (date) date.textContent = "";
    if (body) body.innerHTML = "";
    return;
  }
  if (title) title.textContent = article.title;
  if (image) {
    const imageWrap = image.closest(".article-main-img-wrap");
    const photos = articlePhotoItems(article.photos);
    const primaryImage = article.image || photos[0]?.url || "";
    imageWrap.style.display = primaryImage ? "" : "none";
    if (primaryImage) {
      image.src = primaryImage;
      image.alt = article.title;
    }
  }
  if (author) author.textContent = article.author;
  if (date) date.textContent = `Publié le ${article.date}`;
  if (body) {
    const photos = articlePhotoItems(article.photos);
    const primaryImage = article.image || photos[0]?.url || "";
    body.innerHTML = `<p class="article-lead">${escapeHtml(article.excerpt)}</p>${renderInlineArticleBody(article.body, photos, article.title, primaryImage)}`;
  }
  const share = document.querySelector(".share-buttons a");
  if (share) share.addEventListener("click", async (event) => {
    event.preventDefault();
    if (navigator.share) await navigator.share({ title: document.title, url: window.location.href });
    else await navigator.clipboard.writeText(window.location.href);
  });
};

loadArticles().then(() => {
  if (document.getElementById("listViewContainer")) {
    initializeIndex();
    fetchFlashArticles();
    fetchPhotoReportage();
  }
  else initializeArticlePage();
  fetchScoopLatestArticle();
});