(() => {
const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");
const navLinks = [...document.querySelectorAll(".site-nav a")];
const sections = navLinks
  .map((link) => link.getAttribute("href"))
  .filter((href) => href?.startsWith("#"))
  .map((href) => document.querySelector(href))
  .filter(Boolean);

navToggle?.addEventListener("click", () => {
  const isOpen = siteNav.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    siteNav.classList.remove("open");
    navToggle?.setAttribute("aria-expanded", "false");
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => {
        link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
      });
    });
  },
  { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
);

sections.forEach((section) => observer.observe(section));

const eventList = document.querySelector("#event-list");
const nextEventSnapshot = document.querySelector("#next-event-snapshot");
const nextEventDay = document.querySelector("[data-next-event-day]");
const nextEventTitle = document.querySelector("[data-next-event-title]");
const nextEventDetail = document.querySelector("[data-next-event-detail]");
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function storedList(key, fallback) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function storedObject(key, fallback) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function eventStart(event) {
  const [hour = "00", minute = "00"] = event.time?.match(/\d{2}/g) || [];
  return new Date(`${event.date}T${hour}:${minute}:00`);
}

function upcomingEvents(events) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return events
    .filter((event) => event.date && eventStart(event) >= today)
    .sort((a, b) => eventStart(a) - eventStart(b));
}

function renderEvents() {
  const events = storedList("zlaEvents", window.zlaEvents || []);
  if (!eventList || !Array.isArray(events)) return;

  const nextEvents = upcomingEvents(events);
  const visibleEvents = nextEvents.slice(0, 4);
  const oldRows = eventList.querySelectorAll(".table-row, .empty-row");
  oldRows.forEach((row) => row.remove());

  if (!visibleEvents.length) {
    const empty = document.createElement("p");
    empty.className = "empty-row";
    empty.textContent = "No upcoming events are currently listed. Add new dates in events.js.";
    eventList.append(empty);
  } else {
    visibleEvents.forEach((event) => {
      const row = document.createElement("a");
      row.className = "table-row";
      row.href = event.href || "#contact";
      const date = document.createElement("span");
      const time = document.createElement("span");
      const title = document.createElement("strong");
      const location = document.createElement("span");
      date.textContent = dateFormatter.format(eventStart(event));
      time.textContent = event.time || "TBD";
      title.textContent = event.title;
      location.textContent = event.location || "TBD";
      row.append(date, time, title, location);
      eventList.append(row);
    });
  }

  const nextEvent = nextEvents[0];
  if (nextEvent && nextEventSnapshot && nextEventDay && nextEventTitle && nextEventDetail) {
    const start = eventStart(nextEvent);
    nextEventSnapshot.href = nextEvent.href || "#events";
    nextEventDay.textContent = String(start.getDate()).padStart(2, "0");
    nextEventTitle.textContent = nextEvent.title;
    nextEventDetail.textContent = `${fullDateFormatter.format(start)} | ${nextEvent.time || "TBD"} | ${
      nextEvent.location || "TBD"
    }`;
  }
}

function resourceCard(resource) {
  const article = document.createElement("article");
  article.className = "doc-card";

  const category = document.createElement("span");
  const title = document.createElement("h3");
  const description = document.createElement("p");
  const link = document.createElement("a");

  category.textContent = resource.category || "Resource";
  title.textContent = resource.title;
  description.textContent = resource.description || "";
  link.href = resource.href || "training.html";
  link.textContent = "Open resource";

  article.append(category, title, description, link);
  return article;
}

function resourceRow(resource) {
  const link = document.createElement("a");
  const title = document.createElement("strong");
  const description = document.createElement("span");

  link.href = resource.href || "training.html";
  title.textContent = resource.title;
  description.textContent = resource.description || "";

  link.append(title, description);
  return link;
}

function renderResources() {
  const resources = storedList("zlaTrainingResources", window.zlaTrainingResources || []);
  const homeList = document.querySelector("#home-resource-list");
  const trainingGrid = document.querySelector("#training-resource-grid");

  if (homeList) {
    homeList.replaceChildren(...resources.slice(0, 3).map(resourceRow));
  }

  if (trainingGrid) {
    trainingGrid.replaceChildren(...resources.map(resourceCard));
  }
}

function renderSocialLinks() {
  const links = storedObject("zlaSocialLinks", window.zlaSocialLinks || {});
  document.querySelectorAll("[data-social-link]").forEach((link) => {
    const key = link.dataset.socialLink;
    const value = links[key];
    if (value) {
      link.href = value;
      link.target = "_blank";
      link.rel = "noopener";
    }
  });
}

renderEvents();
renderResources();
renderSocialLinks();

document.querySelector(".contact-section .contact-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const note = event.currentTarget.querySelector(".form-note");
  note.textContent = "Message prepared. Connect this form to your union email service when ready.";
});
})();
