"use strict";
// Ironveil inside AkulavBox: the game's saves live with the account. The game reads and writes them
// synchronously through game/storage.js (window.ironveilStorage); here they are held in memory, loaded
// from /ironveil/api/saves before the game starts, and written back in the background a moment after
// each change. A save that can't reach the server waits in this browser and is sent on the next visit.
(function () {
    var API = "/ironveil/api/saves";
    var PENDING = "ironveil:pending:"; // localStorage: saves not yet on the server
    var memory = new Map();
    var queue = new Map(); // key -> text, or null to remove
    var timer = null;
    var sending = false;
    var retryIn = 2000;

    var $ = function (id) { return document.getElementById(id); };
    function status(text, kind) {
        var el = $("status");
        if (!text) { el.hidden = true; return; }
        el.textContent = text;
        el.className = "status " + (kind || "");
        el.hidden = false;
    }
    var store = {
        get: function (k) { try { return localStorage.getItem(PENDING + k); } catch (e) { return null; } },
        set: function (k, v) { try { if (v == null) localStorage.setItem(PENDING + k, "\u0000"); else localStorage.setItem(PENDING + k, v); } catch (e) { /* full or blocked */ } },
        drop: function (k) { try { localStorage.removeItem(PENDING + k); } catch (e) { /* blocked */ } },
        keys: function () { var out = []; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(PENDING) === 0) out.push(k.slice(PENDING.length)); } } catch (e) { /* blocked */ } return out; },
    };

    function schedule(key, text) {
        queue.set(key, text);
        clearTimeout(timer);
        timer = setTimeout(flush, 800);
    }

    async function send(key, text) {
        var r = await fetch(API + "/" + encodeURIComponent(key), text == null
            ? { method: "DELETE", headers: { "X-Requested-With": "ironveil" }, credentials: "same-origin" }
            : { method: "PUT", headers: { "X-Requested-With": "ironveil", "Content-Type": "text/plain; charset=utf-8" }, credentials: "same-origin", body: text });
        if (r.ok) return;
        var body = null;
        try { body = await r.json(); } catch (e) { /* not JSON */ }
        var err = new Error(r.status === 401 ? "You were signed out." : (body && body.error) || "The server answered " + r.status + ".");
        err.status = r.status;
        throw err;
    }

    async function flush() {
        if (sending || !queue.size) return;
        sending = true;
        try {
            while (queue.size) {
                var key = queue.keys().next().value;
                var text = queue.get(key);
                queue.delete(key);
                try {
                    await send(key, text);
                    if (!queue.has(key)) store.drop(key);
                    retryIn = 2000;
                    status(null);
                    if (window.akbBus) window.akbBus.post("storage");
                } catch (e) {
                    if (!queue.has(key)) queue.set(key, text); // a newer change wins
                    store.set(key, text);
                    status(e.status === 401 ? "Signed out: your progress is kept in this browser until you sign in again." : "Not saved to your account yet: " + e.message + " Trying again…", "warn");
                    if (e.status !== 401 && e.status !== 413) { clearTimeout(timer); timer = setTimeout(flush, retryIn); retryIn = Math.min(retryIn * 2, 60000); }
                    break;
                }
            }
        } finally { sending = false; }
    }

    // The game draws nothing while it makes its sprites (a few seconds): the loading screen stays until
    // the menu asks whether there is a run to continue, its first look at the "run" save
    var started = false;
    function shown() {
        if (started) return;
        started = true;
        $("loading").hidden = true;
        document.getElementById("glcanvas").focus();
    }

    // the game's storage: synchronous, from memory
    window.ironveilStorage = {
        get: function (k) { if (k === "run") setTimeout(shown, 50); return memory.has(k) ? memory.get(k) : null; },
        set: function (k, v) { memory.set(k, v); store.set(k, v); schedule(k, v); return true; },
        remove: function (k) { memory.delete(k); store.set(k, null); schedule(k, null); },
    };

    // leaving the page: what is still waiting is in this browser already, and goes out now if it can
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });

    async function start() {
        var r;
        try { r = await fetch(API, { credentials: "same-origin" }); } catch (e) { r = null; }
        if (r && r.status === 401) { location.replace("/login?next=" + encodeURIComponent("/ironveil/")); return; }
        if (!r || !r.ok) {
            $("loading-text").textContent = "Your saves couldn’t be loaded. Check your connection and reload the page.";
            $("loading").classList.add("failed");
            return;
        }
        var data = await r.json();
        for (var k in data.saves) memory.set(k, data.saves[k]);
        // saves this browser couldn't send last time are newer than the server's
        var waiting = store.keys();
        for (var i = 0; i < waiting.length; i++) {
            var v = store.get(waiting[i]);
            if (v === "\u0000") { memory.delete(waiting[i]); schedule(waiting[i], null); } else if (v != null) { memory.set(waiting[i], v); schedule(waiting[i], v); }
        }
        $("loading-text").textContent = "Starting the game…";
        setTimeout(shown, 20000); // whatever happens, never hide the game for good
        load("/ironveil/game/ironveil.wasm");
    }
    start();
})();
