export const POLL_ID = "anvil-next-language-v1";
export const POLL_OPTIONS = Object.freeze([
  "fr", "pt-br", "it", "zh-cn", "ja", "ko", "other",
]);

const ENDPOINT = "/api/polls/next-language";
const REQUEST_TIMEOUT_MS = 12_000;
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_LIFETIME_MS = 290_000;
const scriptLoads = new WeakMap();

export class PollRequestError extends Error {
  constructor(code, payload, { status = 0, retryAfterMs = 0 } = {}) {
    super(code);
    this.name = "PollRequestError";
    this.code = code;
    this.payload = payload;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function turnstileLanguage(locale) {
  const language = String(locale).toLowerCase();
  return ["en", "ru", "es", "de", "fr", "it", "pt-br", "zh-cn", "ja", "ko", "tr"].includes(language)
    ? language : "auto";
}

function turnstileConfig(value) {
  if (!value || value.action !== "language-poll" || typeof value.siteKey !== "string" ||
      !/^[a-zA-Z0-9_-]{1,256}$/.test(value.siteKey)) return null;
  return { siteKey: value.siteKey, action: "language-poll" };
}

// Load only the official script, once per document. Failed loads can be retried.
export function loadTurnstileScript(doc = document) {
  const view = doc.defaultView;
  if (scriptLoads.has(doc)) return scriptLoads.get(doc);
  const promise = new Promise((resolve, reject) => {
    let script = null;
    let finished = false;
    const timer = setTimeout(() => finish(new Error("turnstile_script_timeout")), REQUEST_TIMEOUT_MS);
    timer?.unref?.();
    function finish(error, api) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (script) {
        script.onload = null;
        script.onerror = null;
      }
      if (error) {
        script?.remove();
        reject(error);
      } else resolve(api);
    }
    function loaded() {
      const api = view?.turnstile;
      if (typeof api?.render !== "function") return finish(new Error("turnstile_script_unavailable"));
      // The script's load event runs after execution. Explicit rendering can
      // use this API directly; calling ready() here is unnecessary and unsafe.
      finish(null, api);
    }
    if (typeof view?.turnstile?.render === "function") return loaded();
    try {
      script = doc.createElement("script");
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = loaded;
      script.onerror = () => finish(new Error("turnstile_script_unavailable"));
      doc.head.appendChild(script);
    } catch { finish(new Error("turnstile_script_unavailable")); }
  });
  scriptLoads.set(doc, promise);
  void promise.catch(() => {
    if (scriptLoads.get(doc) === promise) scriptLoads.delete(doc);
  });
  return promise;
}

// Treat missing or inconsistent API data as unavailable, never as zero votes.
export function validatePollSnapshot(value) {
  if (!value || value.pollId !== POLL_ID || !Array.isArray(value.options) ||
      value.options.length !== POLL_OPTIONS.length ||
      !Number.isSafeInteger(value.totalVotes) || value.totalVotes < 0 ||
      (value.selectedOption !== null && !POLL_OPTIONS.includes(value.selectedOption))) {
    throw new PollRequestError("unavailable");
  }

  const byId = new Map();
  let total = 0;
  for (const option of value.options) {
    if (!option || !POLL_OPTIONS.includes(option.id) || byId.has(option.id) ||
        !Number.isSafeInteger(option.votes) || option.votes < 0) {
      throw new PollRequestError("unavailable");
    }
    total += option.votes;
    if (!Number.isSafeInteger(total)) throw new PollRequestError("unavailable");
    byId.set(option.id, option.votes);
  }
  if (total !== value.totalVotes ||
      (value.selectedOption !== null && byId.get(value.selectedOption) < 1)) {
    throw new PollRequestError("unavailable");
  }

  return {
    pollId: POLL_ID,
    options: POLL_OPTIONS.map((id) => ({ id, votes: byId.get(id) })),
    totalVotes: value.totalVotes,
    selectedOption: value.selectedOption,
    alreadyVoted: value.alreadyVoted === true || value.selectedOption !== null,
    turnstile: turnstileConfig(value.turnstile),
  };
}

export async function requestPoll(method = "GET", option, fetcher = fetch, turnstileToken) {
  if (method === "POST" && (typeof turnstileToken !== "string" || !turnstileToken || turnstileToken.length > 2048)) {
    throw new PollRequestError("verification_required");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(ENDPOINT, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify({ option, turnstileToken }) } : {}),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new PollRequestError("unavailable");
    }
    if (!response.ok) {
      throw new PollRequestError(
        typeof payload?.error === "string" ? payload.error : "unavailable",
        payload,
        {
          status: response.status,
          retryAfterMs: response.status === 429
            ? Math.max(1, Math.min(3600, Number(response.headers.get("Retry-After")) || 60)) * 1000 : 0,
        },
      );
    }
    return validatePollSnapshot(payload);
  } catch (error) {
    if (error instanceof PollRequestError) throw error;
    throw new PollRequestError("unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export function formatPollText(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

export async function initLanguagePoll(root, fetcher = fetch, runtime = {}) {
  const copy = JSON.parse(root.querySelector("[data-poll-copy]").textContent);
  const form = root.querySelector("[data-poll-form]");
  const fieldset = root.querySelector("[data-poll-fieldset]");
  const submit = root.querySelector("[data-poll-submit]");
  const retry = root.querySelector("[data-poll-retry]");
  const status = root.querySelector("[data-poll-status]");
  const results = root.querySelector("[data-poll-results]");
  const total = root.querySelector("[data-poll-total]");
  const verification = root.querySelector("[data-poll-verification]");
  const verificationStatus = root.querySelector("[data-poll-verification-status]");
  const verificationRetry = root.querySelector("[data-poll-verification-retry]");
  const challenge = root.querySelector("[data-poll-challenge]");
  const radios = [...form.querySelectorAll('input[name="next-language"]')];
  const rows = [...root.querySelectorAll("[data-poll-result]")];
  const number = new Intl.NumberFormat(copy.locale);
  const percent = new Intl.NumberFormat(copy.locale, {
    style: "percent", maximumFractionDigits: 1,
  });
  const loadScript = runtime.loadTurnstile ?? (() => loadTurnstileScript(root.ownerDocument));
  const Observer = runtime.Observer === undefined
    ? (typeof IntersectionObserver === "undefined" ? null : IntersectionObserver) : runtime.Observer;
  const SizeObserver = runtime.ResizeObserver === undefined
    ? (typeof ResizeObserver === "undefined" ? null : ResizeObserver) : runtime.ResizeObserver;
  const now = runtime.now ?? Date.now;
  const schedule = runtime.setTimeout ?? setTimeout;
  const cancel = runtime.clearTimeout ?? clearTimeout;
  const state = {
    snapshot: null, chosen: null, available: false, pending: null, locked: false,
    wanted: false, config: null, token: "", tokenExpiresAt: 0, tokenTimer: null,
    widgetApi: null, widgetId: null, widgetLoading: null, widgetEpoch: 0, widgetSize: null,
    verificationState: "idle", cooldownUntil: 0, cooldownTimer: null, destroyed: false,
  };

  function later(callback, delay) {
    const timer = schedule(callback, delay);
    timer?.unref?.();
    return timer;
  }

  function coolingDown() { return now() < state.cooldownUntil; }

  function hasToken() { return Boolean(state.token) && now() < state.tokenExpiresAt; }

  function showStatus(message, kind = "info", focus = false) {
    status.textContent = message;
    status.dataset.state = kind;
    status.hidden = !message;
    if (focus && message) status.focus({ preventScroll: true });
  }

  function updateControls() {
    const voted = Boolean(state.snapshot?.selectedOption);
    form.hidden = voted || state.locked;
    fieldset.disabled = Boolean(state.pending) || !state.available || voted || state.locked;
    submit.disabled = fieldset.disabled || !state.chosen || !state.config || !hasToken() || coolingDown();
    submit.textContent = state.pending === "POST" ? copy.submitting : copy.submit;
    retry.disabled = Boolean(state.pending) || coolingDown();
    verification.hidden = !state.available || voted || state.locked;
    verificationRetry.disabled = Boolean(state.pending) || Boolean(state.widgetLoading) || coolingDown();
    form.setAttribute("aria-busy", String(Boolean(state.pending)));
  }

  function showVerification(message, kind = "info", canRetry = false, focus = false) {
    verificationStatus.textContent = message;
    verificationStatus.dataset.state = kind;
    verificationRetry.hidden = !canRetry;
    if (focus) verificationStatus.focus({ preventScroll: true });
  }

  function removeWidget() {
    cancel(state.tokenTimer);
    state.tokenTimer = null;
    state.token = "";
    state.tokenExpiresAt = 0;
    state.widgetEpoch += 1;
    if (state.widgetId !== null) {
      try { state.widgetApi?.remove(state.widgetId); } catch { /* Its DOM may already be gone. */ }
    }
    state.widgetId = null;
    state.widgetApi = null;
    state.widgetLoading = null;
    state.widgetSize = null;
    challenge.replaceChildren();
    state.verificationState = "idle";
  }

  function verificationFailed(message) {
    cancel(state.tokenTimer);
    state.tokenTimer = null;
    state.token = "";
    state.tokenExpiresAt = 0;
    state.verificationState = "failed";
    showVerification(message, "error", true);
    updateControls();
  }

  function widgetSize() {
    // Flexible widgets have a documented 300px minimum. Without resize support,
    // compact remains safe even when the viewport becomes narrower later.
    return SizeObserver && challenge.clientWidth >= 300 ? "flexible" : "compact";
  }

  async function startVerification({ force = false, focus = false } = {}) {
    state.wanted = true;
    if (state.destroyed || !state.available || state.locked || !state.config || state.pending || coolingDown()) return;
    if (state.widgetLoading && !force) return state.widgetLoading;
    if (state.widgetId !== null && !force) return;
    removeWidget();
    const epoch = state.widgetEpoch;
    const config = state.config;
    state.verificationState = "loading";
    showVerification(copy.verification.loading, "info", false, focus);
    updateControls();
    const current = () => !state.destroyed && epoch === state.widgetEpoch && !state.locked && !state.pending && state.available;
    const loading = (async () => {
      try {
        const api = await loadScript();
        if (!current()) return;
        state.widgetApi = api;
        state.widgetSize = widgetSize();
        challenge.dataset.size = state.widgetSize;
        state.verificationState = "pending";
        showVerification(copy.errors.verification_required);
        state.widgetId = api.render(challenge, {
          sitekey: config.siteKey,
          action: config.action,
          language: turnstileLanguage(copy.locale),
          theme: "light",
          size: state.widgetSize,
          appearance: "always",
          execution: "render",
          tabindex: 0,
          "response-field": false,
          retry: "never",
          "refresh-expired": "never",
          "refresh-timeout": "never",
          callback: (token) => {
            if (!current()) return;
            if (typeof token !== "string" || !token || token.length > 2048) {
              verificationFailed(copy.verification.failed);
              return;
            }
            cancel(state.tokenTimer);
            state.token = token;
            state.tokenExpiresAt = now() + TOKEN_LIFETIME_MS;
            state.verificationState = "ready";
            state.tokenTimer = later(() => {
              if (current()) verificationFailed(copy.verification.expired);
            }, TOKEN_LIFETIME_MS);
            showVerification(copy.verification.ready);
            updateControls();
          },
          "error-callback": () => {
            if (current()) verificationFailed(copy.verification.failed);
            return true;
          },
          "expired-callback": () => {
            if (current()) verificationFailed(copy.verification.expired);
          },
          "timeout-callback": () => {
            if (current()) verificationFailed(copy.verification.expired);
          },
          "unsupported-callback": () => {
            if (current()) verificationFailed(copy.verification.unavailable);
          },
        });
        if (state.widgetId === undefined || state.widgetId === null) throw new Error("turnstile_render_failed");
      } catch {
        if (current()) {
          removeWidget();
          verificationFailed(copy.verification.unavailable);
        }
      } finally {
        if (epoch === state.widgetEpoch) {
          state.widgetLoading = null;
          updateControls();
        }
      }
    })();
    if (epoch === state.widgetEpoch) state.widgetLoading = loading;
    return loading;
  }

  function waitToRetry(error) {
    state.cooldownUntil = now() + (error.retryAfterMs || 60_000);
    cancel(state.cooldownTimer);
    showVerification(formatPollText(copy.verification.wait, {
      seconds: number.format(Math.ceil((state.cooldownUntil - now()) / 1000)),
    }), "info", true);
    state.cooldownTimer = later(() => {
      state.cooldownUntil = 0;
      showVerification(copy.errors.verification_required, "info", Boolean(state.config));
      updateControls();
    }, state.cooldownUntil - now());
  }

  function renderSnapshot(snapshot, { submitted = false, focus = false, alreadyVoted = false } = {}) {
    state.snapshot = snapshot;
    state.available = true;
    state.locked = alreadyVoted || snapshot.alreadyVoted || Boolean(snapshot.selectedOption);
    state.config = snapshot.turnstile;
    if (snapshot.selectedOption) state.chosen = snapshot.selectedOption;
    for (const radio of radios) radio.checked = radio.value === state.chosen;

    total.textContent = formatPollText(copy.totalVotes, { count: number.format(snapshot.totalVotes) });
    for (const row of rows) {
      const id = row.dataset.pollResult;
      const votes = snapshot.options.find((option) => option.id === id).votes;
      const ratio = snapshot.totalVotes > 0 ? votes / snapshot.totalVotes : 0;
      row.querySelector("[data-poll-count]").textContent = formatPollText(copy.resultCount, {
        votes: number.format(votes), percent: percent.format(ratio),
      });
      row.querySelector("[data-poll-bar]").style.width = `${ratio * 100}%`;
      row.querySelector("[data-poll-selected]").hidden = snapshot.selectedOption !== id;
    }
    results.hidden = false;
    retry.hidden = true;

    if (state.locked) removeWidget();
    else if (!state.config) {
      removeWidget();
      showVerification(copy.verification.unavailable, "info");
      retry.hidden = false;
    } else {
      showVerification(copy.errors.verification_required);
    }

    if (snapshot.selectedOption) {
      results.open = true;
      showStatus(formatPollText(submitted ? copy.success : copy.voted, {
        language: copy.options[snapshot.selectedOption],
      }), "success", focus);
    } else if (state.locked) {
      // A withdrawn choice is not part of the active tally, but its original
      // vote still exists. Show the real results without offering another vote.
      results.open = true;
      showStatus(copy.errors.already_voted, "info", focus);
    } else {
      showStatus("", "info");
      if (focus) results.querySelector("summary").focus({ preventScroll: true });
    }
  }

  function showError(error, operation, focus = false) {
    let message = copy.errors[error.code];
    if (typeof message !== "string" || (operation === "POST" && error.code === "unavailable")) {
      message = operation === "POST" ? copy.errors.vote_failed : copy.errors.unavailable;
    }
    showStatus(message, "error", focus);
    retry.hidden = false;
  }

  async function loadPoll({ focus = false, duplicate = false, afterError = null } = {}) {
    if (state.pending || coolingDown()) return;
    state.pending = "GET";
    removeWidget();
    showStatus(afterError ? copy.verification.checkingVote : copy.loading);
    updateControls();
    try {
      const snapshot = await requestPoll("GET", undefined, fetcher);
      renderSnapshot(snapshot, { focus, alreadyVoted: duplicate });
      if (afterError && !state.locked) showError(afterError, "POST", focus);
    } catch (error) {
      state.available = false;
      results.hidden = true;
      showError(afterError ?? error, afterError ? "POST" : "GET", focus);
    } finally {
      state.pending = null;
      updateControls();
      if (state.wanted) await startVerification();
    }
  }

  form.addEventListener("focusin", () => startVerification());
  form.addEventListener("change", async () => {
    if (state.pending || state.locked) return;
    state.chosen = radios.find((radio) => radio.checked)?.value ?? null;
    updateControls();
    await startVerification();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.pending || !state.available || state.locked || coolingDown()) return;
    state.chosen = radios.find((radio) => radio.checked)?.value ?? null;
    if (!POLL_OPTIONS.includes(state.chosen)) {
      showStatus(copy.choiceRequired, "error", true);
      return;
    }
    if (!state.config || !hasToken()) {
      showVerification(state.config ? copy.errors.verification_required : copy.verification.unavailable, "info", Boolean(state.config), true);
      await startVerification();
      return;
    }

    const requestedOption = state.chosen;
    const token = state.token;
    // A token may have been consumed even if the response is lost. Never reuse it.
    removeWidget();
    state.pending = "POST";
    retry.hidden = true;
    showStatus(copy.submitting);
    updateControls();
    try {
      const snapshot = await requestPoll("POST", requestedOption, fetcher, token);
      // A 200 without a confirmed selection is not proof that the vote was saved.
      if (!snapshot.selectedOption && !snapshot.alreadyVoted) throw new PollRequestError("unavailable");
      renderSnapshot(snapshot, {
        submitted: snapshot.selectedOption === requestedOption, focus: true,
      });
    } catch (error) {
      if (error.code === "already_voted") {
        state.locked = true;
        let snapshot;
        try { snapshot = validatePollSnapshot(error.payload); } catch { /* Refetch below. */ }
        if (snapshot) {
          renderSnapshot(snapshot, { focus: true, alreadyVoted: true });
        } else {
          state.pending = null;
          await loadPoll({ focus: true, duplicate: true });
        }
      } else {
        if (error.code === "rate_limited") waitToRetry(error);
        if (error.code === "unavailable" ||
            (!Object.hasOwn(copy.errors, error.code) && error.status >= 500)) {
          // Confirm the cookie's server state before offering another attempt.
          state.pending = null;
          await loadPoll({ focus: true, afterError: error });
        } else {
          showError(error, "POST", true);
          if (!coolingDown()) showVerification(copy.errors.verification_required, "info", Boolean(state.config));
        }
      }
    } finally {
      state.pending = null;
      updateControls();
    }
  });

  verificationRetry.addEventListener("click", () => startVerification({ force: true, focus: true }));
  retry.addEventListener("click", () => loadPoll({ focus: true, duplicate: state.locked && !state.snapshot?.selectedOption }));
  const observer = Observer ? new Observer((entries) => {
    if (entries.some((entry) => entry.target === root && entry.isIntersecting)) {
      void startVerification();
    }
  }, { threshold: 0 }) : null;
  observer?.observe(root);
  const sizeObserver = SizeObserver ? new SizeObserver(() => {
    if (state.widgetId !== null && widgetSize() !== state.widgetSize && !state.pending) {
      void startVerification({ force: true });
    }
  }) : null;
  sizeObserver?.observe(challenge);
  await loadPoll();
  return {
    refresh: loadPoll,
    beginVerification: startVerification,
    destroy() {
      state.destroyed = true;
      observer?.disconnect();
      sizeObserver?.disconnect();
      cancel(state.cooldownTimer);
      removeWidget();
    },
  };
}

// Keep native anchor navigation/focus working even without JS or a working API.
export function initPollShortcut(root, dock, Observer = typeof IntersectionObserver === "undefined" ? null : IntersectionObserver) {
  const shortcut = dock?.querySelector("[data-poll-shortcut]");
  if (!root || !shortcut || !Observer) return null;

  let inView = false;
  function updateVisibility() {
    // Do not remove the keyboard user's current focus as they scroll.
    const focused = root.ownerDocument.activeElement === shortcut;
    dock.dataset.pollInView = String(inView && !focused);
  }

  shortcut.addEventListener("blur", updateVisibility);
  updateVisibility();
  const observer = new Observer((entries) => {
    for (const entry of entries) {
      if (entry.target !== root) continue;
      inView = entry.isIntersecting;
      updateVisibility();
    }
  }, { rootMargin: "-80px 0px -64px 0px", threshold: 0 });
  // Observe the whole section: long results must not bring the shortcut back
  // merely because the heading has scrolled out of view.
  observer.observe(root);
  return observer;
}

if (typeof document !== "undefined") {
  for (const root of document.querySelectorAll("[data-language-poll]")) {
    initPollShortcut(root, document.querySelector("[data-poll-shortcut-dock]"));
    void initLanguagePoll(root);
  }
}
