import { mountTvHomePreview } from "./tv.js";

const installButton = document.getElementById("pwaInstallButton");
const installDialog = document.getElementById("pwaInstallDialog");
const installInstructions = document.getElementById("pwaInstallInstructions");
const installConfirmButton = document.getElementById("pwaInstallConfirm");
const searchToggle = document.getElementById("pwaSearchToggle");
const searchPanel = document.getElementById("pwaSearchPanel");
const pwaSearchInput = document.getElementById("pwaSearchInput");
const siteSearch = document.getElementById("siteSearch");
const menuDialog = document.getElementById("pwaMenuDialog");
let installPrompt;
let homeTvCleanup;

const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches
  || window.navigator.standalone === true;

const updateInstallButton = () => {
  installButton.hidden = isInstalled();
};

const getInstallInstructions = () => {
  const userAgent = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(userAgent)) {
    return "Ouvrez le menu Partager de votre navigateur, puis choisissez « Sur l’écran d’accueil » pour ajouter Masano243.";
  }
  if (/android/i.test(userAgent)) {
    return "Ouvrez le menu de votre navigateur, puis choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».";
  }
  return "Utilisez l’option « Installer Masano243 » dans le menu de votre navigateur ou l’icône d’installation dans la barre d’adresse.";
};

const showInstallHelp = () => {
  installInstructions.textContent = getInstallInstructions();
  installConfirmButton.hidden = true;
  if (!installDialog.open) installDialog.showModal();
};

const promptInstall = async () => {
  if (!installPrompt) return false;

  try {
    const prompt = installPrompt;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") installButton.hidden = true;
    installPrompt = undefined;
    return outcome === "accepted";
  } catch (error) {
    installPrompt = undefined;
    console.error("Impossible de lancer l’installation de Masano243.", error);
    showInstallHelp();
    return false;
  }
};

updateInstallButton();

const isStandalone = isInstalled();
document.body.classList.toggle("pwa-standalone", isStandalone);
if (isStandalone) homeTvCleanup = mountTvHomePreview(document.getElementById("pwaHomeTv"));

const updateNavigation = () => {
  const hash = window.location.hash.slice(1).toLowerCase();
  const route = window.location.pathname === "/resultats" || hash === "resultats"
    || /^football\/(l1|l2|epf-kin|leopards|interclubs|international)(\/|$)/.test(hash)
    ? "results"
    : hash === "tv"
      ? "tv"
      : "home";
  document.querySelectorAll("[data-pwa-route]").forEach((link) => {
    const active = link.dataset.pwaRoute === route;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.body.classList.toggle("pwa-tv-route", route === "tv");
  document.body.classList.toggle("pwa-results-route", route === "results");
  document.body.classList.toggle("pwa-home-route", route === "home");
  const activeSport = hash.startsWith("football/")
    ? "football"
    : hash.startsWith("basket-ball/")
      ? "basket-ball"
      : hash.startsWith("judo/")
        ? "judo"
        : hash.startsWith("omnisports/")
          ? "omnisports"
          : "";
  document.querySelectorAll(".pwa-sport-nav a").forEach((link) => {
    const href = link.getAttribute("href");
    const active = href === "/" ? !hash : href.startsWith("#football") && activeSport === "football"
      || href.startsWith("#basket-ball") && activeSport === "basket-ball"
      || href.startsWith("#judo") && activeSport === "judo"
      || href.startsWith("#omnisports") && activeSport === "omnisports";
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.getElementById("pwaNavLiveDot").hidden = !(
    document.querySelector(".nav-live.is-live") || window.masanoTvLive
  );
};

const closeMenu = () => {
  if (menuDialog?.open) menuDialog.close();
};

searchToggle.addEventListener("click", () => {
  const opening = searchPanel.hidden;
  searchPanel.hidden = !opening;
  searchToggle.setAttribute("aria-expanded", String(opening));
  document.body.classList.toggle("pwa-search-open", opening);
  if (opening) pwaSearchInput.focus();
  else pwaSearchInput.value = "";
});

pwaSearchInput.addEventListener("input", () => {
  siteSearch.value = pwaSearchInput.value;
  siteSearch.dispatchEvent(new Event("input", { bubbles: true }));
});

searchPanel.addEventListener("submit", (event) => {
  event.preventDefault();
  searchPanel.hidden = true;
  searchToggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("pwa-search-open");
  pwaSearchInput.blur();
});

document.getElementById("pwaMenuButton").addEventListener("click", () => menuDialog.showModal());
document.getElementById("pwaMenuClose").addEventListener("click", closeMenu);
menuDialog.addEventListener("click", (event) => {
  if (event.target === menuDialog) closeMenu();
  if (event.target.closest("a")) closeMenu();
});

const matchDetailPage = document.getElementById("matchDetailPage");
matchDetailPage.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-pwa-match-tab]");
  if (!tab) return;
  document.querySelectorAll("[data-pwa-match-tab]").forEach((item) => item.classList.toggle("is-active", item === tab));
  if (tab.dataset.pwaMatchTab === "chronology") {
    document.getElementById("matchDetailOverviewTitle").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  matchDetailPage.querySelector(`[data-match-tab="${tab.dataset.pwaMatchTab}"]`)?.click();
});

new MutationObserver(() => {
  if (!matchDetailPage.hidden && isInstalled()) {
    document.querySelectorAll("[data-pwa-match-tab]").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.pwaMatchTab === "chronology"));
  }
}).observe(matchDetailPage, { attributes: true, attributeFilter: ["hidden"] });

document.querySelectorAll(".pwa-sport-nav a, .pwa-bottom-nav a, .pwa-menu-dialog a").forEach((link) => {
  link.addEventListener("click", () => {
    if (link.getAttribute("href") !== "/resultats") {
      siteSearch.value = "";
      pwaSearchInput.value = "";
    }
    closeMenu();
  });
});

window.addEventListener("hashchange", updateNavigation);
window.addEventListener("popstate", updateNavigation);
window.addEventListener("masano-tv-live-update", (event) => {
  window.masanoTvLive = Boolean(event.detail?.live);
  updateNavigation();
});
updateNavigation();

if (isStandalone) {
  const liveLink = document.querySelector(".nav-live");
  if (liveLink) {
    new MutationObserver(updateNavigation).observe(liveLink, { attributes: true, attributeFilter: ["class"] });
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installConfirmButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (installPrompt) {
    await promptInstall();
    return;
  }

  showInstallHelp();
});

installConfirmButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  const installed = await promptInstall();
  if (installed && installDialog.open) installDialog.close();
});

window.addEventListener("appinstalled", () => {
  installPrompt = undefined;
  installButton.hidden = true;
  if (installDialog.open) installDialog.close();
  document.body.classList.add("pwa-standalone");
  if (!homeTvCleanup) homeTvCleanup = mountTvHomePreview(document.getElementById("pwaHomeTv"));
});

if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloadingForUpdate = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch((error) => console.error("Impossible d’enregistrer la PWA Masano243.", error));
  }, { once: true });
}
