import { mountTvHomePreview } from "./tv.js";
import { supabase } from "./supabaseClient.js";

const installButton = document.getElementById("pwaInstallButton");
const installDialog = document.getElementById("pwaInstallDialog");
const installInstructions = document.getElementById("pwaInstallInstructions");
const installConfirmButton = document.getElementById("pwaInstallConfirm");
const searchToggle = document.getElementById("pwaSearchToggle");
const searchPanel = document.getElementById("pwaSearchPanel");
const pwaSearchInput = document.getElementById("pwaSearchInput");
const siteSearch = document.getElementById("siteSearch");
const menuDialog = document.getElementById("pwaMenuDialog");
const accountButton = document.getElementById("pwaAccountButton");
const accountDialog = document.getElementById("pwaAccountDialog");
const accountForm = document.getElementById("pwaAccountForm");
const accountEmail = document.getElementById("pwaAccountEmail");
const accountPassword = document.getElementById("pwaAccountPassword");
const accountGuest = document.getElementById("pwaAccountGuest");
const accountSignedIn = document.getElementById("pwaAccountSignedIn");
const accountIdentity = document.getElementById("pwaAccountIdentity");
const accountMessage = document.getElementById("pwaAccountMessage");
const accountSubmit = accountForm.querySelector('[type="submit"]');
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
if (isStandalone && window.location.pathname === "/resultats" && !window.location.hash) {
  window.location.hash = "football/l1";
}
if (isStandalone) homeTvCleanup = mountTvHomePreview(document.getElementById("pwaHomeTv"));

const updateNavigation = () => {
  const hash = window.location.hash.slice(1).toLowerCase();
  const isResultsRoute = (window.location.pathname === "/resultats" && !hash) || hash === "resultats"
    || /^football\/(l1|l2|epf-kin|leopards|interclubs|international)(\/|$)/.test(hash)
    || /^(basket-ball|judo|omnisports)\/evenements$/.test(hash);
  const route = isResultsRoute
    ? "results"
    : hash === "tv"
      ? "tv"
      : hash === "articles" || hash.startsWith("read/")
        ? "articles"
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
    const active = href === "/" ? !hash : href === "#articles" && route === "articles"
      || href.startsWith("#football") && activeSport === "football"
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

const setAccountMessage = (message = "", isError = false) => {
  accountMessage.textContent = message;
  accountMessage.classList.toggle("is-error", isError);
};

const updateAccount = (session) => {
  const user = session?.user;
  accountGuest.hidden = Boolean(user);
  accountSignedIn.hidden = !user;
  accountIdentity.textContent = user?.email || user?.user_metadata?.nom || "";
  accountButton.setAttribute("aria-label", user ? "Ouvrir mon compte" : "Se connecter");
  accountButton.title = user ? "Mon compte" : "Se connecter";
  document.getElementById("pwaAccountTitle").textContent = user ? "Mon compte" : "Connexion";
};

updateAccount(null);
if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => updateAccount(session));
  void supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      console.error("Impossible de vérifier la session du compte Masano243.", error);
      setAccountMessage("La vérification de votre session est indisponible.", true);
      return;
    }
    updateAccount(data.session);
  }).catch((error) => {
    console.error("Impossible de vérifier la session du compte Masano243.", error);
    setAccountMessage("La vérification de votre session est indisponible.", true);
  });
}

accountButton.addEventListener("click", () => {
  setAccountMessage();
  accountDialog.showModal();
});
document.getElementById("pwaAccountClose").addEventListener("click", () => accountDialog.close());
accountDialog.addEventListener("click", (event) => {
  if (event.target === accountDialog) accountDialog.close();
});
accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) {
    setAccountMessage("La connexion au compte n’est pas disponible pour le moment.", true);
    return;
  }
  accountSubmit.disabled = true;
  setAccountMessage();
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: accountEmail.value.trim(),
      password: accountPassword.value
    });
    if (error) {
      setAccountMessage(error.message, true);
      return;
    }
    accountPassword.value = "";
    updateAccount(data.session);
    setAccountMessage("Vous êtes connecté.");
  } catch (error) {
    console.error("Impossible de connecter le compte Masano243.", error);
    setAccountMessage("La connexion est momentanément indisponible. Réessayez.", true);
  } finally {
    accountSubmit.disabled = false;
  }
});
document.getElementById("pwaAccountSignOut").addEventListener("click", async () => {
  if (!supabase) {
    setAccountMessage("La déconnexion n’est pas disponible pour le moment.", true);
    return;
  }
  const signOutButton = document.getElementById("pwaAccountSignOut");
  signOutButton.disabled = true;
  setAccountMessage();
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAccountMessage(error.message, true);
      return;
    }
    updateAccount(null);
    setAccountMessage("Vous êtes déconnecté.");
  } catch (error) {
    console.error("Impossible de déconnecter le compte Masano243.", error);
    setAccountMessage("La déconnexion est momentanément indisponible. Réessayez.", true);
  } finally {
    signOutButton.disabled = false;
  }
});

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
