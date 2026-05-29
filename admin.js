const ADMIN_PASSWORD = "zla-admin";
const loginSection = document.querySelector("[data-admin-login]");
const dashboard = document.querySelector("[data-admin-dashboard]");
const loginForm = document.querySelector(".admin-login-form");
const logoutButton = document.querySelector("[data-admin-logout]");
const eventForm = document.querySelector("[data-event-form]");
const resourceForm = document.querySelector("[data-resource-form]");
const socialForm = document.querySelector("[data-social-form]");
const eventList = document.querySelector("[data-admin-events]");
const resourceList = document.querySelector("[data-admin-resources]");
const resetButton = document.querySelector("[data-admin-reset]");
const adminStatus = document.querySelector("[data-admin-status]");

function loadArray(key, fallback) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function loadObject(key, fallback) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function saveArray(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function setStatus(message) {
  if (adminStatus) adminStatus.textContent = message;
}

function setLoggedIn(isLoggedIn) {
  sessionStorage.setItem("zlaAdminLoggedIn", isLoggedIn ? "true" : "false");
  loginSection.hidden = isLoggedIn;
  dashboard.hidden = !isLoggedIn;
  if (isLoggedIn) {
    renderAdmin();
    setStatus("Admin unlocked. Add events, resources, or social links below.");
  }
}

function formValue(form, name) {
  return form.elements[name].value.trim();
}

function adminRow(item, onDelete) {
  const row = document.createElement("div");
  row.className = "admin-row";

  const text = document.createElement("div");
  const title = document.createElement("strong");
  const detail = document.createElement("span");
  title.textContent = item.title;
  detail.textContent = [item.date, item.time, item.location, item.category].filter(Boolean).join(" | ");
  text.append(title, detail);

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Delete";
  button.addEventListener("click", onDelete);

  row.append(text, button);
  return row;
}

function renderAdmin() {
  const events = loadArray("zlaEvents", window.zlaEvents || []);
  const resources = loadArray("zlaTrainingResources", window.zlaTrainingResources || []);
  const social = loadObject("zlaSocialLinks", window.zlaSocialLinks || {});

  eventList.replaceChildren(
    ...events.map((event, index) =>
      adminRow(event, () => {
        const next = loadArray("zlaEvents", window.zlaEvents || []);
        next.splice(index, 1);
        saveArray("zlaEvents", next);
        renderAdmin();
      })
    )
  );

  resourceList.replaceChildren(
    ...resources.map((resource, index) =>
      adminRow(resource, () => {
        const next = loadArray("zlaTrainingResources", window.zlaTrainingResources || []);
        next.splice(index, 1);
        saveArray("zlaTrainingResources", next);
        renderAdmin();
      })
    )
  );

  socialForm.elements.facebook.value = social.facebook || "";
  socialForm.elements.instagram.value = social.instagram || "";
}

function saveDefaultsIfNeeded() {
  if (!localStorage.getItem("zlaEvents")) {
    saveArray("zlaEvents", window.zlaEvents || []);
  }
  if (!localStorage.getItem("zlaTrainingResources")) {
    saveArray("zlaTrainingResources", window.zlaTrainingResources || []);
  }
  if (!localStorage.getItem("zlaSocialLinks")) {
    localStorage.setItem("zlaSocialLinks", JSON.stringify(window.zlaSocialLinks || {}));
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const note = loginForm.querySelector(".form-note");
  if (formValue(loginForm, "password") === ADMIN_PASSWORD) {
    note.textContent = "";
    setLoggedIn(true);
    loginForm.reset();
  } else {
    note.textContent = "Password did not match.";
  }
});

logoutButton.addEventListener("click", () => setLoggedIn(false));

resetButton.addEventListener("click", () => {
  localStorage.removeItem("zlaEvents");
  localStorage.removeItem("zlaTrainingResources");
  localStorage.removeItem("zlaSocialLinks");
  saveDefaultsIfNeeded();
  renderAdmin();
  setStatus("Content reset to the site defaults.");
});

eventForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveDefaultsIfNeeded();
  const events = loadArray("zlaEvents", window.zlaEvents || []);
  events.push({
    title: formValue(eventForm, "title"),
    date: formValue(eventForm, "date"),
    time: formValue(eventForm, "time"),
    location: formValue(eventForm, "location"),
    details: formValue(eventForm, "details"),
    href: formValue(eventForm, "href") || "#contact",
  });
  saveArray("zlaEvents", events);
  eventForm.reset();
  renderAdmin();
  eventForm.querySelector(".form-note").textContent = "Event saved. It will appear if it is one of the next four upcoming events.";
  setStatus("Event saved. Refresh the public site to see the updated schedule.");
});

resourceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveDefaultsIfNeeded();
  const resources = loadArray("zlaTrainingResources", window.zlaTrainingResources || []);
  resources.push({
    category: formValue(resourceForm, "category") || "Resource",
    title: formValue(resourceForm, "title"),
    description: formValue(resourceForm, "description"),
    href: formValue(resourceForm, "href") || "training.html",
  });
  saveArray("zlaTrainingResources", resources);
  resourceForm.reset();
  renderAdmin();
  resourceForm.querySelector(".form-note").textContent = "Resource saved.";
  setStatus("Training resource saved. Refresh the public site to see the update.");
});

socialForm.addEventListener("submit", (event) => {
  event.preventDefault();
  localStorage.setItem(
    "zlaSocialLinks",
    JSON.stringify({
      facebook: formValue(socialForm, "facebook"),
      instagram: formValue(socialForm, "instagram"),
    })
  );
  socialForm.querySelector(".form-note").textContent = "Social links saved.";
  setStatus("Social links saved. Refresh the public site to activate the footer links.");
});

const queryPassword = new URLSearchParams(window.location.search).get("password");
if (queryPassword === ADMIN_PASSWORD) {
  saveDefaultsIfNeeded();
  setLoggedIn(true);
  window.history.replaceState({}, "", "admin.html");
} else {
  setLoggedIn(sessionStorage.getItem("zlaAdminLoggedIn") === "true");
}
