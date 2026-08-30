(() => {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const tag = (params.get("component") || "").trim().toLocaleLowerCase("en");
  const variant = (params.get("variant") || "").trim();
  const root = document.querySelector("#preview-root");
  const status = document.querySelector("[data-preview-status]");
  const validTag = /^weotzi-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag);
  const validVariant = !variant || /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(variant);

  if (!validTag || !validVariant) {
    const error = document.createElement("div");
    error.className = "preview-error";
    const title = document.createElement("strong");
    title.textContent = "Preview no disponible";
    const detail = document.createElement("code");
    detail.textContent = validTag ? "La variante no es válida." : "Usá ?component=weotzi-nombre";
    error.append(title, detail);
    root.append(error);
    document.title = "Preview no disponible · We Ötzi";
    return;
  }

  const component = document.createElement(tag);
  if (variant) component.setAttribute("variant", variant);
  component.setAttribute("data-catalog-preview", "");
  root.append(component);
  document.title = `${tag}${variant ? ` · ${variant}` : ""} · We Ötzi`;

  if (customElements.get(tag)) return;

  const warningTimer = window.setTimeout(() => {
    status.hidden = false;
    status.textContent = `El tag <${tag}> está montado, pero todavía no fue registrado por la biblioteca compartida.`;
  }, 1200);

  customElements.whenDefined(tag).then(() => {
    window.clearTimeout(warningTimer);
    status.hidden = true;
    status.textContent = "";
  });
})();
