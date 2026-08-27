export const POLL_ID = "anvil-next-language-v1";
export const POLL_OPTIONS = Object.freeze([
  "de", "fr", "pt-br", "it", "tr", "zh-cn", "ja", "ko", "other",
]);

const ENDPOINT = "/api/polls/next-language";
const REQUEST_TIMEOUT_MS = 12_000;

export class PollRequestError extends Error {
  constructor(code, payload) {
    super(code);
    this.name = "PollRequestError";
    this.code = code;
    this.payload = payload;
  }
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
  };
}

export async function requestPoll(method = "GET", option, fetcher = fetch) {
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
      ...(method === "POST" ? { body: JSON.stringify({ option }) } : {}),
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

export async function initLanguagePoll(root, fetcher = fetch) {
  const copy = JSON.parse(root.querySelector("[data-poll-copy]").textContent);
  const form = root.querySelector("[data-poll-form]");
  const fieldset = root.querySelector("[data-poll-fieldset]");
  const submit = root.querySelector("[data-poll-submit]");
  const retry = root.querySelector("[data-poll-retry]");
  const status = root.querySelector("[data-poll-status]");
  const results = root.querySelector("[data-poll-results]");
  const total = root.querySelector("[data-poll-total]");
  const radios = [...form.querySelectorAll('input[name="next-language"]')];
  const rows = [...root.querySelectorAll("[data-poll-result]")];
  const number = new Intl.NumberFormat(copy.locale);
  const percent = new Intl.NumberFormat(copy.locale, {
    style: "percent", maximumFractionDigits: 1,
  });
  const state = { snapshot: null, chosen: null, available: false, pending: null, locked: false };

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
    submit.disabled = fieldset.disabled || !state.chosen;
    submit.textContent = state.pending === "POST" ? copy.submitting : copy.submit;
    retry.disabled = Boolean(state.pending);
    form.setAttribute("aria-busy", String(Boolean(state.pending)));
  }

  function renderSnapshot(snapshot, { submitted = false, focus = false, alreadyVoted = false } = {}) {
    state.snapshot = snapshot;
    state.available = true;
    state.locked = alreadyVoted || Boolean(snapshot.selectedOption);
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

    if (snapshot.selectedOption) {
      results.open = true;
      showStatus(formatPollText(submitted ? copy.success : copy.voted, {
        language: copy.options[snapshot.selectedOption],
      }), "success", focus);
    } else if (alreadyVoted) {
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

  async function loadPoll({ focus = false, duplicate = false } = {}) {
    if (state.pending) return;
    state.pending = "GET";
    showStatus(copy.loading);
    updateControls();
    try {
      const snapshot = await requestPoll("GET", undefined, fetcher);
      renderSnapshot(snapshot, { focus, alreadyVoted: duplicate });
    } catch (error) {
      state.available = false;
      results.hidden = true;
      showError(error, "GET", focus);
    } finally {
      state.pending = null;
      updateControls();
    }
  }

  form.addEventListener("change", () => {
    if (state.pending || state.locked) return;
    state.chosen = radios.find((radio) => radio.checked)?.value ?? null;
    updateControls();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.pending || !state.available || state.locked) return;
    state.chosen = radios.find((radio) => radio.checked)?.value ?? null;
    if (!POLL_OPTIONS.includes(state.chosen)) {
      showStatus(copy.choiceRequired, "error", true);
      return;
    }

    const requestedOption = state.chosen;
    state.pending = "POST";
    retry.hidden = true;
    showStatus(copy.submitting);
    updateControls();
    try {
      const snapshot = await requestPoll("POST", requestedOption, fetcher);
      // A 200 without a confirmed selection is not proof that the vote was saved.
      if (!snapshot.selectedOption) throw new PollRequestError("unavailable");
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
        showError(error, "POST", true);
      }
    } finally {
      state.pending = null;
      updateControls();
    }
  });

  retry.addEventListener("click", () => loadPoll({ focus: true, duplicate: state.locked && !state.snapshot?.selectedOption }));
  await loadPoll();
  return { refresh: loadPoll };
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
