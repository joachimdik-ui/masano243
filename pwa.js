const installButton = document.getElementById("pwaInstallButton");
const installDialog = document.getElementById("pwaInstallDialog");
const installInstructions = document.getElementById("pwaInstallInstructions");
const installConfirmButton = document.getElementById("pwaInstallConfirm");
let installPrompt;

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
