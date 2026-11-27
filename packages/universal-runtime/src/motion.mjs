// Visible QA decoration only; action authorization stays in the session facade.
import { randomUUID } from "node:crypto";

function installCursor(id) {
  if (!document.documentElement || document.getElementById(id)) return;
  const host = document.createElement("div");
  host.id = id;
  host.setAttribute("data-browser-driver-cursor", "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:fixed;inset:0;width:0;height:0;pointer-events:none;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    .pointer{position:fixed;width:25px;height:31px;filter:drop-shadow(1px 2px 2px #0006);transform:translate(30px,30px)}
    .ring{position:fixed;width:36px;height:36px;border:3px solid #287bdf;border-radius:50%;opacity:0;transform:translate(-50%,-50%)}
    .pulse{animation:driver-click .65s ease-out}
    @keyframes driver-click{from{opacity:1;scale:.5}to{opacity:0;scale:1.7}}
    </style><div class="ring"></div><svg class="pointer" viewBox="0 0 25 31"><path d="M2 2 L2 25 L8 19 L13 29 L18 26 L13 17 L23 17 Z" fill="white" stroke="#182b3d" stroke-width="2"/></svg>`;
  const pointer = shadow.querySelector(".pointer");
  const ring = shadow.querySelector(".ring");
  const move = (event) => {
    pointer.style.transform = `translate(${event.clientX}px,${event.clientY}px)`;
  };
  const click = (event) => {
    ring.style.left = `${event.clientX}px`;
    ring.style.top = `${event.clientY}px`;
    ring.classList.remove("pulse");
    void ring.offsetWidth;
    ring.classList.add("pulse");
  };
  document.addEventListener("mousemove", move, true);
  document.addEventListener("pointerdown", click, true);
  host.removeDriverCursor = () => {
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("pointerdown", click, true);
    host.remove();
  };
  document.documentElement.append(host);
}

export function createVisibleCursor(page) {
  const id = `browser-driver-cursor-${randomUUID()}`;
  const pending = new Set();
  let closed = false;
  let active = false;
  async function ensure() {
    // Test doubles and non-browser effect adapters need no pointer decoration.
    if (closed || typeof page.evaluate !== "function") return;
    active = true;
    const operation = page.evaluate(installCursor, id);
    pending.add(operation);
    try {
      await operation;
    } finally {
      pending.delete(operation);
    }
  }
  const loaded = () => {
    if (active) void ensure().catch(() => {});
  };
  page.on?.("domcontentloaded", loaded);
  return {
    ensure,
    async close() {
      closed = true;
      page.off?.("domcontentloaded", loaded);
      await Promise.allSettled([...pending]);
      if (active && !page.isClosed?.())
        await page.evaluate((cursorId) => {
          document.getElementById(cursorId)?.removeDriverCursor?.();
        }, id);
    },
  };
}

export async function supportsVisibleTyping(locator) {
  if (typeof locator.evaluate !== "function") return false;
  return locator.evaluate(
    (element) =>
      element.tagName === "TEXTAREA" ||
      element.isContentEditable ||
      (element.tagName === "INPUT" &&
        ["text", "search", "email", "url", "tel", "password"].includes(
          element.type,
        )),
  );
}
