"use strict";

const $ = (selector) => document.querySelector(selector);
const ui = {
    login: $("#login-view"), chat: $("#chat-view"), loginForm: $("#login-form"),
    key: $("#api-key"), loginButton: $("#login-button"), loginError: $("#login-message"),
    generateKey: $("#generate-key-button"), keyStatus: $("#key-status"), toggleKey: $("#toggle-key"),
    logout: $("#logout-button"), connection: $("#connection-status"),
    conversation: $("#conversation"), messages: $("#messages"), empty: $("#empty-state"),
    thinking: $("#thinking"), form: $("#message-form"), input: $("#message-input"),
    send: $("#send-button"), count: $("#character-count"),
    error: $("#chat-error"), errorText: $("#chat-error-text"), reconnect: $("#reconnect-button"),
};
const keyPattern = /^[A-Za-z0-9_-]{8,255}$/;
const timeFormat = new Intl.DateTimeFormat("ru-RU", {hour: "2-digit", minute: "2-digit"});
const dateFormat = new Intl.DateTimeFormat("ru-RU", {day: "numeric", month: "long", year: "numeric"});
let apiKey = "";
let chatId = null;
let messages = [];
let socket = null;
let loading = false;
let generatingKey = false;
let ready = false;
let connecting = false;
let pending = null;
let interrupted = null;
let heartbeat;
let heartbeatDeadline;
let connectionDeadline;
let responseDeadline;

function updateControls() {
    ui.key.disabled = loading || generatingKey;
    ui.toggleKey.disabled = loading || generatingKey;
    ui.generateKey.disabled = loading || generatingKey;
    ui.generateKey.textContent = generatingKey ? "Получаем ключ…" : "Получить ключ";
    ui.loginButton.disabled = loading || generatingKey || !keyPattern.test(ui.key.value);
    ui.loginButton.textContent = loading ? "Входим…" : "Войти";
    ui.input.disabled = !ready || Boolean(pending);
    ui.send.disabled = !ready || Boolean(pending) || !ui.input.value.trim() || ui.input.value.length > 500;
    ui.send.textContent = pending ? "Ожидаем…" : "Отправить";
    ui.logout.disabled = loading || Boolean(pending);
    ui.reconnect.disabled = loading || connecting;
    ui.count.textContent = `${ui.input.value.length} / 500`;
    ui.count.classList.toggle("near-limit", ui.input.value.length >= 450);
    ui.thinking.hidden = !pending;
}

function setConnection(state, text) {
    ui.connection.dataset.state = state;
    ui.connection.textContent = text;
}

function showError(text = "", reconnect = false) {
    ui.error.hidden = !text;
    ui.errorText.textContent = text;
    ui.reconnect.hidden = !reconnect;
}

async function request(path, body, headers = {}) {
    const response = await fetch(`/api${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
            ...(body === undefined ? {} : {"Content-Type": "application/json"}),
            ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
    });
    if (response.status === 403) throw new Error("Неверный ключ доступа.");
    if (response.status === 422) throw new Error("Недопустимый формат ключа.");
    if (!response.ok) throw new Error("Сервис недоступен. Попробуйте ещё раз чуть позже.");
    return response.json();
}

function errorMessage(error, fallback) {
    return error instanceof Error && !["TypeError", "TimeoutError", "AbortError", "SyntaxError"].includes(error.name)
        ? error.message : fallback;
}

function validMessage(message) {
    return message && Number.isInteger(message.id) && ["user", "assistant"].includes(message.role)
        && typeof message.content === "string" && Number.isFinite(Date.parse(message.created_at));
}

async function loadChat(key) {
    const chat = await request("/llm_chat/get_chat_info", undefined, {"X-API-Key": key});
    if (!Number.isInteger(chat.id) || chat.id < 1) {
        throw new Error("Не удалось открыть диалог. Попробуйте ещё раз.");
    }
    chatId = chat.id;
}

async function loadHistory(id) {
    const data = await request(`/llm_chat/history/${id}`);
    if (!Array.isArray(data) || !data.every(validMessage)) {
        throw new Error("Не удалось загрузить историю диалога. Попробуйте ещё раз.");
    }
    messages = data;
    if (interrupted) {
        const recovered = messages.some((message, index) => message.id > interrupted.lastId
            && message.role === "user" && message.content === interrupted.content
            && messages[index + 1]?.role === "assistant");
        if (recovered && ui.input.value === interrupted.content) ui.input.value = "";
        interrupted = null;
    }
    renderMessages();
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function renderMessage(message) {
    const isUser = message.role === "user";
    const article = element("article", `message message-${message.role}`);
    const body = element("div", "message-body");
    const meta = element("div", "message-meta");
    meta.append(element("span", "message-author", isUser ? "Вы" : "AI"));
    const date = new Date(message.created_at);
    const time = element("time", "message-time", timeFormat.format(date));
    time.dateTime = date.toISOString();
    time.title = `${dateFormat.format(date)}, ${timeFormat.format(date)}`;
    meta.append(time);
    // Both user input and model output are untrusted. Render as plain text.
    body.append(meta, element("div", "message-content", message.content));
    article.append(body);
    return article;
}

function renderMessages() {
    const fragment = document.createDocumentFragment();
    let lastDay = "";
    const visibleMessages = pending ? [...messages, {...pending, role: "user", pending: true}] : messages;
    for (const message of visibleMessages) {
        const date = new Date(message.created_at);
        const day = dateFormat.format(date);
        if (day !== lastDay) {
            fragment.append(element("div", "day-divider", day));
            lastDay = day;
        }
        fragment.append(renderMessage(message));
    }
    ui.messages.replaceChildren(fragment);
    ui.empty.hidden = visibleMessages.length > 0;
}

function scrollToLatest() {
    requestAnimationFrame(() => {
        ui.conversation.scrollTop = messages.length || pending ? ui.conversation.scrollHeight : 0;
    });
}

function resizeInput() {
    ui.input.style.height = "auto";
    ui.input.style.height = `${Math.min(ui.input.scrollHeight, 160)}px`;
}

function stopTimers() {
    clearInterval(heartbeat);
    clearTimeout(heartbeatDeadline);
    clearTimeout(connectionDeadline);
    clearTimeout(responseDeadline);
}

function restorePending() {
    clearTimeout(responseDeadline);
    if (pending) ui.input.value = pending.content;
    pending = null;
    renderMessages();
    updateControls();
    resizeInput();
}

function disconnect(text) {
    const oldSocket = socket;
    socket = null;
    ready = false;
    connecting = false;
    stopTimers();
    if (oldSocket) oldSocket.close();
    if (pending) interrupted = {content: pending.content, lastId: messages.at(-1)?.id ?? 0};
    restorePending();
    setConnection("offline", "Нет соединения");
    showError(text, true);
}

function connect() {
    if (socket) socket.close();
    stopTimers();
    ready = false;
    connecting = true;
    setConnection("connecting", "Подключаемся");
    updateControls();
    const url = new URL(`/api/llm_chat/ws/${chatId}`, location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const current = new WebSocket(url);
    socket = current;
    connectionDeadline = setTimeout(() => {
        if (socket === current) disconnect("Не удалось подключиться к чату. Попробуйте ещё раз.");
    }, 12000);
    current.addEventListener("message", (event) => {
        if (socket !== current) return;
        let data;
        try { data = JSON.parse(event.data); } catch {
            disconnect("Не удалось прочитать ответ сервера. Подключитесь снова.");
            return;
        }
        if (!data || typeof data !== "object") {
            disconnect("Не удалось прочитать ответ сервера. Подключитесь снова.");
            return;
        }
        if (data.type === "ready") {
            if (ready) return;
            clearTimeout(connectionDeadline);
            ready = true;
            connecting = false;
            showError();
            setConnection("ready", "На связи");
            updateControls();
            scrollToLatest();
            ui.input.focus();
            heartbeat = setInterval(() => {
                if (ready && !pending && current.readyState === WebSocket.OPEN) {
                    current.send(JSON.stringify({type: "ping"}));
                    heartbeatDeadline = setTimeout(() => disconnect("Соединение прервалось. Подключитесь снова."), 10000);
                }
            }, 20000);
        } else if (data.type === "pong") {
            clearTimeout(heartbeatDeadline);
        } else if (data.role === "error") {
            restorePending();
            showError(typeof data.content === "string" ? data.content : "Не удалось получить ответ.");
            setConnection("ready", "На связи");
            ui.input.focus();
        } else if (data.role === "assistant" && pending) {
            if (!Array.isArray(data.messages) || data.messages.length !== 2 || !data.messages.every(validMessage)) {
                disconnect("Ответ получен, но историю нужно обновить. Подключитесь снова.");
                return;
            }
            clearTimeout(responseDeadline);
            const knownIds = new Set(messages.map((message) => message.id));
            messages.push(...data.messages.filter((message) => !knownIds.has(message.id)));
            pending = null;
            ui.input.value = "";
            renderMessages();
            setConnection("ready", "На связи");
            updateControls();
            resizeInput();
            scrollToLatest();
            ui.input.focus();
        }
    });
    current.addEventListener("close", () => {
        if (socket !== current) return;
        disconnect(!ready
            ? "Не удалось открыть диалог. Попробуйте подключиться снова."
            : pending
                ? "Связь прервалась во время ответа. Подключитесь снова, чтобы обновить историю перед повторной отправкой."
                : "Соединение прервалось. Подключитесь, чтобы продолжить.");
    });
    current.addEventListener("error", () => {
        // The following close event reports the failure and restores the draft.
    });
}

ui.key.addEventListener("input", () => {
    ui.loginError.textContent = "";
    ui.keyStatus.textContent = "";
    updateControls();
});
ui.toggleKey.addEventListener("click", () => {
    const show = ui.key.type === "password";
    ui.key.type = show ? "text" : "password";
    ui.toggleKey.setAttribute("aria-pressed", String(show));
    ui.toggleKey.setAttribute("aria-label", show ? "Скрыть ключ" : "Показать ключ");
});
ui.generateKey.addEventListener("click", async () => {
    if (loading || generatingKey) return;
    generatingKey = true;
    ui.loginError.textContent = "";
    ui.keyStatus.textContent = "";
    updateControls();
    try {
        const data = await request("/auth/generate_api_key");
        if (typeof data.api_key !== "string" || !keyPattern.test(data.api_key)) {
            throw new Error("Сервис вернул некорректный ключ.");
        }
        ui.key.value = data.api_key;
        ui.keyStatus.textContent = "Ключ получен.";
    } catch (error) {
        ui.loginError.textContent = errorMessage(error, "Не удалось получить ключ. Проверьте соединение и попробуйте снова.");
    } finally {
        generatingKey = false;
        updateControls();
    }
});

ui.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loading || generatingKey || !keyPattern.test(ui.key.value)) return;
    loading = true;
    ui.loginError.textContent = "";
    updateControls();
    const key = ui.key.value;
    try {
        const verification = await request("/auth/check_api_key", {api_key: key});
        if (verification.is_verified !== true) throw new Error("Неверный ключ доступа.");
        await loadChat(key);
        await loadHistory(chatId);
        apiKey = key;
        ui.key.value = "";
        ui.keyStatus.textContent = "";
        ui.login.hidden = true;
        ui.chat.hidden = false;
        connect();
    } catch (error) {
        ui.loginError.textContent = errorMessage(error, "Не удалось открыть диалог. Проверьте соединение и попробуйте снова.");
    } finally {
        loading = false;
        updateControls();
    }
});

ui.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const content = ui.input.value;
    if (!ready || pending || !content.trim() || content.length > 500) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        disconnect("Соединение прервалось. Подключитесь снова.");
        return;
    }
    showError();
    clearTimeout(heartbeatDeadline);
    pending = {content, created_at: new Date().toISOString()};
    ui.input.value = "";
    try {
        socket.send(JSON.stringify({content}));
    } catch {
        disconnect("Не удалось отправить сообщение. Текст сохранён в поле ввода.");
        return;
    }
    responseDeadline = setTimeout(() => disconnect("Ответ занимает слишком много времени. Подключитесь снова, чтобы проверить историю."), 240000);
    renderMessages();
    setConnection("connecting", "Готовим ответ");
    updateControls();
    resizeInput();
    scrollToLatest();
});
ui.input.addEventListener("input", () => { updateControls(); resizeInput(); });
ui.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        ui.form.requestSubmit();
    }
});
ui.reconnect.addEventListener("click", async () => {
    if (loading || connecting || !apiKey) return;
    loading = true;
    updateControls();
    showError();
    setConnection("connecting", "Загружаем историю");
    try {
        await loadChat(apiKey);
        await loadHistory(chatId);
        connect();
    } catch (error) {
        setConnection("offline", "Нет соединения");
        showError(errorMessage(error, "Не удалось загрузить историю. Попробуйте снова."), true);
    } finally {
        loading = false;
        updateControls();
    }
});
ui.logout.addEventListener("click", () => {
    if (pending || loading) return;
    const previous = socket;
    socket = null;
    previous?.close();
    stopTimers();
    apiKey = "";
    chatId = null;
    messages = [];
    interrupted = null;
    ready = false;
    connecting = false;
    ui.input.value = "";
    ui.chat.hidden = true;
    ui.login.hidden = false;
    ui.key.type = "password";
    ui.toggleKey.setAttribute("aria-pressed", "false");
    ui.toggleKey.setAttribute("aria-label", "Показать ключ");
    showError();
    renderMessages();
    updateControls();
    ui.key.focus();
});
window.addEventListener("pagehide", () => { stopTimers(); socket?.close(); });
window.addEventListener("pageshow", (event) => {
    if (event.persisted && apiKey) disconnect("Подключитесь снова, чтобы продолжить диалог.");
});
updateControls();
