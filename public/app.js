(() => {
  "use strict";

  const config = window.SITE_CONFIG || {};
  const httpsUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  };

  const checkoutUrl = httpsUrl(config.checkoutUrl);
  const pixelId = /^[a-f\d]{24}$/i.test(config.utmifyPixelId || "")
    ? config.utmifyPixelId
    : null;

  // The supplied UTMify integration owns pixel initialization and tracking.
  if (pixelId) {
    window.pixelId = pixelId;
    const pixelScript = document.createElement("script");
    pixelScript.async = true;
    pixelScript.defer = true;
    pixelScript.src = "https://cdn.utmify.com.br/scripts/pixel/pixel.js";
    document.head.append(pixelScript);
  }

  const notice = document.querySelector("#checkout-notice");
  document.querySelectorAll("[data-checkout]").forEach((button) => {
    if (checkoutUrl) button.href = checkoutUrl;
    button.addEventListener("click", (event) => {
      if (!checkoutUrl) {
        event.preventDefault();
        notice.showModal();
        return;
      }
    });
  });

  document
    .querySelectorAll(".notice-close, .notice-dismiss")
    .forEach((button) => {
      button.addEventListener("click", () => notice.close());
    });

  const gallery = [
    {
      src: "/assets/ebook-guia.webp",
      alt: "Mockup do ebook com a página Assista em quatro passagens no tablet e expressões no celular",
    },
    {
      src: "/assets/ebook-pratica.webp",
      alt: "Mockup do ebook com páginas abertas, exemplos de expressões e prática de escuta com séries e filmes",
    },
    {
      src: "/assets/ebook-dispositivos.webp",
      alt: "Mockup do ebook com páginas do método de estudo e expressões exibidas em tablet e celular",
    },
  ];
  const galleryDialog = document.querySelector("#gallery-dialog");
  const galleryImage = document.querySelector("#gallery-image");
  const galleryCount = document.querySelector("#gallery-count");
  const galleryWrap = document.querySelector(".gallery-image-wrap");
  const zoomButton = document.querySelector(".gallery-zoom");
  let activeImage = 0;

  const setZoom = (zoomed) => {
    galleryWrap.classList.toggle("is-zoomed", zoomed);
    zoomButton.setAttribute("aria-pressed", String(zoomed));
    zoomButton.textContent = zoomed ? "Reduzir −" : "Ampliar +";
  };
  zoomButton.addEventListener("click", () =>
    setZoom(zoomButton.getAttribute("aria-pressed") !== "true"),
  );

  const showImage = (index) => {
    activeImage = (index + gallery.length) % gallery.length;
    galleryImage.src = gallery[activeImage].src;
    galleryImage.alt = gallery[activeImage].alt;
    galleryCount.textContent = `${activeImage + 1} / ${gallery.length}`;
    setZoom(false);
  };
  document.querySelectorAll("[data-gallery]").forEach((button) => {
    button.addEventListener("click", () => {
      showImage(Number(button.dataset.gallery));
      galleryDialog.showModal();
    });
  });
  document
    .querySelector(".gallery-close")
    .addEventListener("click", () => galleryDialog.close());
  document
    .querySelector(".gallery-prev")
    .addEventListener("click", () => showImage(activeImage - 1));
  document
    .querySelector(".gallery-next")
    .addEventListener("click", () => showImage(activeImage + 1));
  galleryDialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      showImage(activeImage + (event.key === "ArrowLeft" ? -1 : 1));
    }
  });
  [galleryDialog, notice].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    });
  });
})();
