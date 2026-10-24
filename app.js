import { scoopSupabase, supabase } from "./supabaseClient.js";
import { mountResults } from "./results.js";

let articles = [];
let resultsCleanup;

const categoryLabels = {
  linafoot: "LINAFOOT",
  leopards: "LÉOPARDS",
  football: "Football",
  "basket-ball": "Basket-ball",
  boxe: "Boxe",
  "volley-ball": "Volley-ball",
  "hand-ball": "Hand-ball",
  judo: "Judo",
  omnisports: "Omnisports",
  resultats: "Résultats",
  "rendez-vous": "Rendez-vous",
  interview: "Interview",
  portrait: "Portrait"
};

const categoryAliases = {
  leopards: ["equipe-nationale"],
  "basket-ball": ["basketball"]
};

const normalizeCategory = (category) => String(category || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

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

const sortedArticles = (items) => [...items].sort((first, second) => {
  const firstDate = first.created_at || first.date || "";
  const secondDate = second.created_at || second.date || "";
  return String(secondDate).localeCompare(String(firstDate));
});

const renderLaUne = (items = articles) => {
  const hero = document.getElementById("heroClickable");
  if (!hero || !items.length) return;
  laUneArticles = sortedArticles(items).slice(0, 5);
  laUneIndex = Math.min(laUneIndex, laUneArticles.length - 1);
  const article = laUneArticles[laUneIndex];
  document.querySelector(".hero-title").textContent = article.title;
  document.querySelector(".hero-excerpt").textContent = article.excerpt;
  document.querySelector(".hero-meta").textContent = `Par ${article.author} • ${article.date}`;
  const image = document.querySelector(".hero-img");
  image.src = article.image;
  image.alt = article.title;
  hero.href = `#read/${article.id}`;
  document.getElementById("carouselPosition").textContent = `${laUneIndex + 1} / ${laUneArticles.length}`;
};

const moveLaUne = (step) => {
  if (!laUneArticles.length) return;
  laUneIndex = (laUneIndex + step + laUneArticles.length) % laUneArticles.length;
  renderLaUne(laUneArticles);
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
  if (!articles.length) {
    document.getElementById("pageSectionTitle").textContent = "Aucun article publié";
    document.getElementById("heroContainer").style.display = "none";
    document.getElementById("postsGrid").innerHTML = `<p class="data-status">${supabase ? "Aucun article publié dans Supabase pour le moment." : "Configurez la connexion Supabase pour publier et afficher les articles."}</p>`;
    laUneArticles = [];
    return;
  }
  const hashCategory = window.location.hash.slice(1).toLowerCase();
  const category = categoryLabels[hashCategory] ? hashCategory : "";
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = articles.filter((article) => {
    const matchesCategory = !category
      || [category, ...(categoryAliases[category] || [])].includes(normalizeCategory(article.category));
    const matchesQuery = !normalizedQuery || `${article.title} ${article.excerpt} ${article.category}`.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });
  const orderedFiltered = sortedArticles(filtered);
  document.getElementById("pageSectionTitle").textContent = normalizedQuery ? `Résultats pour « ${query.trim()} »` : (categoryLabels[category] || "A la une");
  const heroContainer = document.getElementById("heroContainer");
  const postsGrid = document.getElementById("postsGrid");
  if (!orderedFiltered.length) {
    laUneArticles = [];
    heroContainer.style.display = "none";
    postsGrid.innerHTML = `<p class="data-status">${category
      ? `Aucun article dans la rubrique ${escapeHtml(categoryLabels[category])}${normalizedQuery ? ` pour « ${escapeHtml(query.trim())} »` : ""}.`
      : `Aucun article ne correspond à « ${escapeHtml(query.trim())} ».`}</p>`;
    return;
  }
  heroContainer.style.display = "block";
  laUneIndex = 0;
  renderLaUne(orderedFiltered);
  postsGrid.innerHTML = orderedFiltered.filter((article) => article.id !== laUneArticles[laUneIndex]?.id).map(renderArticleCard).join("");
};

const initializeIndex = () => {
  const search = document.getElementById("siteSearch");
  const homeLink = document.getElementById("homeLogoLink");
  const showRoute = () => {
    const route = window.location.hash.slice(1);
    if (window.location.pathname === "/resultats" || route === "resultats") {
      if (resultsCleanup) resultsCleanup();
      document.querySelector("main.container").classList.add("has-results-view");
      document.getElementById("listViewContainer").style.display = "block";
      document.getElementById("articleView").style.display = "none";
      document.getElementById("resultsView").hidden = false;
      resultsCleanup = mountResults(document.getElementById("resultsView"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    else if (route.startsWith("read/")) renderArticle(getArticle(route.slice(5)));
    else renderHome(search.value);
  };
  search.addEventListener("input", () => {
    if (window.location.pathname !== "/resultats" && window.location.hash.slice(1) !== "resultats") {
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
  document.getElementById("carouselPrevious").addEventListener("click", (event) => { event.preventDefault(); moveLaUne(-1); });
  document.getElementById("carouselNext").addEventListener("click", (event) => { event.preventDefault(); moveLaUne(1); });
  laUneTimer = window.setInterval(() => moveLaUne(1), 5000);
  window.addEventListener("hashchange", showRoute);
  window.addEventListener("popstate", showRoute);
  showRoute();
};

const initializeArticlePage = () => {
  const article = articles[0];
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
